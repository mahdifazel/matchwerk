import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import {
  ALL_JOB_TYPES,
  ALL_SENIORITY,
  LOCATION_OPTIONS,
} from "@/lib/constants";
import { scoreJobs } from "@/lib/matcher";
import { prisma } from "@/lib/prisma";
import { getProfile, getSettings } from "@/lib/repo";
import { searchEnabledSources } from "@/lib/sources";
import { dedupeRawJobs } from "@/lib/sources/dedupe";
import { isLikelySameJob } from "@/lib/sources/similarity";

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
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "Upload a CV first — the matcher needs your profile." },
      { status: 400 },
    );
  }

  const settings = await getSettings();

  // Locations to search: from saved settings, falling back to all.
  const selectedLocations = LOCATION_OPTIONS.filter(
    (l) =>
      settings.defaultLocations.length === 0 ||
      settings.defaultLocations.includes(l.id),
  );
  const locations =
    selectedLocations.length > 0 ? selectedLocations : LOCATION_OPTIONS;

  // 1. Tiered fetch across enabled sources (primary → backup → fallback).
  const { jobs: allRaw, reports } = await searchEnabledSources(
    { jobTitles: settings.jobTitles, locations },
    settings.defaultSources,
  );
  const scanned = allRaw.length;

  // 2. Merge cross-platform duplicates.
  const deduped = dedupeRawJobs(allRaw);

  // 3a. Drop anything already in the DB by exact hash (any status — DELETED stays excluded too).
  const existing = await prisma.job.findMany({
    where: { dedupeHash: { in: deduped.map((j) => j.dedupeHash) } },
    select: { dedupeHash: true },
  });
  const existingHashes = new Set(existing.map((e) => e.dedupeHash));
  let fresh = deduped.filter((j) => !existingHashes.has(j.dedupeHash));

  // 3b. Also drop anything that LOOKS LIKE a starred or applied job — handles cross-source
  // title variants (e.g. "Senior PD" vs "Senior PD - parental leave cover" at the same company).
  const protectedJobs = await prisma.job.findMany({
    where: { status: { in: ["STARRED", "APPLIED"] } },
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

  if (fresh.length === 0) {
    return NextResponse.json({ added: 0, scanned, reports });
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

  return NextResponse.json({ added: result.count, scanned, reports });
}
