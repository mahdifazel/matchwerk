import type { JobSourceId } from "@/generated/prisma/enums";

/**
 * Source priority — drives two decisions that bias results toward the
 * platforms the owner cares about (LinkedIn / Indeed / Glassdoor / StepStone):
 *  1. Dedup winner: when the same job appears on several sources, the copy from
 *     the highest-priority source is kept (so its url/publisher provenance wins).
 *  2. Candidate cap tie-break: when the lexical pre-rank ties, the higher-priority
 *     source's job survives into AI scoring.
 *
 * It deliberately does NOT gate which sources run — every enabled source is
 * queried for maximum recall. Higher number = higher priority.
 */
export const SOURCE_PRIORITY: Record<JobSourceId, number> = {
  JSEARCH: 100, // LinkedIn / Indeed / Glassdoor / ZipRecruiter
  FANTASTIC_JOBS: 80, // ATS career-sites (Workday/Greenhouse/Ashby) + StepStone-style
  BA_JOBBOERSE: 60, // German public board
  ADZUNA: 40, // Germany/EU aggregator
  JOOBLE: 20, // Jooble aggregator

  // Legacy enum values kept for historical rows only — never queried.
  JOBSPY: 0,
  INDEED: 0,
  LINKEDIN: 0,
  STEPSTONE: 0,
  XING: 0,
  GLASSDOOR: 0,
  MONSTER: 0,
};

/** Priority for a source id, defaulting to 0 for anything unmapped. */
export function sourcePriority(id: JobSourceId): number {
  return SOURCE_PRIORITY[id] ?? 0;
}

const MAX_PRIORITY = Math.max(...Object.values(SOURCE_PRIORITY));

/** Source priority normalized to 0–1, for use as a weighted ranking feature. */
export function normalizedSourcePriority(id: JobSourceId): number {
  return MAX_PRIORITY > 0 ? sourcePriority(id) / MAX_PRIORITY : 0;
}

/**
 * Slots a source gets per round in the candidate interleave (see prerank.ts).
 * Higher-priority sources get more turns so the board leans toward LinkedIn /
 * Indeed / StepStone-origin listings (JSearch / Fantastic) instead of being
 * flooded by Adzuna's sheer volume. 0 for legacy/unqueried sources.
 */
export function candidateWeight(id: JobSourceId): number {
  const p = sourcePriority(id);
  if (p >= 80) return 3; // JSearch, Fantastic.jobs
  if (p >= 50) return 2; // BA Jobbörse
  if (p >= 20) return 1; // Adzuna, Jooble
  return 0;
}
