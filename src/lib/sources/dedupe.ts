import { createHash } from "crypto";
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

/** Collapse cross-platform duplicates, keeping the first occurrence. */
export function dedupeRawJobs(jobs: RawJob[]): (RawJob & { dedupeHash: string })[] {
  const byHash = new Map<string, RawJob & { dedupeHash: string }>();
  for (const job of jobs) {
    const hash = dedupeHash(job);
    if (!byHash.has(hash)) byHash.set(hash, { ...job, dedupeHash: hash });
  }
  return [...byHash.values()];
}
