import { adzuna } from "./adzuna";
import { baJobboerse } from "./ba-jobboerse";
import { fantasticJobs } from "./fantastic-jobs";
import { jooble } from "./jooble";
import { jsearch } from "./jsearch";
import type { JobSource } from "./types";

/** Every source the app knows about, in tier order. */
export const ALL_SOURCES: JobSource[] = [
  baJobboerse, // primary  — free public German API
  jsearch, // primary  — RapidAPI aggregator (LinkedIn/Indeed/Glassdoor/ZipRecruiter)
  fantasticJobs, // primary  — RapidAPI Active Jobs DB (3M+ career-site listings)
  adzuna, // backup   — Germany/EU coverage, used when JSearch is short
  jooble, // backup   — Jooble aggregator (jooble.org), free tier
];

/** Sources with a working adapter implementation. */
export const CONNECTED_SOURCES: JobSource[] = ALL_SOURCES.filter(
  (s) => s.connected,
);

export { searchEnabledSources } from "./search";
export type { JobSource, RawJob, SearchParams, SourceTier } from "./types";
