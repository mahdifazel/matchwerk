import type { JobSourceId } from "@/generated/prisma/enums";

export type CredentialField = {
  id: string;
  label: string;
  envFallback: string;
  secret: boolean;
};

export type SourceCredentialSchema = {
  fields: CredentialField[];
};

/**
 * The only place that knows what fields each source needs. Client-safe (no
 * Prisma or process.env). Sources NOT listed here have no editable
 * credential (BA Jobbörse: public API; JobSpy: no remote API).
 */
export const SOURCE_CREDENTIAL_SCHEMA: Partial<
  Record<JobSourceId, SourceCredentialSchema>
> = {
  JSEARCH: {
    fields: [
      {
        id: "apiKey",
        label: "RapidAPI key",
        envFallback: "JSEARCH_API_KEY",
        secret: true,
      },
    ],
  },
  FANTASTIC_JOBS: {
    fields: [
      {
        id: "apiKey",
        label: "RapidAPI key",
        envFallback: "FANTASTIC_JOBS_API_KEY",
        secret: true,
      },
    ],
  },
  ADZUNA: {
    fields: [
      {
        id: "appId",
        label: "App ID",
        envFallback: "ADZUNA_APP_ID",
        secret: false,
      },
      {
        id: "appKey",
        label: "App Key",
        envFallback: "ADZUNA_APP_KEY",
        secret: true,
      },
    ],
  },
  JOOBLE: {
    fields: [
      {
        id: "apiKey",
        label: "API key",
        envFallback: "JOOBLE_API_KEY",
        secret: true,
      },
    ],
  },
};

export function hasCredentialEditor(sourceId: JobSourceId): boolean {
  return Boolean(SOURCE_CREDENTIAL_SCHEMA[sourceId]);
}

export const EDITABLE_SOURCE_IDS: JobSourceId[] = (
  Object.keys(SOURCE_CREDENTIAL_SCHEMA) as JobSourceId[]
).filter((id) => Boolean(SOURCE_CREDENTIAL_SCHEMA[id]));
