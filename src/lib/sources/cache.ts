import type { JobSource, RawJob, SearchParams } from "./types";

/**
 * Short-TTL, in-memory cache for source search results. Keyed by
 * (sourceId, normalized job titles, location ids) — deliberately NOT by userId,
 * since the same titles+locations return the same listings regardless of who
 * asks. Two users (or the same user refreshing twice) with identical search
 * terms skip the upstream round-trip entirely.
 *
 * In-memory only: it warms per serverless instance and isn't shared across
 * them, which is fine — it's a latency/cost optimization, not a correctness
 * guarantee. At a 10-minute TTL the freshness cost is negligible.
 */
const TTL_MS = Number(process.env.SOURCE_CACHE_TTL_MS) || 10 * 60_000;

type Entry = { expires: number; jobs: RawJob[] };

const store = new Map<string, Entry>();

function cacheKey(sourceId: string, params: SearchParams): string {
  const titles = [...params.jobTitles]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  const locations = [...params.locations]
    .map((l) => l.id)
    .sort()
    .join("|");
  return `${sourceId}::${titles}::${locations}`;
}

/** Run `source.search` through the TTL cache. Empty results are not cached, so
 *  a transient upstream failure (which surfaces as `[]`) can be retried sooner. */
export async function cachedSearch(
  source: JobSource,
  params: SearchParams,
): Promise<RawJob[]> {
  const key = cacheKey(source.id, params);
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.jobs;
  if (hit) store.delete(key);

  const jobs = await source.search(params);
  if (jobs.length > 0) {
    store.set(key, { expires: now + TTL_MS, jobs });
  }
  return jobs;
}
