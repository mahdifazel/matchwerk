import type { JobSourceId, JobType, Seniority } from "@/generated/prisma/enums";
import type { LocationOption } from "@/lib/constants";

/** A job listing as returned by a source adapter, before scoring/persistence. */
export type RawJob = {
  source: JobSourceId;
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  /** Underlying platform for aggregator sources (e.g. "LinkedIn"). */
  publisher: string | null;
  description: string;
  jobType: JobType;
  seniority: Seniority;
  publishedAt: Date | null;
};

export type SearchParams = {
  /** The user whose credentials and workspace this search runs against. */
  userId: string;
  /** Target job titles from user Settings. */
  jobTitles: string[];
  /** Selected location options to search within. */
  locations: LocationOption[];
};

/** Which tier a source belongs to in the search orchestrator. */
export type SourceTier = "primary" | "backup" | "fallback";

export interface JobSource {
  id: JobSourceId;
  label: string;
  tier: SourceTier;
  /** False for sources without a working adapter (e.g. JobSpy). */
  connected: boolean;
  /** True when required credentials are present — global platform key or env fallback. */
  configured(): Promise<boolean>;
  /** Lightweight liveness probe — throws if the source isn't reachable/healthy. */
  healthCheck(): Promise<void>;
  search(params: SearchParams): Promise<RawJob[]>;
}
