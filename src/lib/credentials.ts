import type { JobSourceId } from "@/generated/prisma/enums";
import { SOURCE_CREDENTIAL_SCHEMA } from "@/lib/credential-schema";
import { prisma } from "@/lib/prisma";

// NEVER log values from this module. The whole point is to keep raw key
// strings on the server side of the wire and out of stderr.

// Re-export the schema + helpers so server-side callers have one import site.
export {
  hasCredentialEditor,
  SOURCE_CREDENTIAL_SCHEMA,
} from "@/lib/credential-schema";
export type {
  CredentialField,
  SourceCredentialSchema,
} from "@/lib/credential-schema";

export type CredentialSource = "db" | "env" | "none";

// Process-singleton cache, invalidated on set/clear. Single-user app — no
// cross-instance invalidation needed.
const cache = new Map<JobSourceId, Record<string, string>>();

async function loadFromDb(
  sourceId: JobSourceId,
): Promise<{ secrets: Record<string, string>; updatedAt: Date } | null> {
  const row = await prisma.sourceCredential.findUnique({
    where: { sourceId },
  });
  if (!row) return null;
  const secrets = (row.secrets ?? {}) as Record<string, string>;
  return { secrets, updatedAt: row.updatedAt };
}

/**
 * Resolved value for a single field, DB-first, env fallback.
 * Returns undefined when neither has a non-empty value.
 */
export async function getCredential(
  sourceId: JobSourceId,
  fieldId: string,
): Promise<string | undefined> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return undefined;
  const field = schema.fields.find((f) => f.id === fieldId);
  if (!field) return undefined;

  const fromCache = cache.get(sourceId);
  if (fromCache && fromCache[fieldId]) return fromCache[fieldId];

  if (!fromCache) {
    const row = await loadFromDb(sourceId);
    if (row) {
      cache.set(sourceId, row.secrets);
      if (row.secrets[fieldId]) return row.secrets[fieldId];
    } else {
      cache.set(sourceId, {});
    }
  }

  const fromEnv = process.env[field.envFallback];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** All fields for an adapter to consume. Missing fields are simply absent. */
export async function getSourceCredentials(
  sourceId: JobSourceId,
): Promise<Record<string, string>> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return {};
  const out: Record<string, string> = {};
  for (const field of schema.fields) {
    const v = await getCredential(sourceId, field.id);
    if (v !== undefined) out[field.id] = v;
  }
  return out;
}

export async function setCredential(
  sourceId: JobSourceId,
  values: Record<string, string>,
): Promise<{ updatedAt: Date }> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) {
    throw new Error(`Source ${sourceId} has no credential editor.`);
  }
  // Trim, drop empty strings (so empty submissions don't persist as set).
  const clean: Record<string, string> = {};
  for (const field of schema.fields) {
    const raw = values[field.id];
    if (typeof raw === "string" && raw.trim().length > 0) {
      clean[field.id] = raw.trim();
    }
  }
  const row = await prisma.sourceCredential.upsert({
    where: { sourceId },
    create: { sourceId, secrets: clean },
    update: { secrets: clean },
  });
  cache.set(sourceId, clean);
  return { updatedAt: row.updatedAt };
}

export async function clearCredential(sourceId: JobSourceId): Promise<void> {
  await prisma.sourceCredential
    .delete({ where: { sourceId } })
    .catch(() => undefined); // delete is idempotent: no row, no harm
  cache.delete(sourceId);
}

export type CredentialStatus = {
  source: CredentialSource;
  configured: boolean;
  lastUpdated: Date | null;
  /** Per-field state suitable for the editor UI. Never contains the raw value. */
  fields: {
    id: string;
    label: string;
    secret: boolean;
    set: boolean;
    masked: string | null;
    source: CredentialSource;
  }[];
};

function mask(value: string): string {
  if (value.length <= 4) return "•".repeat(value.length);
  return `••••${value.slice(-4)}`;
}

export async function getCredentialStatus(
  sourceId: JobSourceId,
): Promise<CredentialStatus | null> {
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return null;

  const row = await loadFromDb(sourceId);
  // Keep the cache hot for adapters that run next.
  cache.set(sourceId, row?.secrets ?? {});

  const fields = schema.fields.map((f) => {
    const dbValue = row?.secrets[f.id];
    if (dbValue && dbValue.length > 0) {
      return {
        id: f.id,
        label: f.label,
        secret: f.secret,
        set: true,
        masked: mask(dbValue),
        source: "db" as CredentialSource,
      };
    }
    const envValue = process.env[f.envFallback];
    if (envValue && envValue.length > 0) {
      return {
        id: f.id,
        label: f.label,
        secret: f.secret,
        set: true,
        masked: mask(envValue),
        source: "env" as CredentialSource,
      };
    }
    return {
      id: f.id,
      label: f.label,
      secret: f.secret,
      set: false,
      masked: null,
      source: "none" as CredentialSource,
    };
  });

  const allSet = fields.every((f) => f.set);
  // The rollup "source" is DB if any field is satisfied from DB, otherwise env
  // if any field is satisfied from env, otherwise "none".
  let rollup: CredentialSource = "none";
  if (allSet) {
    rollup = fields.some((f) => f.source === "db") ? "db" : "env";
  }

  return {
    source: rollup,
    configured: allSet,
    lastUpdated: row?.updatedAt ?? null,
    fields,
  };
}
