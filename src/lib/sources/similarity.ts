/**
 * "Looks like the same job" check used to filter candidates against jobs the user
 * has already starred or applied to. Stricter than `dedupeHash` (which is exact
 * after gender-marker normalization) — this catches cross-source title variants
 * like "Senior Product Designer" vs "Senior Product Designer - parental leave cover"
 * at the same company in the same city.
 */

const LEGAL_SUFFIXES = [
  "gmbh & co kg",
  "gmbh",
  "ag",
  "se",
  "ug",
  "kg",
  "ltd",
  "inc",
  "llc",
  "bv",
  "co",
];

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

function strip(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normCompany(s: string): string {
  let n = strip(s);
  for (const suffix of LEGAL_SUFFIXES) {
    if (n.endsWith(" " + suffix)) n = n.slice(0, -(suffix.length + 1)).trim();
  }
  return n;
}

function normCity(location: string): string {
  return strip(location.split(/[,·•]/)[0] ?? location);
}

/** Normalize title the same way as dedupe.ts (strip gender markers + punctuation). */
function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\((?:\s*(?:all genders?|gn|[dwmfx])\s*[/|]?\s*)+\)/gi, " ")
    .replace(/\b[mwfdx](?:\s*\/\s*[mwfdx]){1,3}\b/gi, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleWords(title: string): string[] {
  return normTitle(title).split(" ").filter(Boolean);
}

function seniorityIn(words: string[]): Set<string> {
  return new Set(words.filter((w) => SENIORITY_WORDS.has(w)));
}

type JobLike = { title: string; company: string; location: string };

/**
 * Coarse key grouping jobs that *could* be the same listing (same normalized
 * company + city). Used as a blocking key so `isLikelySameJob` only runs
 * pairwise within a small group instead of across every pair (O(n·k) not O(n²)).
 */
export function companyCityBlockKey(job: JobLike): string {
  return `${normCompany(job.company)}|${normCity(job.location)}`;
}

/** True when two jobs look like the same listing — same company+city, same seniority,
 *  and substantial title overlap. */
export function isLikelySameJob(a: JobLike, b: JobLike): boolean {
  if (normCompany(a.company) !== normCompany(b.company)) return false;

  const ca = normCity(a.location);
  const cb = normCity(b.location);
  // If both expose a city and they differ, treat as different jobs.
  if (ca && cb && ca !== cb) return false;

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

  // At least 70% of the shorter title's distinct words must overlap, with
  // at least 2 words shared (avoids collapsing on tiny generic titles).
  return inter / min >= 0.7 && inter >= 2;
}
