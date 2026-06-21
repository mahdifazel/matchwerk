import type { JobType } from "@/generated/prisma/enums";
import { getSourceCredentials } from "@/lib/credentials";
import { inferJobType, inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

const ENDPOINT = "https://active-jobs-db.p.rapidapi.com/active-ats-7d";
const HOST = "active-jobs-db.p.rapidapi.com";
const MAX_TITLES = 4;
const LIMIT_PER_QUERY = 50;

type ActiveJob = {
  id?: string;
  title?: string;
  organization?: string;
  organization_url?: string;
  organization_logo?: string;
  url?: string;
  source?: string;
  source_type?: string;
  source_domain?: string;
  date_posted?: string;
  date_created?: string;
  date_validthrough?: string;
  locations_derived?: string[];
  cities_derived?: string[];
  regions_derived?: string[];
  countries_derived?: string[];
  remote_derived?: boolean;
  employment_type?: string[];
  description_text?: string;
};

type ActiveJobsResponse = ActiveJob[] | { data?: ActiveJob[] };

function unwrap(raw: ActiveJobsResponse): ActiveJob[] {
  if (Array.isArray(raw)) return raw;
  return raw?.data ?? [];
}

// The free Active Jobs DB tier allows only ~25 requests/month plus a per-second
// throttle, so we must minimise calls. `location_filter=Germany` already returns
// city jobs (Berlin/Munich/Hamburg are a subset), so instead of one request per
// city we collapse to at most TWO queries: a single nationwide on-site query and
// a single remote query. Downstream city filtering still works off the derived
// location text on each job.
function buildLocationFilters(params: SearchParams): {
  filter: string | null;
  remote: boolean;
}[] {
  let wantRemote = false;
  let wantOnsite = false;
  for (const loc of params.locations) {
    if (loc.remote) wantRemote = true;
    else wantOnsite = true; // any city or "All Germany" → nationwide on-site
  }
  // Nothing selected → default to nationwide.
  if (!wantRemote && !wantOnsite) wantOnsite = true;

  const out: { filter: string | null; remote: boolean }[] = [];
  if (wantOnsite) out.push({ filter: "Germany", remote: false });
  if (wantRemote) out.push({ filter: null, remote: true });
  return out;
}

function mapEmploymentType(values?: string[]): JobType {
  if (!values?.length) return "UNKNOWN";
  const v = values[0]?.toUpperCase() ?? "";
  if (v.includes("FULL")) return "FULL_TIME";
  if (v.includes("PART")) return "PART_TIME";
  if (v.includes("CONTRACT")) return "CONTRACT";
  if (v.includes("INTERN")) return "INTERNSHIP";
  if (v.includes("TEMPORARY")) return "CONTRACT";
  return "UNKNOWN";
}

function formatLocation(job: ActiveJob): string {
  const first = job.locations_derived?.[0]?.trim();
  if (first) return job.remote_derived ? `Remote · ${first}` : first;
  const city = job.cities_derived?.[0];
  const region = job.regions_derived?.[0];
  const country = job.countries_derived?.[0] ?? "Germany";
  const parts = [city, region, country].filter(Boolean) as string[];
  const label = [...new Set(parts)].join(", ") || "Germany";
  return job.remote_derived ? `Remote · ${label}` : label;
}

/**
 * `advanced_title_filter` is parsed as a Postgres tsquery — `&` between
 * tokens, `|` between groups. We tokenise each title on non-alphanumerics,
 * AND its tokens together, then OR the groups.
 *   ["Product Designer", "ux/ui designer"]
 *     -> "(product & designer) | (ux & ui & designer)"
 */
function buildTsQuery(titles: string[]): string {
  const groups = titles
    .map((t) =>
      t
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((w) => w.length > 1),
    )
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => `(${tokens.join(" & ")})`);
  return [...new Set(groups)].join(" | ");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The free Active Jobs DB tier rate-limits bursts hard. We query locations
// sequentially (see `search`), but a 429 can still slip through, so retry it a
// couple of times honoring Retry-After before giving up on that query.
const MAX_RETRIES_429 = 2;

// Minimum gap between sequential requests to stay under the per-second throttle.
const REQUEST_SPACING_MS = 1_200;

async function fetchQuery(
  apiKey: string,
  titles: string[],
  locationFilter: string | null,
  remote: boolean,
): Promise<ActiveJob[]> {
  const tsQuery = buildTsQuery(titles);
  if (!tsQuery) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("advanced_title_filter", tsQuery);
  if (locationFilter) {
    url.searchParams.set("location_filter", locationFilter);
  }
  if (remote) {
    url.searchParams.set("remote", "true");
  }
  url.searchParams.set("description_type", "text");
  url.searchParams.set("limit", String(LIMIT_PER_QUERY));
  url.searchParams.set("offset", "0");

  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, {
      headers: {
        accept: "application/json",
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": HOST,
      },
      cache: "no-store",
    });
    if (res.status === 429 && attempt < MAX_RETRIES_429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Fantastic.jobs returned ${res.status}`);
    }
    const data = (await res.json()) as ActiveJobsResponse;
    return unwrap(data);
  }
}

function toRawJob(job: ActiveJob): RawJob | null {
  if (!job.id || !job.title) return null;
  const title = job.title.trim();
  const company = job.organization?.trim() || "Unknown company";
  let publishedAt: Date | null = null;
  const dateStr = job.date_posted || job.date_created;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  const empType = mapEmploymentType(job.employment_type);
  return {
    source: "FANTASTIC_JOBS",
    externalId: String(job.id),
    title,
    company,
    location: formatLocation(job),
    url: job.url ?? "",
    publisher: job.source?.trim() || job.source_domain || null,
    description: job.description_text?.slice(0, 4000) ?? "",
    jobType: empType === "UNKNOWN" ? inferJobType(title) : empType,
    seniority: inferSeniority(title),
    publishedAt,
  };
}

/**
 * Fantastic.jobs "Active Jobs DB" — RapidAPI aggregator that indexes 3M+
 * career-site listings (Workday, Greenhouse, Ashby, …). Refreshed hourly.
 * Requires FANTASTIC_JOBS_API_KEY.
 */
export const fantasticJobs: JobSource = {
  id: "FANTASTIC_JOBS",
  label: "Fantastic.jobs",
  tier: "primary",
  connected: true,
  configured: async () => {
    const c = await getSourceCredentials("FANTASTIC_JOBS");
    return Boolean(c.apiKey);
  },

  async healthCheck() {
    const { apiKey } = await getSourceCredentials("FANTASTIC_JOBS");
    if (!apiKey) throw new Error("No API key.");
    const url = new URL(ENDPOINT);
    url.searchParams.set("advanced_title_filter", "designer");
    url.searchParams.set("limit", "1");
    const res = await fetchWithTimeout(url, {
      headers: { accept: "application/json", "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": HOST },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const { apiKey } = await getSourceCredentials("FANTASTIC_JOBS");
    if (!apiKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    if (titles.length === 0) return [];
    const filters = buildLocationFilters(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    // Query locations SEQUENTIALLY with a gap between calls: the free Active
    // Jobs DB tier enforces a per-second throttle, so firing requests back to
    // back (let alone the old parallel Promise.all) makes them 429 and return
    // nothing. A single failed query is logged and skipped without sinking the
    // others.
    for (let i = 0; i < filters.length; i++) {
      const { filter, remote } = filters[i];
      if (i > 0) await sleep(REQUEST_SPACING_MS);
      try {
        const items = await fetchQuery(apiKey, titles, filter, remote);
        for (const item of items) {
          const raw = toRawJob(item);
          if (raw && !seen.has(raw.externalId)) {
            seen.add(raw.externalId);
            jobs.push(raw);
          }
        }
      } catch (err) {
        console.error("[fantastic-jobs]", err);
      }
    }
    return jobs;
  },
};
