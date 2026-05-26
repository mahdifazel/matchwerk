import { AI_PROVIDERS, AI_PROVIDER_ORDER } from "@/lib/ai";
import { ALL_SOURCES } from "@/lib/sources";

export type HealthResult = {
  id: string;
  label: string;
  kind: "ai" | "source";
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
};

async function timed(fn: () => Promise<void>): Promise<{
  ok: boolean;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (e) {
    return {
      ok: false,
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
      return { id, label: provider.label, kind: "ai", configured: false, ok: false, latencyMs: null, error: null };
    }
    const r = await timed(() => provider.ping());
    return { id, label: provider.label, kind: "ai", configured: true, ...r };
  });

  const sources = ALL_SOURCES.map(async (s): Promise<HealthResult> => {
    if (!(await s.configured())) {
      return { id: s.id, label: s.label, kind: "source", configured: false, ok: false, latencyMs: null, error: null };
    }
    const r = await timed(() => s.healthCheck());
    return { id: s.id, label: s.label, kind: "source", configured: true, ...r };
  });

  return Promise.all([...ai, ...sources]);
}
