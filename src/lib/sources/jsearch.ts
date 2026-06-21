import type { JobType } from "@/generated/prisma/enums";
import { getSourceCredentials } from "@/lib/credentials";
import { inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

const ENDPOINT = "https://jsearch.p.rapidapi.com/search";
const HOST = "jsearch.p.rapidapi.com";
const MAX_TITLES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// JSearch's free RapidAPI tier rate-limits bursts and has a small monthly
// quota. We query titles sequentially (see `search`), but a 429 can still slip
// through, so retry it a couple of times honoring Retry-After.
const MAX_RETRIES_429 = 2;

/**
 * Location phrase appended to the JSearch free-text query. JSearch embeds the
 * location in the query string AND sends `country=de`, so per-city phrases are
 * redundant and just multiply requests. We collapse to a single nationwide
 * "Germany" — city granularity is recovered downstream from each job's
 * city/state, and the request count drops to one per title (vs title×city).
 */
function buildLocationPhrase(): string {
  return "Germany";
}

type JSearchJob = {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_apply_link?: string;
  job_description?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
};

type JSearchResponse = { data?: JSearchJob[] };

function mapEmploymentType(value?: string): JobType {
  switch ((value ?? "").toUpperCase()) {
    case "FULLTIME":
      return "FULL_TIME";
    case "PARTTIME":
      return "PART_TIME";
    case "CONTRACTOR":
      return "CONTRACT";
    case "INTERN":
      return "INTERNSHIP";
    default:
      return "UNKNOWN";
  }
}

function formatLocation(job: JSearchJob): string {
  const parts = [job.job_city, job.job_state]
    .filter((p): p is string => !!p)
    .filter((p, i, arr) => arr.indexOf(p) === i);
  const label = parts.join(", ") || job.job_country || "Germany";
  return job.job_is_remote ? `Remote · ${label}` : label;
}

async function fetchQuery(
  apiKey: string,
  query: string,
): Promise<JSearchJob[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("page", "1");
  // num_pages=2 doubles results returned per query; counts ~2 quota requests.
  url.searchParams.set("num_pages", "2");
  url.searchParams.set("country", "de");
  // JSearch's API caps the window: "all" / omitted both return empty, and
  // "month" is the broadest value that actually returns results.
  url.searchParams.set("date_posted", "month");

  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, {
      headers: {
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
      throw new Error(`JSearch returned ${res.status} for "${query}"`);
    }
    const data = (await res.json()) as JSearchResponse;
    return data.data ?? [];
  }
}

function toRawJob(job: JSearchJob): RawJob | null {
  if (!job.job_id || !job.job_title) return null;
  const title = job.job_title.trim();
  const company = job.employer_name?.trim() || "Unknown company";
  let publishedAt: Date | null = null;
  if (job.job_posted_at_datetime_utc) {
    const d = new Date(job.job_posted_at_datetime_utc);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  return {
    source: "JSEARCH",
    externalId: job.job_id,
    title,
    company,
    location: formatLocation(job),
    url: job.job_apply_link ?? "",
    publisher: job.job_publisher?.trim() || null,
    description: job.job_description?.slice(0, 4000) ?? "",
    jobType: mapEmploymentType(job.job_employment_type),
    seniority: inferSeniority(title),
    publishedAt,
  };
}

/**
 * Primary aggregator. JSearch (via RapidAPI) covers LinkedIn, Indeed, Glassdoor,
 * and ZipRecruiter. Requires JSEARCH_API_KEY (a RapidAPI key).
 */
export const jsearch: JobSource = {
  id: "JSEARCH",
  label: "JSearch",
  tier: "primary",
  connected: true,
  configured: async () => {
    const c = await getSourceCredentials("JSEARCH");
    return Boolean(c.apiKey);
  },

  async healthCheck() {
    const { apiKey } = await getSourceCredentials("JSEARCH");
    if (!apiKey) throw new Error("No API key.");
    const url = new URL(ENDPOINT);
    url.searchParams.set("query", "designer in Germany");
    url.searchParams.set("page", "1");
    url.searchParams.set("num_pages", "1");
    url.searchParams.set("country", "de");
    const res = await fetchWithTimeout(url, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": HOST },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const { apiKey } = await getSourceCredentials("JSEARCH");
    if (!apiKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    const phrase = buildLocationPhrase();
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    // One request per title (location is collapsed to nationwide), run in
    // parallel. The old code fired title×city (~12 calls) which tripped the free
    // tier's throttle and burned quota; with the location collapse this is now
    // only ≤MAX_TITLES calls — under the throttle — so parallel is safe and keeps
    // the fetch fast (it runs on every pass). fetchQuery retries a 429 as a
    // backstop. A single failed query is logged and skipped, not fatal.
    const tasks = titles.map((title) =>
      fetchQuery(apiKey, `${title} in ${phrase}`)
        .then((items) => {
          for (const item of items) {
            const raw = toRawJob(item);
            if (raw && !seen.has(raw.externalId)) {
              seen.add(raw.externalId);
              jobs.push(raw);
            }
          }
        })
        .catch((err) => console.error("[jsearch]", err)),
    );
    await Promise.all(tasks);
    return jobs;
  },
};
