import { afterEach, describe, expect, it, vi } from "vitest";

// getStripe() caches a module-level client, so each case resets the module
// registry and re-imports with fresh env.
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_LIVE = process.env.STRIPE_ALLOW_LIVE;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  if (ORIGINAL_LIVE === undefined) delete process.env.STRIPE_ALLOW_LIVE;
  else process.env.STRIPE_ALLOW_LIVE = ORIGINAL_LIVE;
  vi.resetModules();
});

async function loadStripe(key: string | undefined, opts: { live?: boolean } = {}) {
  if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = key;
  if (opts.live) process.env.STRIPE_ALLOW_LIVE = "true";
  else delete process.env.STRIPE_ALLOW_LIVE;
  vi.resetModules();
  return import("@/lib/stripe");
}

describe("getStripe — key guard", () => {
  it("throws when no key is configured", async () => {
    const { getStripe } = await loadStripe(undefined);
    expect(() => getStripe()).toThrow(/not set/i);
  });

  it("accepts a test key and returns a cached singleton", async () => {
    const { getStripe } = await loadStripe("sk_test_abc123");
    const a = getStripe();
    const b = getStripe();
    expect(a).toBe(b);
  });

  it("refuses a live key unless STRIPE_ALLOW_LIVE is set", async () => {
    const { getStripe } = await loadStripe("sk_live_deadbeef");
    expect(() => getStripe()).toThrow(/live|STRIPE_ALLOW_LIVE/i);
  });

  it("accepts a live key when STRIPE_ALLOW_LIVE=true (deliberate opt-in)", async () => {
    const { getStripe } = await loadStripe("sk_live_deadbeef", { live: true });
    expect(() => getStripe()).not.toThrow();
  });

  it("rejects a malformed key", async () => {
    const { getStripe } = await loadStripe("pk_test_nope");
    expect(() => getStripe()).toThrow(/malformed/i);
  });
});

describe("hasStripeKey / getStripeMode", () => {
  it("reflects test, live (gated), and off states", async () => {
    let mod = await loadStripe("sk_test_x");
    expect(mod.hasStripeKey()).toBe(true);
    expect(mod.getStripeMode()).toBe("test");

    mod = await loadStripe("sk_live_x");
    expect(mod.hasStripeKey()).toBe(false); // live without opt-in is unusable
    expect(mod.getStripeMode()).toBe("off");

    mod = await loadStripe("sk_live_x", { live: true });
    expect(mod.hasStripeKey()).toBe(true);
    expect(mod.getStripeMode()).toBe("live");

    mod = await loadStripe(undefined);
    expect(mod.hasStripeKey()).toBe(false);
    expect(mod.getStripeMode()).toBe("off");
  });
});
