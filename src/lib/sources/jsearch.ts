import type { JobType } from "@/generated/prisma/enums";
import { getSourceCredentials } from "@/lib/credentials";
import { inferSeniority } from "@/lib/infer";
import type { JobSource, RawJob, SearchParams } from "./types";

const ENDPOINT = "https://jsearch.p.rapidapi.com/search";
const HOST = "jsearch.p.rapidapi.com";
const MAX_TITLES = 4;

/** Location phrases to append to the JSearch free-text query. */
function buildLocationPhrases(params: SearchParams): {
  phrase: string;
  remote: boolean;
}[] {
  const out: { phrase: string; remote: boolean }[] = [];
  let nationwide = false;
  for (const loc of params.locations) {
    if (loc.remote) out.push({ phrase: "Germany", remote: true });
    else if (loc.baWo) out.push({ phrase: `${loc.baWo}, Germany`, remote: false });
    else nationwide = true;
  }
  if (nationwide || out.length === 0) {
    out.push({ phrase: "Germany", remote: false });
  }
  // De-dupe identical phrases.
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = `${o.phrase}|${o.remote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const res = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": HOST,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`JSearch returned ${res.status} for "${query}"`);
  }
  const data = (await res.json()) as JSearchResponse;
  return data.data ?? [];
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
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": HOST },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const { apiKey } = await getSourceCredentials("JSEARCH");
    if (!apiKey) return [];

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    const phrases = buildLocationPhrases(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    const tasks: Promise<void>[] = [];
    for (const title of titles) {
      for (const { phrase } of phrases) {
        const query = `${title} in ${phrase}`;
        tasks.push(
          fetchQuery(apiKey, query)
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
      }
    }
    await Promise.all(tasks);
    return jobs;
  },
};
