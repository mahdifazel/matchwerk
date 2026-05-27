import { AI_PROVIDERS, AI_PROVIDER_ORDER } from "@/lib/ai";
import { ALL_SOURCES } from "@/lib/sources";

export type HealthResult = {
  id: string;
  label: string;
  kind: "ai" | "source";
  configured: boolean;
  ok: boolean;
  /**
   * The dependency answered but is throttled (HTTP 429 / quota exhausted). The
   * integration works — it's just rate-limited right now — so the UI surfaces
   * this as a distinct amber state rather than a red "down".
   */
  rateLimited: boolean;
  latencyMs: number | null;
  error: string | null;
};

/** A 429 / quota / rate-limit response means "working but throttled", not down. */
function isRateLimit(e: unknown): boolean {
  const status =
    typeof e === "object" && e !== null
      ? ((e as { status?: unknown; statusCode?: unknown }).status ??
        (e as { statusCode?: unknown }).statusCode)
      : undefined;
  if (status === 429) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /(^|\D)429(\D|$)|rate.?limit|too many requests|exceeded.*quota|quota.*exceeded/i.test(
    message,
  );
}

async function timed(fn: () => Promise<void>): Promise<{
  ok: boolean;
  rateLimited: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, rateLimited: false, latencyMs: Date.now() - start, error: null };
  } catch (e) {
    return {
      ok: false,
      rateLimited: isRateLimit(e),
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Live health check of every external API (AI providers + job sources). Each
 * configured dependency gets one lightweight request; unconfigured ones are
 * reported without a probe. Runs in parallel.
 */
export async function checkAllApis(): Promise<HealthResult[]> {
  const ai = AI_PROVIDER_ORDER.map(async (id): Promise<HealthResult> => {
    const provider = AI_PROVIDERS[id];
    if (!(await provider.isConfigured())) {
      return { id, label: provider.label, kind: "ai", configured: false, ok: false, rateLimited: false, latencyMs: null, error: null };
    }
    const r = await timed(() => provider.ping());
    return { id, label: provider.label, kind: "ai", configured: true, ...r };
  });

  const sources = ALL_SOURCES.map(async (s): Promise<HealthResult> => {
    if (!(await s.configured())) {
      return { id: s.id, label: s.label, kind: "source", configured: false, ok: false, rateLimited: false, latencyMs: null, error: null };
    }
    const r = await timed(() => s.healthCheck());
    return { id: s.id, label: s.label, kind: "source", configured: true, ...r };
  });

  return Promise.all([...ai, ...sources]);
}
