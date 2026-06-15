import { createHash } from "crypto";
import { normCity, normCompany, normTitle } from "./normalize";
import { sourcePriority } from "./priority";
import { companyCityBlockKey, isLikelySameJob } from "./similarity";
import type { RawJob } from "./types";

/**
 * Stable hash identifying "the same job" across platforms — built from
 * normalized title + company + city. Uses the SAME normalizers as the fuzzy
 * matcher (`./normalize`): legal-suffix stripping, umlaut folding, postal-code /
 * country stripping, and German↔English city aliases all collapse here too, so
 * many cross-source variants now exact-match in Pass 1 instead of relying on the
 * fuzzy pass.
 */
export function dedupeHash(job: {
  title: string;
  company: string;
  location: string;
}): string {
  const key = `${normTitle(job.title)}|${normCompany(job.company)}|${normCity(job.location)}`;
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
