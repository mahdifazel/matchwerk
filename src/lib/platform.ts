import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Global platform config + secrets. NEVER log raw values from here.

// Per-process caches, invalidated on write.
const credCache = new Map<string, string | null>();
const settingCache = new Map<string, unknown>();

/**
 * Resolves a global credential by canonical name (the env-var name), DB row
 * first, then `process.env` fallback. Returns undefined when neither has a
 * non-empty value.
 */
export async function getPlatformCredential(
  name: string,
): Promise<string | undefined> {
  if (!credCache.has(name)) {
    const row = await prisma.platformCredential.findUnique({ where: { name } });
    credCache.set(name, row?.value ?? null);
  }
  const fromDb = credCache.get(name);
  if (fromDb) return fromDb;
  const fromEnv = process.env[name];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export async function setPlatformCredential(
  name: string,
  value: string,
): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    await clearPlatformCredential(name);
    return;
  }
  await prisma.platformCredential.upsert({
    where: { name },
    create: { name, value: trimmed },
    update: { value: trimmed },
  });
  credCache.set(name, trimmed);
}

export async function clearPlatformCredential(name: string): Promise<void> {
  await prisma.platformCredential
    .delete({ where: { name } })
    .catch(() => undefined);
  credCache.delete(name);
}

export type CredentialOrigin = "db" | "env" | "none";

/** Masked status for a credential — never reveals the raw value. */
export async function getCredentialState(name: string): Promise<{
  origin: CredentialOrigin;
  masked: string | null;
}> {
  const row = await prisma.platformCredential.findUnique({ where: { name } });
  if (row?.value) return { origin: "db", masked: mask(row.value) };
  const env = process.env[name];
  if (env && env.length > 0) return { origin: "env", masked: mask(env) };
  return { origin: "none", masked: null };
}

function mask(value: string): string {
  if (value.length <= 4) return "•".repeat(value.length);
  return `••••${value.slice(-4)}`;
}

// ── Generic JSON settings ───────────────────────────────────────────────────

export async function getAppSetting<T>(key: string, fallback: T): Promise<T> {
  if (settingCache.has(key)) return settingCache.get(key) as T;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as T | undefined) ?? fallback;
  settingCache.set(key, value);
  return value;
}

export async function setAppSetting<T>(key: string, value: T): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  settingCache.set(key, value);
}
