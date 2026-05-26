import Stripe from "stripe";

/**
 * SERVER-ONLY. Lazily-constructed Stripe client.
 *
 * Sandbox guard: we refuse any key that isn't a test key (`sk_test_…`). This
 * makes it impossible to accidentally run real charges from this codebase —
 * a live key (`sk_live_…`) throws on first use.
 */
let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to use Stripe: STRIPE_SECRET_KEY must be a test/sandbox key (sk_test_…). No live keys allowed.",
    );
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

/** True when a usable sandbox key is configured. */
export function hasStripeKey(): boolean {
  const key = process.env.STRIPE_SECRET_KEY;
  return Boolean(key && key.startsWith("sk_test_"));
}
