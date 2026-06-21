import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  ALL_JOB_TYPES,
  ALL_SENIORITY,
  LOCATION_OPTIONS,
} from "@/lib/constants";
import { scoreJobs } from "@/lib/matcher";
import { prerankAndCap, type PrerankPrefs } from "@/lib/prerank";
import { prisma } from "@/lib/prisma";
import { getProfile, getSessionUserId, getSettings } from "@/lib/repo";
import { charge, TOKEN } from "@/lib/tokens";
import { getEnabledSourceIds } from "@/lib/credentials";
import { checkResearch, getScoringLimits } from "@/lib/limits";
import { searchEnabledSources } from "@/lib/sources";
import { isBlockedPublisher } from "@/lib/sources/blocklist";
import { dedupeRawJobs } from "@/lib/sources/dedupe";
import { companyBlockKey } from "@/lib/sources/normalize";
import { isLikelySameJob } from "@/lib/sources/similarity";

// Fans out to several job APIs + batched AI scoring. Raised to the Pro/Fluid
// ceiling for headroom; Vercel clamps this down to the plan's limit (e.g. 60s
// on Hobby) without failing the build. The real guarantee against a 504 is the
// SCORING_BUDGET_MS deadline below, which always returns a (possibly partial)
// success well under the cap regardless of plan.
export const maxDuration = 300;

// Per-pass scoring ceiling, kept safely under the smallest plan cap (Hobby =
// 60s) so the request never hits FUNCTION_INVOCATION_TIMEOUT. Scoring stops
// launching new batches once the pass deadline elapses; only scored jobs are
// persisted and billed, so the remainder is re-fetched on the next pass.
// Override with REFRESH_BUDGET_MS (e.g. 240000 on Pro/Fluid where the cap is
// higher). 45s leaves headroom under a 60s cap for the final wave + persist.
const SCORING_BUDGET_MS = Number(process.env.REFRESH_BUDGET_MS) || 45_000;

// A pass always gets at least this much scoring time, even if the client's
// remaining overall budget is small — otherwise a near-expired research budget
// would launch a pass that scores nothing.
const MIN_PASS_BUDGET_MS = 8_000;

// Matches the fetch-time freshness net default in src/lib/sources/search.ts.
// After each Research action we also purge stale rows already in the DB so the
// board never lingers on listings older than this once they age past it.
const MAX_JOB_AGE_DAYS = 40;

// Hard-delete the user's untracked rows whose posting date is older than the
// freshness cutoff. Scoped to NEW (Inbox) + DELETED (hidden) only — tracked
// pipeline rows (Starred/Applied/Interviewing/Offer/Archived) are preserved
// regardless of age, since they represent the user's own intent. Rows with no
// publishedAt are kept (treated as fresh, mirroring the fetch-time net).
async function pruneStaleJobs(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000);
  await prisma.job.deleteMany({
    where: {
      userId,
      status: { in: ["NEW", "DELETED"] },
      publishedAt: { not: null, lt: cutoff },
    },
  });
}

export async function POST(request: Request) {
  try {
    // Optional body: { continuation?: boolean; budgetMs?: number }.
    //  - continuation: the client auto-continuing the same Research action;
    //    must not re-bill the re-display of repeats already charged.
    //  - budgetMs: how long THIS pass may score, derived by the client from the
    //    remaining 2.5-min overall research budget. We clamp it to
    //    [MIN_PASS_BUDGET_MS, SCORING_BUDGET_MS] so a pass never exceeds the
    //    function cap yet the whole research stays inside the overall ceiling.
    let continuation = false;
    let requestedBudgetMs = SCORING_BUDGET_MS;
    try {
      const body = (await request.json()) as
        | { continuation?: boolean; budgetMs?: number }
        | null;
      continuation = body?.continuation === true;
      if (typeof body?.budgetMs === "number" && Number.isFinite(body.budgetMs)) {
        requestedBudgetMs = body.budgetMs;
      }
    } catch {
      // No/!JSON body — a normal first pass with the default budget.
    }
    const passBudgetMs = Math.min(
      SCORING_BUDGET_MS,
      Math.max(MIN_PASS_BUDGET_MS, requestedBudgetMs),
    );
    return await runRefresh(continuation, passBudgetMs);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Refresh failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runRefresh(continuation: boolean, passBudgetMs: number) {
  const deadline = Date.now() + passBudgetMs;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const profile = await getProfile(userId);
  if (!profile) {
    return NextResponse.json(
      { error: "Upload a CV first. The matcher needs your profile." },
      { status: 400 },
    );
  }

  // Balance gate (> 0 tokens) + per-hour rate limit, before any fetching.
  const gate = await checkResearch(userId);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  // Purge stale rows once per Research action (skip on auto-continue passes,
  // which share the same action). Runs before the fetch so freshly aged-out
  // rows can't block a re-find — though anything >40 days won't survive the
  // fetch-time freshness net anyway.
  if (!continuation) {
    await pruneStaleJobs(userId);
  }

  const settings = await getSettings(userId);

  // Locations to search: from saved settings, falling back to all.
  const selectedLocations = LOCATION_OPTIONS.filter(
    (l) =>
      settings.defaultLocations.length === 0 ||
      settings.defaultLocations.includes(l.id),
  );
  const locations =
    selectedLocations.length > 0 ? selectedLocations : LOCATION_OPTIONS;

  // 1. Tiered fetch across enabled sources (primary → backup → fallback).
  // Which sources run is now a GLOBAL admin setting, not per-user.
  const enabledSourceIds = await getEnabledSourceIds();
  const { jobs: fetched, reports } = await searchEnabledSources(
    { userId, jobTitles: settings.jobTitles, locations },
    enabledSourceIds,
  );
  // Drop jobs from blocked publishers (e.g. BeBee) before dedupe, so a listing
  // also available via an allowed publisher survives as that copy.
  const allRaw = fetched.filter((j) => !isBlockedPublisher(j.publisher));
  const scanned = allRaw.length;

  // 2. Merge cross-platform duplicates (priority-aware winner), then lexically
  // pre-rank and cap to the per-search maximum. Pre-ranking (vs an arbitrary
  // slice) means the best-matching jobs survive the cap and downstream `fresh`
  // stays in relevance order, so the top-K candidate cut below is meaningful.
  const prerankPrefs: PrerankPrefs = {
    jobTitles: settings.jobTitles,
    profileTerms: [
      ...profile.skills,
      ...profile.tools,
      ...profile.keywords,
      ...profile.industries,
    ],
    preferredSeniority: settings.defaultSeniority,
    preferredJobTypes: settings.defaultJobTypes,
  };
  const considered = prerankAndCap(
    dedupeRawJobs(allRaw),
    prerankPrefs,
    TOKEN.MAX_SEARCH_JOBS,
  );

  // 3a. Split into repeats (already in the user's DB) and fresh. A candidate is
  // a repeat if it matches an existing row by EITHER the text-derived dedupeHash
  // OR the stable (source, externalId) pair. The externalId guard is what stops
  // an already-applied/starred listing from reappearing when an aggregator
  // re-massages its title/location text between fetches (which shifts the hash).
  // Repeats are billed for re-display but never re-scored; DELETED rows count as
  // repeats too, so hidden/removed jobs stay excluded and cheap.
  const existing = await prisma.job.findMany({
    where: {
      userId,
      OR: [
        { dedupeHash: { in: considered.map((j) => j.dedupeHash) } },
        { externalId: { in: considered.map((j) => j.externalId) } },
      ],
    },
    select: { dedupeHash: true, source: true, externalId: true },
  });
  const existingHashes = new Set(existing.map((e) => e.dedupeHash));
  const sourceKey = (j: { source: string; externalId: string }) =>
    `${j.source}::${j.externalId}`;
  const existingSourceKeys = new Set(existing.map(sourceKey));
  const isRepeat = (j: (typeof considered)[number]) =>
    existingHashes.has(j.dedupeHash) || existingSourceKeys.has(sourceKey(j));
  const repeatsCount = considered.filter(isRepeat).length;
  let fresh = considered.filter((j) => !isRepeat(j));

  // 3b. Drop any fresh candidate that fuzzily matches a job ALREADY in the user's
  // board — across ALL statuses, including other NEW rows from a previous refresh
  // and DELETED ("don't show again") rows. The exact-hash + (source, externalId)
  // repeat check above only catches same-source / identical-text matches; this
  // catches cross-source title/location variants (e.g. the same role surfaced by
  // JSearch as "Berlin" and by Adzuna as "Remote"), which is the main cause of
  // duplicate cards accumulating on the board across refreshes.
  const existingRows = await prisma.job.findMany({
    where: { userId },
    select: { title: true, company: true, location: true },
  });
  if (existingRows.length > 0) {
    // Block by normalized company so each candidate only compares within its
    // employer's bucket (O(n·k) not O(n²)).
    const byCompany = new Map<string, typeof existingRows>();
    for (const row of existingRows) {
      const key = companyBlockKey(row.company);
      const bucket = byCompany.get(key);
      if (bucket) bucket.push(row);
      else byCompany.set(key, [row]);
    }
    fresh = fresh.filter((cand) => {
      const bucket = byCompany.get(companyBlockKey(cand.company));
      return !bucket || !bucket.some((p) => isLikelySameJob(cand, p));
    });
  }

  // 3c. Personalize: drop jobs that contradict the user's seniority/jobType
  // preferences in Settings (defensive narrow rule — UNKNOWN always passes so
  // weak classification doesn't silently hide real listings).
  const narrowSeniority =
    settings.defaultSeniority.length > 0 &&
    settings.defaultSeniority.length < ALL_SENIORITY.length;
  const narrowJobTypes =
    settings.defaultJobTypes.length > 0 &&
    settings.defaultJobTypes.length < ALL_JOB_TYPES.length;
  if (narrowSeniority || narrowJobTypes) {
    fresh = fresh.filter((j) => {
      if (
        narrowSeniority &&
        j.seniority !== "UNKNOWN" &&
        !settings.defaultSeniority.includes(j.seniority)
      ) {
        return false;
      }
      if (
        narrowJobTypes &&
        j.jobType !== "UNKNOWN" &&
        !settings.defaultJobTypes.includes(j.jobType)
      ) {
        return false;
      }
      return true;
    });
  }

  // 3d. Cap the fresh jobs that reach AI scoring to the top-K candidates. `fresh`
  // is already in lexical-relevance order (derived by filtering the pre-ranked
  // `considered`), so this keeps the strongest matches and bounds AI token spend
  // + latency regardless of how many jobs were fetched. The cap is admin-tunable
  // (Admin → System Settings → "Jobs scored per Research") so cost/coverage can
  // be adjusted without a redeploy; it defaults to TOKEN.MAX_SCORE_CANDIDATES.
  // Track overflow so the response can flag that fresh jobs were left unscored
  // by the candidate cap (the user should run again to pick them up).
  const { maxScoreCandidates } = await getScoringLimits();
  const cappedOverflow = Math.max(0, fresh.length - maxScoreCandidates);
  if (cappedOverflow > 0) {
    fresh = fresh.slice(0, maxScoreCandidates);
  }

  // Skip scoring entirely if there's nothing fresh to score — bill just the
  // re-display for repeats and return early. (We still re-display the repeats
  // because the user "re-saw" them via this Research action.)
  if (fresh.length === 0) {
    const cost = TOKEN.PER_JOB_DISPLAY * repeatsCount;
    const tokens = await charge(userId, cost, "research", {
      considered: considered.length,
      rated: 0,
      repeats: repeatsCount,
    });
    return NextResponse.json({
      added: 0,
      scanned,
      reports,
      newJobIds: [],
      pendingMore: false,
      tokens: {
        balance: tokens.balance,
        charged: tokens.charged,
        debtAdded: tokens.debtAdded,
      },
    });
  }

  // 4. Score the new jobs against the CV profile + user preferences.
  const scores = await scoreJobs(
    profile,
    settings.jobTitles,
    {
      preferredSeniority: settings.defaultSeniority,
      preferredJobTypes: settings.defaultJobTypes,
      preferredLocations: settings.defaultLocations,
    },
    fresh.map((j) => ({
      id: j.dedupeHash,
      title: j.title,
      company: j.company,
      location: j.location,
      description: j.description,
    })),
    deadline,
  );

  // 5. Drop fresh jobs that didn't get a score (transient AI 429, malformed
  // response, or the scoring deadline cutting the run short) — they never enter
  // the DB and never bill the user, so a future Research can re-fetch and retry
  // them. Every persisted row is
  // guaranteed to have a real matchScore, missingSkills, and
  // requiredLanguages — the previous null-allowed shape no longer happens.
  const scoredFresh = fresh.filter((j) => scores.has(j.dedupeHash));
  const droppedUnscored = fresh.length - scoredFresh.length;

  // Cost: 0.5 per surfaced job (scored-fresh + repeats) + 1 per freshly-rated
  // job. Unscored fresh jobs are not surfaced and not billed. On a continuation
  // pass the repeats were already billed for re-display on the first pass of the
  // same Research action, so we bill only the newly-rated jobs — keeping an
  // N-pass auto-continue's total cost equal to a single complete run.
  const ratedCount = scoredFresh.length;
  const billedDisplay = continuation ? ratedCount : ratedCount + repeatsCount;
  const cost =
    TOKEN.PER_JOB_DISPLAY * billedDisplay + TOKEN.PER_JOB_RATING * ratedCount;

  // 6. Persist (only scored rows). The score lookup is guaranteed by the
  // filter above, so the `!` non-null assertion is safe.
  const now = new Date();
  const rows: Prisma.JobCreateManyInput[] = scoredFresh.map((j) => {
    const score = scores.get(j.dedupeHash)!;
    return {
      userId,
      source: j.source,
      externalId: j.externalId,
      dedupeHash: j.dedupeHash,
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      publisher: j.publisher,
      description: j.description,
      jobType: j.jobType,
      seniority: j.seniority,
      publishedAt: j.publishedAt,
      matchScore: score.score,
      matchExplanation: score.explanation,
      missingSkills: score.missingSkills,
      requiredLanguages: score.requiredLanguages,
      scoredAt: now,
      status: "NEW",
    };
  });

  // `createMany` no-ops cleanly on an empty array, but skip it explicitly
  // when nothing scored so the row count is unambiguously 0.
  const result =
    rows.length > 0
      ? await prisma.job.createMany({ data: rows, skipDuplicates: true })
      : { count: 0 };

  // Resolve the IDs of the rows just inserted so the board can flag them with a
  // "New" badge. `scoredFresh` hashes are guaranteed absent from the DB before
  // this run (repeats were filtered by hash above), so a lookup by those hashes
  // + status NEW returns exactly the freshly created rows.
  const newJobIds =
    rows.length > 0
      ? (
          await prisma.job.findMany({
            where: {
              userId,
              status: "NEW",
              dedupeHash: { in: scoredFresh.map((j) => j.dedupeHash) },
            },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [];

  // 7. Charge once the new jobs are scored + stored, so a failed run isn't billed.
  const tokens = await charge(userId, cost, "research", {
    considered: considered.length,
    rated: ratedCount,
    repeats: repeatsCount,
    ...(droppedUnscored > 0 ? { droppedUnscored } : {}),
  });

  // True when the scoring deadline (or a transient batch error) left jobs in
  // THIS run's candidate set unscored — the client auto-continues to finish
  // them. NOTE: the `cappedOverflow` (jobs beyond MAX_SCORE_CANDIDATES) is
  // intended truncation, not incompleteness, so it must NOT trigger a
  // continuation — that would expand coverage and cost beyond the design.
  const pendingMore = droppedUnscored > 0;

  return NextResponse.json({
    added: result.count,
    scanned,
    reports,
    newJobIds,
    pendingMore,
    tokens: {
      balance: tokens.balance,
      charged: tokens.charged,
      debtAdded: tokens.debtAdded,
    },
  });
}
