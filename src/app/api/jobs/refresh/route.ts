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
import { checkResearch } from "@/lib/limits";
import { searchEnabledSources } from "@/lib/sources";
import { isBlockedPublisher } from "@/lib/sources/blocklist";
import { dedupeRawJobs } from "@/lib/sources/dedupe";
import { isLikelySameJob } from "@/lib/sources/similarity";

// Fans out to several job APIs + batched AI scoring. Raised to the Pro/Fluid
// ceiling for headroom; Vercel clamps this down to the plan's limit (e.g. 60s
// on Hobby) without failing the build. The real guarantee against a 504 is the
// SCORING_BUDGET_MS deadline below, which always returns a (possibly partial)
// success well under the cap regardless of plan.
export const maxDuration = 300;

// Wall-clock budget for the whole run, kept safely under the smallest plan cap
// (Hobby = 60s) so the request never hits FUNCTION_INVOCATION_TIMEOUT. Scoring
// stops launching new batches once this elapses; only scored jobs are persisted
// and billed, so the remainder is re-fetched cheaply on the next refresh.
// Override with REFRESH_BUDGET_MS (e.g. on Pro where the cap is higher). 45s
// leaves headroom under a 60s cap for the final in-flight wave + persist/charge.
const SCORING_BUDGET_MS = Number(process.env.REFRESH_BUDGET_MS) || 45_000;

export async function POST() {
  try {
    return await runRefresh();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Refresh failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runRefresh() {
  const deadline = Date.now() + SCORING_BUDGET_MS;
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const profile = await getProfile(userId);
  if (!profile) {
    return NextResponse.json(
      { error: "Upload a CV first — the matcher needs your profile." },
      { status: 400 },
    );
  }

  // Balance gate (> 0 tokens) + per-hour rate limit, before any fetching.
  const gate = await checkResearch(userId);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
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

  // 3a. Split into repeats (already in the user's DB by exact hash) and fresh.
  // Repeats are billed for re-display but never re-scored; DELETED rows count as
  // repeats too, so hidden/removed jobs stay excluded and cheap.
  const existing = await prisma.job.findMany({
    where: { userId, dedupeHash: { in: considered.map((j) => j.dedupeHash) } },
    select: { dedupeHash: true },
  });
  const existingHashes = new Set(existing.map((e) => e.dedupeHash));
  const repeatsCount = considered.filter((j) =>
    existingHashes.has(j.dedupeHash),
  ).length;
  let fresh = considered.filter((j) => !existingHashes.has(j.dedupeHash));

  // 3b. Also drop anything that LOOKS LIKE a starred or applied job — handles cross-source
  // title variants (e.g. "Senior PD" vs "Senior PD - parental leave cover" at the same company).
  const protectedJobs = await prisma.job.findMany({
    where: { userId, status: { in: ["STARRED", "APPLIED"] } },
    select: { title: true, company: true, location: true },
  });
  if (protectedJobs.length > 0) {
    fresh = fresh.filter(
      (cand) => !protectedJobs.some((p) => isLikelySameJob(cand, p)),
    );
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
  // + latency regardless of how many jobs were fetched.
  if (fresh.length > TOKEN.MAX_SCORE_CANDIDATES) {
    fresh = fresh.slice(0, TOKEN.MAX_SCORE_CANDIDATES);
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
  // job. Unscored fresh jobs are not surfaced and not billed.
  const ratedCount = scoredFresh.length;
  const cost =
    TOKEN.PER_JOB_DISPLAY * (ratedCount + repeatsCount) +
    TOKEN.PER_JOB_RATING * ratedCount;

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

  // 7. Charge once the new jobs are scored + stored, so a failed run isn't billed.
  const tokens = await charge(userId, cost, "research", {
    considered: considered.length,
    rated: ratedCount,
    repeats: repeatsCount,
    ...(droppedUnscored > 0 ? { droppedUnscored } : {}),
  });

  return NextResponse.json({
    added: result.count,
    scanned,
    reports,
    tokens: {
      balance: tokens.balance,
      charged: tokens.charged,
      debtAdded: tokens.debtAdded,
    },
  });
}
