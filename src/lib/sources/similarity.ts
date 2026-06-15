/**
 * "Looks like the same job" check used to collapse cross-source duplicates and
 * to filter fresh candidates against jobs already in the user's board. Stricter
 * than `dedupeHash` (which is exact after normalization) — this catches
 * cross-source title variants like "Senior Product Designer" vs "Senior Product
 * Designer - parental leave cover" at the same employer, and treats a "Remote"
 * copy as the same listing as a city copy.
 *
 * All text normalization is shared with the exact hash via `./normalize`, so the
 * two stages can't disagree about what counts as the same company / city / title.
 */

import {
  cityCompatible,
  companyBlockKey,
  normCompany,
  normTitle,
} from "./normalize";

/** Seniority words that meaningfully separate roles — never collapse across these. */
const SENIORITY_WORDS = new Set([
  "junior",
  "senior",
  "lead",
  "principal",
  "staff",
  "head",
  "intern",
  "internship",
  "werkstudent",
  "praktikant",
]);

function titleWords(title: string): string[] {
  return normTitle(title).split(" ").filter(Boolean);
}

function seniorityIn(words: string[]): Set<string> {
  return new Set(words.filter((w) => SENIORITY_WORDS.has(w)));
}

type JobLike = { title: string; company: string; location: string };

/**
 * Coarse key grouping jobs that *could* be the same listing — normalized
 * company only. Used as a blocking key so `isLikelySameJob` runs pairwise
 * within a small group instead of across every pair (O(n·k) not O(n²)). City is
 * intentionally NOT part of the key so a remote/city pair still gets compared.
 */
export function companyCityBlockKey(job: JobLike): string {
  return companyBlockKey(job.company);
}

/** True when two jobs look like the same listing — same employer, compatible
 *  city, same seniority, and substantial title overlap. */
export function isLikelySameJob(a: JobLike, b: JobLike): boolean {
  const na = normCompany(a.company);
  const nb = normCompany(b.company);
  // Same employer is required; an empty/unknown company never matches (avoids
  // collapsing unrelated postings that both lack a company name).
  if (!na || !nb || na !== nb) return false;

  if (!cityCompatible(a.location, b.location)) return false;

  const wa = titleWords(a.title);
  const wb = titleWords(b.title);

  // Different seniority words => different roles (Junior vs Senior, etc.).
  const sa = seniorityIn(wa);
  const sb = seniorityIn(wb);
  if (sa.size !== sb.size) return false;
  for (const s of sa) if (!sb.has(s)) return false;

  const setA = new Set(wa);
  const setB = new Set(wb);
  const inter = [...setA].filter((w) => setB.has(w)).length;
  const min = Math.min(setA.size, setB.size);
  if (min === 0) return false;

  // At least 70% of the shorter title's distinct words must overlap, with at
  // least 2 words shared (avoids collapsing on tiny generic titles).
  return inter / min >= 0.7 && inter >= 2;
}
