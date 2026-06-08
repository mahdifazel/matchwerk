import type { JobType } from "@/generated/prisma/enums";
import { getSourceCredentials } from "@/lib/credentials";
import { inferJobType, inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

/** Path uses /search/{page} — built per page in fetchOnePage. */
const BASE_URL = "https://api.adzuna.com/v1/api/jobs/de/search";
const MAX_TITLES = 4;
const RESULTS_PER_PAGE = 50; // Adzuna's max
// Adzuna is the highest-volume source by far; left at 3 pages it floods the
// board and crowds out higher-priority sources (JSearch/Fantastic). Capped to 2
// pages (≤100 per title × location) — the priority-weighted candidate interleave
// (see prerank.ts) does the rest of the balancing.
const MAX_PAGES = 2;

/** Distinct `where` values derived from the selected locations. */
function buildWheres(params: SearchParams): (string | null)[] {
  const wheres: (string | null)[] = [];
  let nationwide = false;
  for (const loc of params.locations) {
    if (loc.remote) continue; // Adzuna has no reliable remote filter
    if (loc.baWo) wheres.push(loc.baWo);
    else nationwide = true;
  }
  if (nationwide || wheres.length === 0) wheres.push(null);
  return [...new Set(wheres)];
}

type AdzunaJob = {
  id?: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url?: string;
  description?: string;
  created?: string;
  contract_time?: string;
  contract_type?: string;
};

type AdzunaResponse = { results?: AdzunaJob[] };

function mapJobType(job: AdzunaJob): JobType {
  if (job.contract_type === "contract") return "CONTRACT";
  if (job.contract_time === "full_time") return "FULL_TIME";
  if (job.contract_time === "part_time") return "PART_TIME";
  return inferJobType(job.title ?? "");
}

async function fetchOnePage(
  appId: string,
  appKey: string,
  what: string,
  where: string | null,
  page: number,
): Promise<AdzunaJob[]> {
  const url = new URL(`${BASE_URL}/${page}`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("what", what);
  if (where) url.searchParams.set("where", where);
  url.searchParams.set("results_per_page", String(RESULTS_PER_PAGE));
  // No max_days_old — return listings regardless of post date.
  url.searchParams.set("content-type", "application/json");

  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Adzuna returned ${res.status} for "${what}"`);
  }
  const data = (await res.json()) as AdzunaResponse;
  return data.results ?? [];
}

async function fetchAllPages(
  appId: string,
  appKey: string,
  what: string,
  where: string | null,
): Promise<AdzunaJob[]> {
  const all: AdzunaJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchOnePage(appId, appKey, what, where, page);
    all.push(...items);
    if (items.length < RESULTS_PER_PAGE) break; // last page
  }
  return all;
}

function toRawJob(job: AdzunaJob): RawJob | null {
  if (!job.id || !job.title) return null;
  const title = job.title.trim();
  const company = job.company?.display_name?.trim() || "Unknown company";
  let publishedAt: Date | null = null;
  if (job.created) {
    const d = new Date(job.created);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  return {
    source: "ADZUNA",
    externalId: String(job.id),
    title,
    company,
    location: job.location?.display_name?.trim() || "Germany",
    url: job.redirect_url ?? "",
    publisher: null,
    description: job.description?.slice(0, 4000) ?? "",
    jobType: mapJobType(job),
    seniority: inferSeniority(title),
    publishedAt,
  };
}

/**
 * Backup aggregator with strong Germany/EU coverage. Queried by the orchestrator
 * only when JSearch returns insufficient results. Requires ADZUNA_APP_ID and
 * ADZUNA_APP_KEY (free tier at developer.adzuna.com).
 */
export const adzuna: JobSource = {
  id: "ADZUNA",
  label: "Adzuna",
  tier: "backup",
  connected: true,
  configured: async () => {
    const c = await getSourceCredentials("ADZUNA");
    return Boolean(c.appId && c.appKey);
  },

  async healthCheck() {
    const { appId, appKey } = await getSourceCredentials("ADZUNA");
    if (!appId || !appKey) throw new Error("No credentials.");
    const url = new URL(`${BASE_URL}/1`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", "designer");
    url.searchParams.set("results_per_page", "1");
    url.searchParams.set("content-type", "application/json");
    const res = await fetchWithTimeout(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const { appId, appKey } = await getSourceCredentials("ADZUNA");
    if (!appId || !appKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    const wheres = buildWheres(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    const tasks: Promise<void>[] = [];
    for (const title of titles) {
      for (const where of wheres) {
        tasks.push(
          fetchAllPages(appId, appKey, title, where)
            .then((items) => {
              for (const item of items) {
                const raw = toRawJob(item);
                if (raw && !seen.has(raw.externalId)) {
                  seen.add(raw.externalId);
                  jobs.push(raw);
                }
              }
            })
            .catch((err) => console.error("[adzuna]", err)),
        );
      }
    }
    await Promise.all(tasks);
    return jobs;
  },
};
