import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  ALL_JOB_TYPES,
  ALL_SENIORITY,
  LOCATION_OPTIONS,
} from "@/lib/constants";
import { scoreJobs } from "@/lib/matcher";
import { prisma } from "@/lib/prisma";
import { getProfile, getSessionUserId, getSettings } from "@/lib/repo";
import { charge, TOKEN } from "@/lib/tokens";
import { getEnabledSourceIds } from "@/lib/credentials";
import { checkResearch } from "@/lib/limits";
import { searchEnabledSources } from "@/lib/sources";
import { dedupeRawJobs } from "@/lib/sources/dedupe";
import { isLikelySameJob } from "@/lib/sources/similarity";

// Fans out to several job APIs + batched AI scoring — well past the default
// serverless timeout. 60s is safe on all Vercel plans; raise toward 300 on Pro
// if large refreshes still time out.
export const maxDuration = 60;

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
  const { jobs: allRaw, reports } = await searchEnabledSources(
    { userId, jobTitles: settings.jobTitles, locations },
    enabledSourceIds,
  );
  const scanned = allRaw.length;

  // 2. Merge cross-platform duplicates, then cap to the per-search maximum.
  const considered = dedupeRawJobs(allRaw).slice(0, TOKEN.MAX_SEARCH_JOBS);

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

  // Cost: 0.5 per surfaced job (fresh + repeats) + 1 per freshly-rated job.
  const ratedCount = fresh.length;
  const cost =
    TOKEN.PER_JOB_DISPLAY * (ratedCount + repeatsCount) +
    TOKEN.PER_JOB_RATING * ratedCount;

  // Only repeats reappeared — bill their re-display (no re-rating) and stop.
  if (ratedCount === 0) {
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
    })),
  );

  // 5. Persist.
  const now = new Date();
  const rows: Prisma.JobCreateManyInput[] = fresh.map((j) => {
    const score = scores.get(j.dedupeHash);
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
      matchScore: score?.score ?? null,
      matchExplanation: score?.explanation ?? null,
      missingSkills: score?.missingSkills ?? [],
      scoredAt: score ? now : null,
      status: "NEW",
    };
  });

  const result = await prisma.job.createMany({
    data: rows,
    skipDuplicates: true,
  });

  // 6. Charge once the new jobs are scored + stored, so a failed run isn't billed.
  const tokens = await charge(userId, cost, "research", {
    considered: considered.length,
    rated: ratedCount,
    repeats: repeatsCount,
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
