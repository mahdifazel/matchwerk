import { createHash } from "crypto";
import { sourcePriority } from "./priority";
import { companyCityBlockKey, isLikelySameJob } from "./similarity";
import type { RawJob } from "./types";

/** Normalize a string for fuzzy matching: lowercase, drop gender markers, strip punctuation. */
function norm(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      // Drop parenthesized gender/diversity markers: (m/w/d), (all genders), (gn)...
      .replace(/\((?:\s*(?:all genders?|gn|[dwmfx])\s*[/|]?\s*)+\)/gi, " ")
      // Drop bare slash-delimited gender markers: m/w/d, w/m/x...
      .replace(/\b[mwfdx](?:\s*\/\s*[mwfdx]){1,3}\b/gi, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Stable hash identifying "the same job" across platforms — built from
 * title + company + the city portion of the location.
 */
export function dedupeHash(job: {
  title: string;
  company: string;
  location: string;
}): string {
  const city = norm(job.location.split(",")[0] ?? job.location);
  const key = `${norm(job.title)}|${norm(job.company)}|${city}`;
  return createHash("sha1").update(key).digest("hex");
}

export type DedupedJob = RawJob & { dedupeHash: string };

/** Keep `b` over `a` when it comes from a higher-priority source. */
function preferred(a: DedupedJob, b: RawJob): boolean {
  return sourcePriority(b.source) > sourcePriority(a.source);
}

/**
 * Collapse cross-platform duplicates in two passes:
 *   1. Exact — by `dedupeHash` (title|company|city after gender normalization).
 *   2. Fuzzy — block by normalized company+city, then merge title variants
 *      via `isLikelySameJob` (e.g. "Senior PD" vs "Senior PD - maternity cover").
 *
 * On every collision the copy from the **highest-priority source** is kept, so
 * a job available on both JSearch (LinkedIn-origin) and BA Jobbörse surfaces as
 * the JSearch copy — preserving the provenance the owner wants.
 */
export function dedupeRawJobs(jobs: RawJob[]): DedupedJob[] {
  // Pass 1 — exact hash, priority-aware winner.
  const byHash = new Map<string, DedupedJob>();
  for (const job of jobs) {
    const hash = dedupeHash(job);
    const existing = byHash.get(hash);
    if (!existing) {
      byHash.set(hash, { ...job, dedupeHash: hash });
    } else if (preferred(existing, job)) {
      byHash.set(hash, { ...job, dedupeHash: hash });
    }
  }

  // Pass 2 — fuzzy merge within company+city blocks.
  const blocks = new Map<string, DedupedJob[]>();
  for (const job of byHash.values()) {
    const key = companyCityBlockKey(job);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(job);
    else blocks.set(key, [job]);
  }

  const result: DedupedJob[] = [];
  for (const bucket of blocks.values()) {
    // Within a small same-company+city block, merge near-duplicate titles,
    // keeping the highest-priority source's record for each cluster.
    const kept: DedupedJob[] = [];
    for (const job of bucket) {
      const matchIdx = kept.findIndex((k) => isLikelySameJob(k, job));
      if (matchIdx === -1) {
        kept.push(job);
      } else if (preferred(kept[matchIdx], job)) {
        kept[matchIdx] = job;
      }
    }
    result.push(...kept);
  }

  return result;
}
