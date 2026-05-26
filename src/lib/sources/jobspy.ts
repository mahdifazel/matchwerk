import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { JobType } from "@/generated/prisma/enums";
import { inferJobType, inferSeniority } from "@/lib/infer";
import type { JobSource, RawJob, SearchParams } from "./types";

const PROJECT_ROOT = process.cwd();
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv-jobspy", "bin", "python");
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "jobspy_bridge.py");
const TIMEOUT_MS = 120_000; // 2 minutes — scraping is slow
const MAX_TITLES = 3;
const HOURS_OLD = 24 * 7;
const RESULTS_WANTED = 25;

// Indeed + Glassdoor only by default — LinkedIn aggressively blocks scrapers
// and tends to ruin runs. Set JOBSPY_SITES env to override (comma-separated).
const DEFAULT_SITES = ["indeed", "glassdoor"];

type JobSpyJob = {
  id?: string;
  site?: string;
  title?: string;
  company?: string;
  location?: string;
  job_url?: string;
  job_url_direct?: string | null;
  description?: string | null;
  job_type?: string | null;
  is_remote?: boolean | null;
  date_posted?: string | null;
};

function mapJobType(value: string | null | undefined, title: string): JobType {
  if (!value) return inferJobType(title);
  const v = value.toLowerCase();
  if (v.includes("fulltime") || v.includes("full")) return "FULL_TIME";
  if (v.includes("parttime") || v.includes("part")) return "PART_TIME";
  if (v.includes("contract")) return "CONTRACT";
  if (v.includes("intern")) return "INTERNSHIP";
  if (v.includes("freelance") || v.includes("temporary")) return "FREELANCE";
  return inferJobType(title);
}

function buildLocations(params: SearchParams): {
  location: string;
  isRemote: boolean;
}[] {
  const out: { location: string; isRemote: boolean }[] = [];
  let nationwide = false;
  for (const loc of params.locations) {
    if (loc.remote) out.push({ location: "Germany", isRemote: true });
    else if (loc.baWo) out.push({ location: `${loc.baWo}, Germany`, isRemote: false });
    else nationwide = true;
  }
  if (nationwide || out.length === 0) {
    out.push({ location: "Germany", isRemote: false });
  }
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = `${o.location}|${o.isRemote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runBridge(payload: object): Promise<JobSpyJob[]> {
  return new Promise((resolve) => {
    const proc = spawn(VENV_PYTHON, [BRIDGE_SCRIPT, JSON.stringify(payload)], {
      cwd: PROJECT_ROOT,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (stderr.trim()) console.warn("[jobspy]", stderr.trim());
      if (code !== 0) {
        console.error(`[jobspy] bridge exited with code ${code}`);
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as JobSpyJob[]);
      } catch (err) {
        console.error("[jobspy] could not parse bridge output:", err);
        resolve([]);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      console.error("[jobspy] could not spawn bridge:", err);
      resolve([]);
    });
  });
}

function toRawJob(job: JobSpyJob): RawJob | null {
  const ext = job.id || job.job_url;
  if (!ext || !job.title) return null;
  const title = job.title.trim();
  const company = job.company?.trim() || "Unknown company";
  const baseLocation = job.location?.trim() || "Germany";
  const location = job.is_remote ? `Remote · ${baseLocation}` : baseLocation;
  let publishedAt: Date | null = null;
  if (job.date_posted) {
    const d = new Date(job.date_posted);
    if (!Number.isNaN(d.getTime())) publishedAt = d;
  }
  const sitePretty = job.site
    ? job.site[0]?.toUpperCase() + job.site.slice(1)
    : null;
  return {
    source: "JOBSPY",
    externalId: `js-${ext}`,
    title,
    company,
    location,
    url: job.job_url_direct || job.job_url || "",
    publisher: sitePretty,
    description: job.description?.slice(0, 4000) ?? "",
    jobType: mapJobType(job.job_type, title),
    seniority: inferSeniority(title),
    publishedAt,
  };
}

/**
 * Scraping-based fallback via the open-source `python-jobspy` library. Spawns
 * `scripts/jobspy_bridge.py` inside `.venv-jobspy/`. The orchestrator only
 * queries this tier when the primary tier returns too few jobs.
 *
 * Bootstrap (one-time): `python3.12 -m venv .venv-jobspy &&
 * .venv-jobspy/bin/pip install python-jobspy`.
 */
export const jobspy: JobSource = {
  id: "JOBSPY",
  label: "JobSpy",
  tier: "fallback",
  connected: true,
  configured: async () => existsSync(VENV_PYTHON) && existsSync(BRIDGE_SCRIPT),

  async healthCheck() {
    if (!existsSync(VENV_PYTHON) || !existsSync(BRIDGE_SCRIPT)) {
      throw new Error("Python venv or bridge script missing.");
    }
  },

  async search(params: SearchParams): Promise<RawJob[]> {
    if (!existsSync(VENV_PYTHON) || !existsSync(BRIDGE_SCRIPT)) {
      console.warn(
        "[jobspy] skipping — venv or bridge missing. " +
          "Run: python3.12 -m venv .venv-jobspy && .venv-jobspy/bin/pip install python-jobspy",
      );
      return [];
    }

    const titles = params.jobTitles.slice(0, MAX_TITLES);
    if (titles.length === 0) return [];
    const sites =
      process.env.JOBSPY_SITES?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? DEFAULT_SITES;
    const locations = buildLocations(params);
    const seen = new Set<string>();
    const jobs: RawJob[] = [];

    // Scraping requests in parallel risk rate-limiting; run locations serially.
    for (const { location, isRemote } of locations) {
      const items = await runBridge({
        job_titles: titles,
        location,
        is_remote: isRemote,
        results_wanted: RESULTS_WANTED,
        hours_old: HOURS_OLD,
        sites,
      });
      for (const item of items) {
        const raw = toRawJob(item);
        if (raw && !seen.has(raw.externalId)) {
          seen.add(raw.externalId);
          jobs.push(raw);
        }
      }
    }
    return jobs;
  },
};
