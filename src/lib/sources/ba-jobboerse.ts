import { inferJobType, inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

const BASE_URL =
  "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs";
const API_KEY = "jobboerse-jobsuche";
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // up to 200 jobs per title × location query
const MAX_TITLES = 5;
const PUBLISHED_SINCE_DAYS = 40; // veroeffentlichtseit cap (API max 100)

type BaArbeitsort = {
  ort?: string;
  region?: string;
  plz?: string;
  land?: string;
};

type BaStellenangebot = {
  beruf?: string;
  titel?: string;
  refnr?: string;
  arbeitgeber?: string;
  arbeitsort?: BaArbeitsort;
  aktuelleVeroeffentlichungsdatum?: string;
  externeUrl?: string;
};

type BaResponse = {
  stellenangebote?: BaStellenangebot[];
};

/** Distinct query targets derived from the selected location options. */
type Target = { wo?: string; remote?: boolean };

function buildTargets(params: SearchParams): Target[] {
  const targets: Target[] = [];
  let nationwide = false;
  let remote = false;
  for (const loc of params.locations) {
    if (loc.remote) remote = true;
    else if (loc.baWo) targets.push({ wo: loc.baWo });
    else nationwide = true;
  }
  if (remote) targets.push({ remote: true });
  if (nationwide || targets.length === 0) targets.push({});
  return targets;
}

function detailUrl(item: BaStellenangebot): string {
  if (item.externeUrl) return item.externeUrl;
  const ref = item.refnr ? encodeURIComponent(item.refnr) : "";
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${ref}`;
}

function formatLocation(ort?: BaArbeitsort, remote?: boolean): string {
  if (remote && !ort?.ort) return "Remote (Germany)";
  const label = [ort?.ort, ort?.region]
    .filter((p): p is string => !!p)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .join(", ");
  return label || (remote ? "Remote (Germany)" : "Germany");
}

async function fetchOnePage(
  was: string,
  target: Target,
  page: number,
): Promise<BaStellenangebot[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set("was", was);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("veroeffentlichtseit", String(PUBLISHED_SINCE_DAYS));
  if (target.wo) {
    url.searchParams.set("wo", target.wo);
    url.searchParams.set("umkreis", "30");
  }
  if (target.remote) url.searchParams.set("arbeitszeit", "ho");

  const res = await fetchWithTimeout(url, {
    headers: { "X-API-Key": API_KEY },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`BA Jobbörse returned ${res.status} for "${was}"`);
  }
  const data = (await res.json()) as BaResponse;
  return data.stellenangebote ?? [];
}

/** Fetch every page of results (up to MAX_PAGES) for one title × location combo. */
async function fetchAllPages(
  was: string,
  target: Target,
): Promise<BaStellenangebot[]> {
  const all: BaStellenangebot[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchOnePage(was, target, page);
    all.push(...items);
    if (items.length < PAGE_SIZE) break; // last page
  }
  return all;
}

function toRawJob(item: BaStellenangebot, remote?: boolean): RawJob | null {
  if (!item.refnr) return null;
  const title = item.titel?.trim() || item.beruf?.trim();
  if (!title) return null;
  const company = item.arbeitgeber?.trim() || "Unknown company";
  const text = `${title} ${company}`;
  let publishedAt: Date | null = null;
  if (item.aktuelleVeroeffentlichungsdatum) {
    const d = new Date(item.aktuelleVeroeffentlichungsdatum);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  return {
    source: "BA_JOBBOERSE",
    externalId: item.refnr,
    title,
    company,
    location: formatLocation(item.arbeitsort, remote),
    url: detailUrl(item),
    publisher: null,
    description: "",
    jobType: inferJobType(text),
    seniority: inferSeniority(title),
    publishedAt,
  };
}

export const baJobboerse: JobSource = {
  id: "BA_JOBBOERSE",
  label: "BA Jobbörse",
  tier: "primary",
  connected: true,
  configured: async () => true, // public API, no key required

  async healthCheck() {
    const url = new URL(BASE_URL);
    url.searchParams.set("was", "designer");
    url.searchParams.set("size", "1");
    const res = await fetchWithTimeout(url, { headers: { "X-API-Key": API_KEY }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    const titles = params.jobTitles.slice(0, MAX_TITLES);
    const targets = buildTargets(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    const tasks: Promise<void>[] = [];
    for (const title of titles) {
      for (const target of targets) {
        tasks.push(
          fetchAllPages(title, target)
            .then((items) => {
              for (const item of items) {
                const raw = toRawJob(item, target.remote);
                if (raw && !seen.has(raw.externalId)) {
                  seen.add(raw.externalId);
                  jobs.push(raw);
                }
              }
            })
            .catch((err) => {
              console.error("[ba-jobboerse]", err);
            }),
        );
      }
    }
    await Promise.all(tasks);
    return jobs;
  },
};
