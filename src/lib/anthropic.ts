import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Lazily-constructed Anthropic client. Throws a clear error if the key is missing. */
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export const MODELS = {
  /** One-time CV parsing — favor quality. */
  cvParse: "claude-sonnet-4-6",
  /** Batched job scoring — favor cost/speed. */
  scoring: "claude-haiku-4-5-20251001",
} as const;

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
