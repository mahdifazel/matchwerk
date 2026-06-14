import { JobSourceId, JobStatus, JobType, Seniority } from "@/generated/prisma/enums";

export const DEFAULT_JOB_TITLES = [
  "Product Designer",
  "Senior Product Designer",
  "UX/UI Designer",
  "UX Designer",
];

export type LocationOption = {
  id: string;
  label: string;
  /** Value sent to BA Jobbörse `wo` param. null = nationwide. */
  baWo: string | null;
  remote?: boolean;
};

export const LOCATION_OPTIONS: LocationOption[] = [
  { id: "berlin", label: "Berlin", baWo: "Berlin" },
  { id: "munich", label: "Munich", baWo: "München" },
  { id: "hamburg", label: "Hamburg", baWo: "Hamburg" },
  { id: "remote", label: "Remote (Germany)", baWo: null, remote: true },
  { id: "all", label: "All Germany", baWo: null },
];

export const SENIORITY_OPTIONS: { id: Seniority; label: string }[] = [
  { id: "JUNIOR", label: "Junior" },
  { id: "MID", label: "Mid-level" },
  { id: "SENIOR", label: "Senior" },
  { id: "LEAD", label: "Lead" },
];

export const JOB_TYPE_OPTIONS: { id: JobType; label: string }[] = [
  { id: "FULL_TIME", label: "Full-time" },
  { id: "CONTRACT", label: "Contract" },
  { id: "FREELANCE", label: "Freelance" },
  { id: "INTERNSHIP", label: "Internship" },
];

export type DatePostedId = "any" | "24h" | "1w" | "2w" | "1m";

export const DATE_POSTED_OPTIONS: { id: DatePostedId; label: string; days: number | null }[] = [
  { id: "any", label: "Any time", days: null },
  { id: "24h", label: "Past 24 hours", days: 1 },
  { id: "1w", label: "Past week", days: 7 },
  { id: "2w", label: "Past 2 weeks", days: 14 },
  { id: "1m", label: "Past month", days: 30 },
];

export type SourceMeta = {
  id: JobSourceId;
  label: string;
  tier: "primary" | "backup" | "fallback";
  /** Adapter is implemented (runtime key status comes from GET /api/sources). */
  connected: boolean;
  /** Short note shown in the UI. */
  note?: string;
};

export const SOURCE_META: SourceMeta[] = [
  {
    id: "BA_JOBBOERSE",
    label: "BA Jobbörse",
    tier: "primary",
    connected: true,
    note: "Free public German API",
  },
  {
    id: "JSEARCH",
    label: "JSearch",
    tier: "primary",
    connected: true,
    note: "LinkedIn · Indeed · Glassdoor · ZipRecruiter",
  },
  {
    id: "FANTASTIC_JOBS",
    label: "Fantastic.jobs",
    tier: "primary",
    connected: true,
    note: "Career-site listings via 54 ATS platforms, refreshed hourly",
  },
  {
    id: "ADZUNA",
    label: "Adzuna",
    tier: "backup",
    connected: true,
    note: "Germany/EU backup when JSearch is short",
  },
  {
    id: "JOOBLE",
    label: "Jooble",
    tier: "backup",
    connected: true,
    note: "Aggregator with strong EU coverage · jooble.org",
  },
];

export const ALL_SOURCE_IDS: JobSourceId[] = SOURCE_META.map((s) => s.id);
export const ALL_SENIORITY: Seniority[] = SENIORITY_OPTIONS.map((s) => s.id);
export const ALL_JOB_TYPES: JobType[] = JOB_TYPE_OPTIONS.map((t) => t.id);
export const ALL_LOCATION_IDS: string[] = LOCATION_OPTIONS.map((l) => l.id);

/**
 * Language filter — German and English only. Mapped against
 * `Job.requiredLanguages` (normalised "de"/"en" emitted by the scorer).
 * Per the product rule, an *empty* `requiredLanguages` means English is
 * sufficient (no German requirement = the post is open to English speakers).
 */
export type LanguageOption = { id: "de" | "en"; label: string };
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: "de", label: "German" },
  { id: "en", label: "English" },
];
export const ALL_LANGUAGE_IDS: LanguageOption["id"][] = LANGUAGE_OPTIONS.map(
  (l) => l.id,
);

export const TAB_STATUSES: Record<string, JobStatus> = {
  inbox: "NEW",
  starred: "STARRED",
  applied: "APPLIED",
  interviewing: "INTERVIEWING",
  offer: "OFFER",
  archived: "ARCHIVED",
};
