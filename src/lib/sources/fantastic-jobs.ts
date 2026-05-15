import type { JobType } from "@/generated/prisma/enums";
import { getSourceCredentials } from "@/lib/credentials";
import { inferJobType, inferSeniority } from "@/lib/infer";
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

function buildLocationFilters(params: SearchParams): {
  filter: string | null;
  remote: boolean;
}[] {
  const out: { filter: string | null; remote: boolean }[] = [];
  let nationwide = false;
  for (const loc of params.locations) {
    if (loc.remote) out.push({ filter: null, remote: true });
    else if (loc.baWo) out.push({ filter: loc.baWo, remote: false });
    else nationwide = true;
  }
  if (nationwide || out.length === 0) {
    out.push({ filter: "Germany", remote: false });
  }
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = `${o.filter ?? ""}|${o.remote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": HOST,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Fantastic.jobs returned ${res.status}`);
  }
  const data = (await res.json()) as ActiveJobsResponse;
  return unwrap(data);
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

  async search(params: SearchParams): Promise<RawJob[]> {
    const { apiKey } = await getSourceCredentials("FANTASTIC_JOBS");
    if (!apiKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    if (titles.length === 0) return [];
    const filters = buildLocationFilters(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    const tasks: Promise<void>[] = filters.map(({ filter, remote }) =>
      fetchQuery(apiKey, titles, filter, remote)
        .then((items) => {
          for (const item of items) {
            const raw = toRawJob(item);
            if (raw && !seen.has(raw.externalId)) {
              seen.add(raw.externalId);
              jobs.push(raw);
            }
          }
        })
        .catch((err) => console.error("[fantastic-jobs]", err)),
    );
    await Promise.all(tasks);
    return jobs;
  },
};
