import type { Seniority } from "@/generated/prisma/enums";

export type AiProviderId = "claude" | "gemini";

export type ParsedCvProfile = {
  summary: string;
  skills: string[];
  tools: string[];
  industries: string[];
  keywords: string[];
  seniority: Seniority;
  yearsExperience: number;
  /** Exactly 3 role titles tailored to the candidate — pre-fills Settings.jobTitles. */
  suggestedJobTitles: string[];
};

export type RawJobScore = {
  id: string;
  score: number;
  explanation: string;
  missingSkills: string[];
};

/**
 * An interchangeable AI backend. Each provider implements the two structured
 * operations the app needs (CV parsing and batched job scoring) and reports
 * whether it has an API key configured.
 */
export interface AiProvider {
  id: AiProviderId;
  label: string;
  isConfigured(): Promise<boolean>;
  /** Lightweight liveness check — throws if the key/endpoint isn't healthy. */
  ping(): Promise<void>;
  parseCvProfile(rawText: string): Promise<ParsedCvProfile>;
  /** Raw scores for a batch; the caller clamps/validates. */
  scoreBatch(systemPrompt: string, userPrompt: string): Promise<RawJobScore[]>;
}

const SENIORITY_VALUES: Seniority[] = ["JUNIOR", "MID", "SENIOR", "LEAD", "UNKNOWN"];

/** Coerce a provider's best-effort output into a clean ParsedCvProfile. */
export function normalizeCvProfile(input: Partial<ParsedCvProfile>): ParsedCvProfile {
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];
  const seniority = SENIORITY_VALUES.includes(input.seniority as Seniority)
    ? (input.seniority as Seniority)
    : "UNKNOWN";
  return {
    summary: typeof input.summary === "string" ? input.summary : "",
    skills: list(input.skills),
    tools: list(input.tools),
    industries: list(input.industries),
    keywords: list(input.keywords),
    seniority,
    yearsExperience:
      typeof input.yearsExperience === "number" && input.yearsExperience >= 0
        ? Math.round(input.yearsExperience)
        : 0,
    suggestedJobTitles: list(input.suggestedJobTitles).slice(0, 3),
  };
}
