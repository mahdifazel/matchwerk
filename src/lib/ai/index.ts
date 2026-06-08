import { getAppSetting, setAppSetting } from "@/lib/platform";
import { logAiAttempt } from "@/lib/request-log";
import { CLAUDE_MODELS, claudeProvider } from "./claude";
import { GEMINI_MODELS, geminiProvider } from "./gemini";
import { GROQ_MODELS, groqProvider } from "./groq";
import type { AiProvider, AiProviderId } from "./types";

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  groq: groqProvider,
};

/** Canonical display order. */
export const AI_PROVIDER_ORDER: AiProviderId[] = ["gemini", "groq", "claude"];

const MODELS: Record<AiProviderId, { cvParse: string; scoring: string }> = {
  claude: CLAUDE_MODELS,
  gemini: GEMINI_MODELS,
  groq: GROQ_MODELS,
};

const ENV_KEY_NAME: Record<AiProviderId, string> = {
  claude: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
};

export type AiConfig = {
  active: AiProviderId;
  /** Ordered fallback chain (tried after `active`, in order). */
  fallback: AiProviderId[];
  enabled: Record<AiProviderId, boolean>;
};

const SETTING_KEY = "ai_providers";
const DEFAULT_CONFIG: AiConfig = {
  active: "claude",
  // Canonical priority — Groq (free) sits between Gemini and Claude.
  fallback: ["gemini", "groq", "claude"],
  enabled: { claude: true, gemini: true, groq: true },
};

/**
 * Repair a stored fallback array so a newly-added provider is honoured without a
 * manual re-save: drop unknown ids, then insert any missing known provider at its
 * canonical position (from DEFAULT_CONFIG.fallback). E.g. a pre-Groq stored value
 * `["claude","gemini"]` becomes `["groq","claude","gemini"]`.
 */
function reconcileFallback(stored?: AiProviderId[]): AiProviderId[] {
  const canonical = DEFAULT_CONFIG.fallback;
  const base = (stored?.length ? stored : canonical).filter((id) =>
    canonical.includes(id),
  );
  for (const id of canonical) {
    if (base.includes(id)) continue;
    const rank = canonical.indexOf(id);
    const at = base.findIndex((b) => canonical.indexOf(b) > rank);
    if (at === -1) base.push(id);
    else base.splice(at, 0, id);
  }
  return base;
}

export async function getAiConfig(): Promise<AiConfig> {
  const cfg = await getAppSetting<Partial<AiConfig>>(SETTING_KEY, DEFAULT_CONFIG);
  return {
    active: cfg.active ?? DEFAULT_CONFIG.active,
    fallback: reconcileFallback(cfg.fallback),
    enabled: { ...DEFAULT_CONFIG.enabled, ...cfg.enabled },
  };
}

export async function setAiConfig(cfg: AiConfig): Promise<void> {
  await setAppSetting(SETTING_KEY, cfg);
}

/** Providers to try in order: active first, then the fallback chain; enabled only. */
async function buildChain(): Promise<AiProvider[]> {
  const cfg = await getAiConfig();
  const order = [cfg.active, ...cfg.fallback];
  const seen = new Set<AiProviderId>();
  const chain: AiProvider[] = [];
  for (const id of order) {
    if (seen.has(id) || !cfg.enabled[id]) continue;
    seen.add(id);
    chain.push(AI_PROVIDERS[id]);
  }
  return chain;
}

/**
 * Runs `fn` against the first enabled+configured provider, falling through the
 * chain on error. Throws if no provider can serve the request.
 */
export async function runWithAi<T>(
  fn: (p: AiProvider) => Promise<T>,
  operation?: string,
): Promise<T> {
  const chain = await buildChain();
  let lastError: unknown = null;
  let tried = false;
  for (const provider of chain) {
    if (!(await provider.isConfigured())) continue;
    tried = true;
    const start = Date.now();
    try {
      const result = await fn(provider);
      await logAiAttempt({ provider: provider.id, operation, ok: true, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      await logAiAttempt({
        provider: provider.id,
        operation,
        ok: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      console.error(`[ai] provider "${provider.id}" failed, trying next:`, err);
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  if (!tried) {
    throw new Error(
      "No AI provider is configured. Add an API key in Admin → System Settings.",
    );
  }
  throw new Error("AI request failed across all configured providers.");
}

/** True when at least one enabled provider has a key. */
export async function hasAnyAiProvider(): Promise<boolean> {
  for (const provider of await buildChain()) {
    if (await provider.isConfigured()) return true;
  }
  return false;
}

/** Per-provider status for the admin UI. */
export async function getProviderStatuses() {
  const cfg = await getAiConfig();
  return Promise.all(
    AI_PROVIDER_ORDER.map(async (id) => ({
      id,
      label: AI_PROVIDERS[id].label,
      keyName: ENV_KEY_NAME[id],
      models: MODELS[id],
      active: cfg.active === id,
      enabled: cfg.enabled[id] ?? false,
      configured: await AI_PROVIDERS[id].isConfigured(),
    })),
  );
}
