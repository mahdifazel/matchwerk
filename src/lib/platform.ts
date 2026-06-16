import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Global platform config + secrets. NEVER log raw values from here.

// Per-process caches with a short TTL. The TTL matters because the app runs as
// MANY concurrent serverless instances, each with its own cache: a write only
// updates the DB + the writing instance's cache, so without expiry every other
// instance would serve its stale snapshot forever (e.g. the AI "active provider"
// appearing to flip between values on refresh as the load balancer hits
// different instances). The TTL bounds that divergence — within TTL_MS every
// instance re-reads the DB and the fleet converges. Reads that must be exact
// right now (admin dashboard) can pass { fresh: true } to bypass the cache.
const CACHE_TTL_MS = 30_000;

type CacheEntry<T> = { value: T; expires: number };
const credCache = new Map<string, CacheEntry<string | null>>();
const settingCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): { hit: boolean; value?: T } {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return { hit: true, value: entry.value };
  if (entry) cache.delete(key);
  return { hit: false };
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Resolves a global credential by canonical name (the env-var name), DB row
 * first, then `process.env` fallback. Returns undefined when neither has a
 * non-empty value. Pass { fresh: true } to skip the per-process cache.
 */
export async function getPlatformCredential(
  name: string,
  opts?: { fresh?: boolean },
): Promise<string | undefined> {
  let cached = opts?.fresh ? { hit: false as const } : cacheGet(credCache, name);
  if (!cached.hit) {
    const row = await prisma.platformCredential.findUnique({ where: { name } });
    cacheSet(credCache, name, row?.value ?? null);
    cached = { hit: true, value: row?.value ?? null };
  }
  const fromDb = cached.value;
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
  cacheSet(credCache, name, trimmed);
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

export async function getAppSetting<T>(
  key: string,
  fallback: T,
  opts?: { fresh?: boolean },
): Promise<T> {
  if (!opts?.fresh) {
    const cached = cacheGet(settingCache, key);
    if (cached.hit) return cached.value as T;
  }
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as T | undefined) ?? fallback;
  cacheSet(settingCache, key, value);
  return value;
}

export async function setAppSetting<T>(key: string, value: T): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
  cacheSet(settingCache, key, value);
}
