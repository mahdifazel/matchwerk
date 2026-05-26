import { afterEach, describe, expect, it, vi } from "vitest";

// getStripe() caches a module-level client, so each case resets the module
// registry and re-imports with a fresh STRIPE_SECRET_KEY.
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  vi.resetModules();
});

async function loadStripe(key: string | undefined) {
  if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = key;
  vi.resetModules();
  return import("@/lib/stripe");
}

describe("getStripe — sandbox guard", () => {
  it("throws when no key is configured", async () => {
    const { getStripe } = await loadStripe(undefined);
    expect(() => getStripe()).toThrow(/not set/i);
  });

  it("refuses a live key (sk_live_…)", async () => {
    const { getStripe } = await loadStripe("sk_live_deadbeef");
    expect(() => getStripe()).toThrow(/sandbox|live/i);
  });

  it("accepts a test key and returns a cached singleton", async () => {
    const { getStripe } = await loadStripe("sk_test_abc123");
    const a = getStripe();
    const b = getStripe();
    expect(a).toBe(b);
  });
});

describe("hasStripeKey", () => {
  it("is true only for a test key", async () => {
    expect((await loadStripe("sk_test_x")).hasStripeKey()).toBe(true);
    expect((await loadStripe("sk_live_x")).hasStripeKey()).toBe(false);
    expect((await loadStripe(undefined)).hasStripeKey()).toBe(false);
  });
});
