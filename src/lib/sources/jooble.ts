import { getSourceCredentials } from "@/lib/credentials";
import { inferJobType, inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

/**
 * Jooble's API — the key is part of the path, not a header or query string.
 * Docs: https://jooble.org/api/about
 */
const BASE_URL = "https://jooble.org/api";
const MAX_TITLES = 4;
const RESULTS_PER_PAGE = 50; // max accepted by Jooble's free tier in practice
const MAX_PAGES = 2; // up to 100 jobs per (title × location)

type JoobleJob = {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  /** Underlying source aggregated by Jooble (e.g. "indeed", "stepstone"). */
  source?: string;
  /** Free-text job type, often empty. */
  type?: string;
  /** The "go to job" URL — usually a jooble.org redirector to the source ATS. */
  link?: string;
  company?: string;
  /** ISO-ish timestamp for last update. */
  updated?: string;
};

type JoobleResponse = {
  totalCount?: number;
  jobs?: JoobleJob[];
};

/**
 * Distinct location query strings derived from the selected location options.
 * Jooble's `location` is free text — we pass the display name. Remote is left
 * to Jooble's full-text match in the keywords; there's no dedicated flag.
 */
function buildLocations(params: SearchParams): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  let nationwide = false;
  for (const loc of params.locations) {
    if (loc.remote) {
      nationwide = true;
      continue;
    }
    if (loc.baWo) out.push(loc.baWo); // city/region name reused from BA
    else nationwide = true;
  }
  // "" lets Jooble decide nationally — keeps coverage when nothing is selected.
  if (nationwide || out.length === 0) out.push(undefined);
  return [...new Set(out)];
}

async function fetchOnePage(
  apiKey: string,
  keywords: string,
  location: string | undefined,
  page: number,
): Promise<JoobleJob[]> {
  const body: Record<string, string> = {
    keywords,
    page: String(page),
    ResultOnPage: String(RESULTS_PER_PAGE),
    SearchMode: "1",
  };
  if (location) body.location = location;

  const res = await fetchWithTimeout(`${BASE_URL}/${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Jooble returned ${res.status} for "${keywords}"`);
  }
  const data = (await res.json()) as JoobleResponse;
  return data.jobs ?? [];
}

async function fetchAllPages(
  apiKey: string,
  keywords: string,
  location: string | undefined,
): Promise<JoobleJob[]> {
  const all: JoobleJob[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchOnePage(apiKey, keywords, location, page);
    all.push(...items);
    if (items.length < RESULTS_PER_PAGE) break;
  }
  return all;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toRawJob(job: JoobleJob): RawJob | null {
  if (job.id === undefined || job.id === null || !job.title) return null;
  const title = job.title.trim();
  const company = job.company?.trim() || "Unknown company";
  let publishedAt: Date | null = null;
  if (job.updated) {
    const d = new Date(job.updated);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  return {
    source: "JOOBLE",
    externalId: String(job.id),
    title,
    company,
    location: job.location?.trim() || "Germany",
    url: job.link ?? "",
    publisher: job.source?.trim() || null,
    description: stripHtml(job.snippet ?? "").slice(0, 4000),
    jobType: inferJobType(`${title} ${job.type ?? ""}`),
    seniority: inferSeniority(title),
    publishedAt,
  };
}

/**
 * Backup aggregator covering Germany + EU. Queried alongside Adzuna when the
 * primary tier returns insufficient results. Free tier — see jooble.org/api/about.
 */
export const jooble: JobSource = {
  id: "JOOBLE",
  label: "Jooble",
  tier: "backup",
  connected: true,
  configured: async () => {
    const c = await getSourceCredentials("JOOBLE");
    return Boolean(c.apiKey);
  },

  async healthCheck() {
    const { apiKey } = await getSourceCredentials("JOOBLE");
    if (!apiKey) throw new Error("No credentials.");
    const res = await fetchWithTimeout(`${BASE_URL}/${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: "designer", page: "1", ResultOnPage: "1" }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const { apiKey } = await getSourceCredentials("JOOBLE");
    if (!apiKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    const locations = buildLocations(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    const tasks: Promise<void>[] = [];
    for (const title of titles) {
      for (const location of locations) {
        tasks.push(
          fetchAllPages(apiKey, title, location)
            .then((items) => {
              for (const item of items) {
                const raw = toRawJob(item);
                if (raw && !seen.has(raw.externalId)) {
                  seen.add(raw.externalId);
                  jobs.push(raw);
                }
              }
            })
            .catch((err) => console.error("[jooble]", err)),
        );
      }
    }
    await Promise.all(tasks);
    return jobs;
  },
};
