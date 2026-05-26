import type { JobSourceId } from "@/generated/prisma/enums";
import { ALL_SOURCES } from "./index";
import type { JobSource, RawJob, SearchParams } from "./types";

/**
 * If the primary tier collectively returns fewer than this many results,
 * backup sources are also queried.
 */
const PRIMARY_SUFFICIENT_THRESHOLD = 10;

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
  return source.search(params).catch((err) => {
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
 * Tiered fetch driven by each source's declared `tier`:
 *   1. Primary  — run all in parallel.
 *   2. Backup   — run only if primary returns less than the threshold.
 *   3. Fallback — run unless blocked (disabled / not connected / no key).
 */
export async function searchEnabledSources(
  params: SearchParams,
  enabledSourceIds: JobSourceId[],
): Promise<{ jobs: RawJob[]; reports: SourceRunReport[] }> {
  const enabled = new Set(enabledSourceIds);
  const reports: SourceRunReport[] = [];
  const jobs: RawJob[] = [];

  const primary = ALL_SOURCES.filter((s) => s.tier === "primary");
  const backup = ALL_SOURCES.filter((s) => s.tier === "backup");
  const fallback = ALL_SOURCES.filter((s) => s.tier === "fallback");

  // Tier 1
  const primaryCount = await runTier(primary, enabled, params, jobs, reports);

  // Tier 2 — only when primary returned too few.
  if (primaryCount >= PRIMARY_SUFFICIENT_THRESHOLD) {
    for (const s of backup) {
      reports.push({
        id: s.id,
        ran: false,
        count: 0,
        skippedReason: `primary returned enough results (${primaryCount})`,
      });
    }
  } else {
    await runTier(backup, enabled, params, jobs, reports);
  }

  // Tier 3
  await runTier(fallback, enabled, params, jobs, reports);

  return { jobs, reports };
}
