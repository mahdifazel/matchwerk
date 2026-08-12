import { inferJobType, inferSeniority } from "@/lib/infer";
import { fetchWithTimeout } from "./http";
import type { JobSource, RawJob, SearchParams } from "./types";

// v4 was retired (now returns 403 for every request); v6 is the current
// endpoint used by the official Jobsuche app. Same X-API-Key, new response
// shape (see the type defs below — field names changed across the board).
const BASE_URL =
  "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
const API_KEY = "jobboerse-jobsuche";
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // up to 200 jobs per title × location query
const MAX_TITLES = 5;
const PUBLISHED_SINCE_DAYS = 40; // veroeffentlichtseit cap (API max 100)

type BaAdresse = {
  ort?: string;
  region?: string;
  plz?: string;
  land?: string;
};

type BaStellenlokation = {
  adresse?: BaAdresse;
};

type BaStellenangebot = {
  hauptberuf?: string;
  stellenangebotsTitel?: string;
  referenznummer?: string;
  firma?: string;
  stellenlokationen?: BaStellenlokation[];
  veroeffentlichungszeitraum?: { von?: string };
  datumErsteVeroeffentlichung?: string;
  homeofficemoeglich?: boolean;
  externeURL?: string;
};

type BaResponse = {
  ergebnisliste?: BaStellenangebot[];
};

/** Distinct query targets derived from the selected location options. */
type Target = { wo?: string };

function buildTargets(params: SearchParams): Target[] {
  const targets: Target[] = [];
  let nationwide = false;
  let remote = false;
  for (const loc of params.locations) {
    if (loc.remote) remote = true;
    else if (loc.baWo) targets.push({ wo: loc.baWo });
    else nationwide = true;
  }
  // The v6 API dropped a working server-side "home office only" filter
  // (arbeitszeit=ho is accepted but silently matches zero listings now), so a
  // Remote selection folds into an unfiltered nationwide query instead of a
  // dead one — remote-ness is read back per listing via `homeofficemoeglich`.
  if (remote || nationwide || targets.length === 0) targets.push({});
  return targets;
}

function detailUrl(item: BaStellenangebot): string {
  if (item.externeURL) return item.externeURL;
  const ref = item.referenznummer
    ? encodeURIComponent(item.referenznummer)
    : "";
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${ref}`;
}

function formatLocation(ort?: BaAdresse, homeoffice?: boolean): string {
  if (homeoffice && !ort?.ort) return "Remote (Germany)";
  const label = [ort?.ort, ort?.region]
    .filter((p): p is string => !!p)
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .join(", ");
  return label || (homeoffice ? "Remote (Germany)" : "Germany");
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

  const res = await fetchWithTimeout(url, {
    headers: { "X-API-Key": API_KEY },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`BA Jobbörse returned ${res.status} for "${was}"`);
  }
  const data = (await res.json()) as BaResponse;
  return data.ergebnisliste ?? [];
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

function toRawJob(item: BaStellenangebot): RawJob | null {
  if (!item.referenznummer) return null;
  const title = item.stellenangebotsTitel?.trim() || item.hauptberuf?.trim();
  if (!title) return null;
  const company = item.firma?.trim() || "Unknown company";
  const text = `${title} ${company}`;
  let publishedAt: Date | null = null;
  const publishedRaw =
    item.veroeffentlichungszeitraum?.von || item.datumErsteVeroeffentlichung;
  if (publishedRaw) {
    const d = new Date(publishedRaw);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  return {
    source: "BA_JOBBOERSE",
    externalId: item.referenznummer,
    title,
    company,
    location: formatLocation(
      item.stellenlokationen?.[0]?.adresse,
      item.homeofficemoeglich,
    ),
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
                const raw = toRawJob(item);
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
