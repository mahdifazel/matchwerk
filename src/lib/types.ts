import type {
  ArchiveReason,
  InterviewStage,
  JobSourceId,
  JobStatus,
  JobType,
  Seniority,
} from "@/generated/prisma/enums";

/** Job as serialized over the API (dates become ISO strings). */
export type JobDTO = {
  id: string;
  source: JobSourceId;
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  publisher: string | null;
  description: string;
  jobType: JobType;
  seniority: Seniority;
  publishedAt: string | null;
  matchScore: number | null;
  matchExplanation: string | null;
  missingSkills: string[];
  /** Normalised language codes (e.g. ["de"]) the job explicitly requires. */
  requiredLanguages: string[];
  scoredAt: string | null;
  status: JobStatus;
  appliedAt: string | null;
  /** Set while status = INTERVIEWING (color-coded sub-stage). */
  interviewStage: InterviewStage | null;
  /** Set while status = ARCHIVED (outcome). */
  archiveReason: ArchiveReason | null;
  /** Free-text note, editable inline in the Pipeline table. */
  note: string;
  fetchedAt: string;
};

export type ProfileDTO = {
  id: string;
  fileName: string;
  summary: string;
  skills: string[];
  tools: string[];
  industries: string[];
  /** Languages the candidate speaks (free text, e.g. "German (native)"). */
  languages: string[];
  keywords: string[];
  seniority: Seniority;
  yearsExperience: number;
  parsedAt: string;
  updatedAt: string;
};

export type SettingsDTO = {
  id: string;
  jobTitles: string[];
  defaultLocations: string[];
  defaultSeniority: Seniority[];
  defaultJobTypes: JobType[];
  defaultSources: JobSourceId[];
  updatedAt: string;
};

export type SourceRunReportDTO = {
  id: JobSourceId;
  ran: boolean;
  count: number;
  skippedReason?: string;
};

export type RefreshResult = {
  added: number;
  scanned: number;
  reports: SourceRunReportDTO[];
  /** IDs of jobs inserted by this run (flagged with a "New" badge in the board). */
  newJobIds: string[];
  tokens?: { balance: number; charged: number; debtAdded: number };
};

export type SourceStatusDTO = {
  id: JobSourceId;
  label: string;
  tier: "primary" | "backup" | "fallback";
  /** Adapter is implemented. */
  connected: boolean;
  /** Required credentials are present (in DB or env). */
  configured: boolean;
  /** Whether this source has an in-app credential editor. */
  editable: boolean;
  /** Where the active credential comes from. */
  credentialSource: "db" | "env" | "none";
};

export type CredentialFieldStatusDTO = {
  id: string;
  label: string;
  secret: boolean;
  set: boolean;
  masked: string | null;
  source: "db" | "env" | "none";
};

export type CredentialStatusDTO = {
  source: "db" | "env" | "none";
  configured: boolean;
  lastUpdated: string | null;
  fields: CredentialFieldStatusDTO[];
};
