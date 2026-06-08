import type { JobSourceId } from "@/generated/prisma/enums";
import { cachedSearch } from "./cache";
import { ALL_SOURCES } from "./index";
import type { JobSource, RawJob, SearchParams } from "./types";

export type SourceRunReport = {
  id: JobSourceId;
  ran: boolean;
  count: number;
  skippedReason?: string;
};

// Hard freshness cap applied to every source's results, regardless of whether
// the source's own API can express a date window. Catches sources that can't:
// Jooble has no date param, and JSearch/Fantastic only take coarse presets.
// Adzuna self-caps tighter (31 days) via max_days_old; the default net is a
// no-op there. Per-source overrides below tighten where a source skews stale.
const DEFAULT_MAX_JOB_AGE_DAYS = 40;
const MAX_JOB_AGE_DAYS: Partial<Record<JobSourceId, number>> = {
  JOOBLE: 14, // 2-week window — Jooble aggregates older reposts
};

function maxAgeDays(id: JobSourceId): number {
  return MAX_JOB_AGE_DAYS[id] ?? DEFAULT_MAX_JOB_AGE_DAYS;
}

function withinFreshnessWindow(job: RawJob, cutoff: number): boolean {
  // No publish date = freshly surfaced listing; keep it (mirrors the board's
  // datePosted fallback to fetchedAt for null publishedAt).
  if (!job.publishedAt) return true;
  return job.publishedAt.getTime() >= cutoff;
}

/** Why a source can't run right now, or null if it can. */
async function blockedReason(
  source: JobSource,
  enabled: Set<JobSourceId>,
): Promise<string | null> {
  if (!source.connected) return "adapter not implemented";
  if (!enabled.has(source.id)) return "disabled by admin";
  if (!(await source.configured())) return "API key not configured";
  return null;
}

async function runSource(source: JobSource, params: SearchParams) {
  return cachedSearch(source, params).catch((err) => {
    console.error(`[search] ${source.id} failed:`, err);
    return [] as RawJob[];
  });
}

async function runTier(
  sources: JobSource[],
  enabled: Set<JobSourceId>,
  params: SearchParams,
  jobs: RawJob[],
  reports: SourceRunReport[],
): Promise<number> {
  let total = 0;
  const now = Date.now();
  await Promise.all(
    sources.map(async (source) => {
      const reason = await blockedReason(source, enabled);
      if (reason) {
        reports.push({
          id: source.id,
          ran: false,
          count: 0,
          skippedReason: reason,
        });
        return;
      }
      const cutoff = now - maxAgeDays(source.id) * 24 * 60 * 60 * 1000;
      const result = (await runSource(source, params)).filter((job) =>
        withinFreshnessWindow(job, cutoff),
      );
      jobs.push(...result);
      total += result.length;
      reports.push({ id: source.id, ran: true, count: result.length });
    }),
  );
  return total;
}

/**
 * Fetch from every enabled source in parallel — recall is the priority, so we
 * no longer gate the backup tier behind a primary-result threshold. Source
 * priority is enforced downstream at dedup (which copy wins) and in the lexical
 * pre-rank (which jobs survive the candidate cap), not by skipping sources.
 * Each source is isolated (`runSource` swallows failures into `[]`), so a slow
 * or failing source can't sink the run.
 */
export async function searchEnabledSources(
  params: SearchParams,
  enabledSourceIds: JobSourceId[],
): Promise<{ jobs: RawJob[]; reports: SourceRunReport[] }> {
  const enabled = new Set(enabledSourceIds);
  const reports: SourceRunReport[] = [];
  const jobs: RawJob[] = [];

  await runTier(ALL_SOURCES, enabled, params, jobs, reports);

  return { jobs, reports };
}
