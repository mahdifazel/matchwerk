import {
  ArchiveReason,
  InterviewStage,
  JobSourceId,
  JobStatus,
  JobType,
  Seniority,
} from "@/generated/prisma/enums";

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

/** Statuses surfaced together in the Pipeline (spreadsheet) view. */
export const PIPELINE_STATUSES: JobStatus[] = [
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "ARCHIVED",
];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  NEW: "Inbox",
  STARRED: "Starred",
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  ARCHIVED: "Archived",
  DELETED: "Removed",
};

/**
 * The "Stage" value shown in the Pipeline table. Applied is always "Pending"
 * and Offer is always "Thinking"; Interviewing/Archived show the user-selected
 * sub-stage / outcome (falling back to "Not set" when none chosen yet).
 */
export function pipelineStageLabel(
  status: JobStatus,
  interviewStage: InterviewStage | null,
  archiveReason: ArchiveReason | null,
): string {
  switch (status) {
    case "APPLIED":
      return "Pending";
    case "OFFER":
      return "Thinking";
    case "INTERVIEWING": {
      const s = INTERVIEW_STAGES.find((x) => x.id === interviewStage);
      return s ? (s.short ?? s.label) : "Not set";
    }
    case "ARCHIVED": {
      const r = ARCHIVE_REASONS.find((x) => x.id === archiveReason);
      return r ? (r.short ?? r.label) : "Not set";
    }
    default:
      return "";
  }
}

/**
 * Color-coded sub-stages + outcomes shown on the board. `badge` styles the
 * pill on the card; `dot` styles the swatch in the picker menu. Classes follow
 * the existing palette pattern (border-X/30 bg-X/10 text-X-700 dark:text-X-400).
 */
export type StatusOption<T extends string> = {
  id: T;
  label: string;
  /** Compact label for tight surfaces (e.g. the Pipeline table). Falls back
   * to `label` where unset. */
  short?: string;
  badge: string;
  dot: string;
};

export const INTERVIEW_STAGES: StatusOption<InterviewStage>[] = [
  {
    id: "RECRUITER_SCREEN",
    label: "Recruiter Screen",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  {
    id: "HIRING_MANAGER",
    label: "Hiring Manager Interview",
    short: "Hiring Manager",
    badge:
      "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
    dot: "bg-indigo-500",
  },
  {
    id: "TECHNICAL",
    label: "Technical Interview",
    badge:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  {
    id: "TAKE_HOME",
    label: "Take-Home Assignment",
    short: "Home Assignment",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  {
    id: "PANEL",
    label: "Panel Interview",
    badge: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
    dot: "bg-teal-500",
  },
  {
    id: "FINAL",
    label: "Final Interview",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  {
    id: "WAITING_DECISION",
    label: "Waiting for Decision",
    badge: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    dot: "bg-zinc-500",
  },
];

export const ARCHIVE_REASONS: StatusOption<ArchiveReason>[] = [
  {
    id: "REJECTED",
    label: "Rejected",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
    dot: "bg-rose-500",
  },
  {
    id: "WITHDRAWN",
    label: "Withdrawn",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  {
    id: "CLOSED",
    label: "Closed",
    badge: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    dot: "bg-zinc-500",
  },
];
