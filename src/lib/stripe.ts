import Stripe from "stripe";

/**
 * SERVER-ONLY. Lazily-constructed Stripe client.
 *
 * Test keys (`sk_test_…`) always work. LIVE keys (`sk_live_…`) move real money,
 * so they're accepted ONLY when `STRIPE_ALLOW_LIVE=true` is also set. This makes
 * it impossible to start charging real cards by accident (e.g. a live key pasted
 * into a dev `.env.local`) — going live is a deliberate two-part opt-in you set
 * in production: `STRIPE_SECRET_KEY=sk_live_…` **and** `STRIPE_ALLOW_LIVE=true`.
 */
let client: Stripe | null = null;

function liveAllowed(): boolean {
  return process.env.STRIPE_ALLOW_LIVE === "true";
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  const isTest = key.startsWith("sk_test_");
  const isLive = key.startsWith("sk_live_");
  if (!isTest && !isLive) {
    throw new Error(
      "STRIPE_SECRET_KEY is malformed — expected a test (sk_test_…) or live (sk_live_…) key.",
    );
  }
  if (isLive && !liveAllowed()) {
    throw new Error(
      "Refusing to use a live Stripe key. Live mode charges real money — set STRIPE_ALLOW_LIVE=true to enable it.",
    );
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

/** True when a usable key is configured (test, or live with the opt-in set). */
export function hasStripeKey(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return false;
  if (key.startsWith("sk_test_")) return true;
  if (key.startsWith("sk_live_")) return liveAllowed();
  return false;
}

/** Which Stripe mode is active — for labelling/diagnostics. */
export function getStripeMode(): "test" | "live" | "off" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key?.startsWith("sk_test_")) return "test";
  if (key?.startsWith("sk_live_") && liveAllowed()) return "live";
  return "off";
}
