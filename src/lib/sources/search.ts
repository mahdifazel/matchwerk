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
      const result = await runSource(source, params);
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
