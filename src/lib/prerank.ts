import type { JobSourceId, JobType, Seniority } from "@/generated/prisma/enums";
import {
  candidateWeight,
  normalizedSourcePriority,
  sourcePriority,
} from "@/lib/sources/priority";

/**
 * Local, zero-token lexical pre-ranker. It orders the deduped job pool so the
 * AI scorer (the expensive, high-precision stage) only sees the most plausible
 * candidates. This is the "retrieve" half of a retrieve-and-rerank pipeline:
 * cheap breadth here, AI depth downstream.
 *
 * The score is used ONLY to order and cap candidates — the user-facing ranking
 * is still the AI matchScore. So a lexically-strong but poorly-fitting job can
 * never outrank an AI-validated fit on the board.
 */

export type PrerankJob = {
  title: string;
  description: string;
  source: JobSourceId;
  seniority: Seniority;
  jobType: JobType;
  publishedAt: Date | null;
};

export type PrerankPrefs = {
  /** Target job titles from Settings (jobTitles[0] is the primary role). */
  jobTitles: string[];
  /** CV terms to match against job text: skills ∪ tools ∪ keywords ∪ industries. */
  profileTerms: string[];
  /** Seniority levels opted into in Settings (empty = no preference). */
  preferredSeniority: Seniority[];
  /** Job types opted into in Settings (empty = no preference). */
  preferredJobTypes: JobType[];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "von",
  "der",
  "die",
  "das",
  "und",
  "in",
  "im",
  "of",
  "to",
  "a",
  "an",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Jaccard overlap of the job title against the union of target-title tokens. */
function titleMatch(title: string, jobTitles: string[]): number {
  const titleSet = new Set(tokenize(title));
  if (titleSet.size === 0) return 0;
  const targetSet = new Set(jobTitles.flatMap(tokenize));
  if (targetSet.size === 0) return 0;
  let inter = 0;
  for (const w of titleSet) if (targetSet.has(w)) inter++;
  // Coverage of the (usually short) target titles — rewards a job title that
  // contains the role words, robust to the job title carrying extra qualifiers.
  return inter / targetSet.size;
}

/**
 * BM25-lite: fraction of distinct CV terms that appear anywhere in the job's
 * title+description. Cheap stand-in for full BM25 — at this corpus size raw
 * term coverage discriminates well enough without IDF bookkeeping.
 */
function profileOverlap(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = new Set(tokenize(text));
  if (haystack.size === 0) return 0;
  let hits = 0;
  for (const term of terms) {
    const tokens = tokenize(term);
    if (tokens.length === 0) continue;
    // A multi-word term counts as present when all its tokens appear.
    if (tokens.every((t) => haystack.has(t))) hits++;
  }
  return hits / terms.length;
}

const RECENCY_HALF_LIFE_DAYS = 30;

/** Exponential recency decay; neutral (0.5) when the source omits a date. */
function recency(publishedAt: Date | null): number {
  if (!publishedAt) return 0.5;
  const ageDays = (Date.now() - publishedAt.getTime()) / 86_400_000;
  if (ageDays <= 0) return 1;
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** How well a job aligns with the user's seniority/jobType preferences (0–1).
 *  UNKNOWN always passes (weak classification shouldn't bury a real listing);
 *  no preference set is neutral (1). */
function prefMatch(job: PrerankJob, prefs: PrerankPrefs): number {
  const signals: number[] = [];
  if (prefs.preferredSeniority.length > 0) {
    signals.push(
      job.seniority === "UNKNOWN" ||
        prefs.preferredSeniority.includes(job.seniority)
        ? 1
        : 0,
    );
  }
  if (prefs.preferredJobTypes.length > 0) {
    signals.push(
      job.jobType === "UNKNOWN" || prefs.preferredJobTypes.includes(job.jobType)
        ? 1
        : 0,
    );
  }
  if (signals.length === 0) return 1;
  return signals.reduce((a, b) => a + b, 0) / signals.length;
}

const WEIGHTS = {
  title: 0.45,
  overlap: 0.3,
  recency: 0.1,
  pref: 0.1,
  source: 0.05,
} as const;

/** Combined lexical relevance score in [0, 1]. */
export function lexicalScore(job: PrerankJob, prefs: PrerankPrefs): number {
  const text = `${job.title} ${job.description}`;
  return (
    WEIGHTS.title * titleMatch(job.title, prefs.jobTitles) +
    WEIGHTS.overlap * profileOverlap(text, prefs.profileTerms) +
    WEIGHTS.recency * recency(job.publishedAt) +
    WEIGHTS.pref * prefMatch(job, prefs) +
    WEIGHTS.source * normalizedSourcePriority(job.source)
  );
}

/**
 * Select up to `limit` candidates with a **priority-weighted interleave** rather
 * than a flat score sort. A flat sort let the highest-volume source (Adzuna)
 * flood the candidate pool — and since priority only de-dupes, its unique
 * listings dominated the board. Here each source is sorted by lexical score
 * internally, then slots are filled round-robin in priority order, giving
 * higher-priority sources more turns per round (`candidateWeight`). This
 * guarantees JSearch/Fantastic a share and caps Adzuna's flood, while a final
 * score-ordered fill makes sure no slot is wasted when a source runs dry.
 */
export function prerankAndCap<T extends PrerankJob>(
  jobs: T[],
  prefs: PrerankPrefs,
  limit: number,
): T[] {
  // Group by source, each group sorted by lexical score (best first).
  const groups = new Map<JobSourceId, T[]>();
  for (const job of jobs) {
    const bucket = groups.get(job.source);
    if (bucket) bucket.push(job);
    else groups.set(job.source, [job]);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => lexicalScore(b, prefs) - lexicalScore(a, prefs));
  }

  // Source groups in priority order (JSearch → Fantastic → BA → Adzuna → Jooble).
  const orderedSources = [...groups.keys()].sort(
    (a, b) => sourcePriority(b) - sourcePriority(a),
  );

  // Weighted round-robin: each source yields `candidateWeight` items per round.
  const cursors = new Map<JobSourceId, number>();
  const result: T[] = [];
  let progressed = true;
  while (result.length < limit && progressed) {
    progressed = false;
    for (const src of orderedSources) {
      const bucket = groups.get(src)!;
      let taken = 0;
      const weight = candidateWeight(src);
      let i = cursors.get(src) ?? 0;
      while (taken < weight && i < bucket.length && result.length < limit) {
        result.push(bucket[i]);
        i++;
        taken++;
        progressed = true;
      }
      cursors.set(src, i);
    }
  }

  // Final fill: if priority weights left slots open (e.g. a weight-0 legacy
  // source still has jobs, or all weighted picks were exhausted), top up by raw
  // score so we never under-fill the candidate set when jobs remain.
  if (result.length < limit) {
    const leftovers: T[] = [];
    for (const src of orderedSources) {
      const bucket = groups.get(src)!;
      for (let i = cursors.get(src) ?? 0; i < bucket.length; i++) {
        leftovers.push(bucket[i]);
      }
    }
    leftovers.sort((a, b) => lexicalScore(b, prefs) - lexicalScore(a, prefs));
    for (const job of leftovers) {
      if (result.length >= limit) break;
      result.push(job);
    }
  }

  return result;
}
