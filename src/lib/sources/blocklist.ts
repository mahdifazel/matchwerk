/**
 * Publishers we refuse to surface jobs from, regardless of which aggregator
 * (JSearch / Fantastic) reported them. Matched case-insensitively as a substring
 * of `RawJob.publisher`, so "BeBee", "bebee", and "bebee.com" all match.
 *
 * Filtered BEFORE dedupe so that if the same listing is also available via a
 * non-blocked publisher, that copy survives and the job isn't lost.
 */
const BLOCKED_PUBLISHER_PATTERNS = ["bebee"];

export function isBlockedPublisher(
  publisher: string | null | undefined,
): boolean {
  if (!publisher) return false;
  const p = publisher.toLowerCase();
  return BLOCKED_PUBLISHER_PATTERNS.some((pattern) => p.includes(pattern));
}
