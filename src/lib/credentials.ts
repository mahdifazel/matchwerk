import type { JobSourceId } from "@/generated/prisma/enums";
import { ALL_SOURCE_IDS } from "@/lib/constants";
import { SOURCE_CREDENTIAL_SCHEMA } from "@/lib/credential-schema";
import {
  clearPlatformCredential,
  getAppSetting,
  getCredentialState,
  getPlatformCredential,
  setAppSetting,
  setPlatformCredential,
  type CredentialOrigin,
} from "@/lib/platform";

// NEVER log values from this module. Source API keys are now GLOBAL platform
// secrets (managed in Admin → System Settings), resolved DB → env fallback,
// keyed by each field's canonical env-var name.

export {
  hasCredentialEditor,
  SOURCE_CREDENTIAL_SCHEMA,
} from "@/lib/credential-schema";
export type {
  CredentialField,
  SourceCredentialSchema,
} from "@/lib/credential-schema";

export type CredentialSource = CredentialOrigin;

/** All credential fields for a source, resolved globally. Missing fields absent. */
export async function getSourceCredentials(
  sourceId: JobSourceId,
): Promise<Record<string, string>> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return {};
  const out: Record<string, string> = {};
  for (const field of schema.fields) {
    const v = await getPlatformCredential(field.envFallback);
    if (v !== undefined) out[field.id] = v;
  }
  return out;
}

export type SourceFieldStatus = {
  id: string;
  label: string;
  secret: boolean;
  envFallback: string;
  set: boolean;
  masked: string | null;
  origin: CredentialSource;
};

export type SourceCredentialStatus = {
  source: CredentialSource;
  configured: boolean;
  fields: SourceFieldStatus[];
};

export async function getSourceCredentialStatus(
  sourceId: JobSourceId,
): Promise<SourceCredentialStatus | null> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return null;
  const fields: SourceFieldStatus[] = [];
  for (const f of schema.fields) {
    const state = await getCredentialState(f.envFallback);
    fields.push({
      id: f.id,
      label: f.label,
      secret: f.secret,
      envFallback: f.envFallback,
      set: state.origin !== "none",
      masked: state.masked,
      origin: state.origin,
    });
  }
  const allSet = fields.every((f) => f.set);
  const rollup: CredentialSource = allSet
    ? fields.some((f) => f.origin === "db")
      ? "db"
      : "env"
    : "none";
  return { source: rollup, configured: allSet, fields };
}

/** Sets non-empty fields; empty values are left untouched (use clear to remove). */
export async function setSourceCredentials(
  sourceId: JobSourceId,
  values: Record<string, string>,
): Promise<void> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) throw new Error(`Source ${sourceId} has no credential editor.`);
  for (const field of schema.fields) {
    const raw = values[field.id];
    if (typeof raw === "string" && raw.trim().length > 0) {
      await setPlatformCredential(field.envFallback, raw.trim());
    }
  }
}

export async function clearSourceCredentials(sourceId: JobSourceId): Promise<void> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return;
  for (const field of schema.fields) {
    await clearPlatformCredential(field.envFallback);
  }
}

// ── Global source enable/disable ─────────────────────────────────────────────

const SOURCES_DISABLED_KEY = "sources_disabled";

export async function getDisabledSourceIds(): Promise<JobSourceId[]> {
  return getAppSetting<JobSourceId[]>(SOURCES_DISABLED_KEY, []);
}

export async function setSourceEnabled(
  sourceId: JobSourceId,
  enabled: boolean,
): Promise<void> {
  const disabled = new Set(await getDisabledSourceIds());
  if (enabled) disabled.delete(sourceId);
  else disabled.add(sourceId);
  await setAppSetting<JobSourceId[]>(SOURCES_DISABLED_KEY, [...disabled]);
}

/** Source ids eligible to run in a search: all sources minus globally-disabled. */
export async function getEnabledSourceIds(): Promise<JobSourceId[]> {
  const disabled = new Set(await getDisabledSourceIds());
  return ALL_SOURCE_IDS.filter((id) => !disabled.has(id));
}
