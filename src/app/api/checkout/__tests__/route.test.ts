import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/repo", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), hasStripeKey: vi.fn(() => true) }));

import { POST } from "@/app/api/checkout/route";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/repo";
import { getStripe, hasStripeKey } from "@/lib/stripe";
import { resetDb, seedPlan } from "@test/helpers/db";

const mockSession = getSessionUser as Mock;
const mockGetStripe = getStripe as Mock;
const mockHasKey = hasStripeKey as Mock;

/** A minimally-shaped session user — only the fields the route reads. */
function fakeUser(overrides: Partial<{ id: string; email: string }> = {}) {
  return { id: "u1", email: "user@example.com", ...overrides };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockHasKey.mockReturnValue(true);
  await resetDb();
});
afterAll(() => prisma.$disconnect());

describe("POST /api/checkout", () => {
  it("401 when not signed in", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ planId: "plus" })).status).toBe(401);
  });

  it("503 when Stripe is not configured", async () => {
    mockSession.mockResolvedValue(fakeUser());
    mockHasKey.mockReturnValue(false);
    expect((await post({ planId: "plus" })).status).toBe(503);
  });

  it("400 on an invalid body", async () => {
    mockSession.mockResolvedValue(fakeUser());
    expect((await post({})).status).toBe(400);
  });

  it("400 on an unknown plan", async () => {
    mockSession.mockResolvedValue(fakeUser());
    expect((await post({ planId: "ghost" })).status).toBe(400);
  });

  it("creates an embedded session with the server-sourced price, metadata, and prefilled email", async () => {
    await seedPlan({ id: "plus", priceEur: 19.99, tokens: 500 });
    mockSession.mockResolvedValue(fakeUser({ email: "u1@example.com" }));
    const create = vi
      .fn()
      .mockResolvedValue({ id: "cs_1", client_secret: "cs_test_secret" });
    mockGetStripe.mockReturnValue({ checkout: { sessions: { create } } });

    const res = await post({ planId: "plus" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clientSecret: "cs_test_secret",
      sessionId: "cs_1",
    });

    const arg = create.mock.calls[0][0];
    expect(arg.ui_mode).toBe("embedded_page");
    expect(arg.line_items[0].price_data.unit_amount).toBe(1999); // 19.99 € → cents
    expect(arg.metadata).toEqual({ userId: "u1", planId: "plus" });
    expect(arg.client_reference_id).toBe("u1");
    expect(arg.customer_email).toBe("u1@example.com");
    expect(arg.locale).toBe("auto");
    expect(arg.billing_address_collection).toBe("auto");
    // Embedded mode uses return_url (no success_url / cancel_url).
    expect(arg.return_url).toContain("/plans?checkout=success");
    expect(arg.return_url).toContain("{CHECKOUT_SESSION_ID}");
    expect(arg.success_url).toBeUndefined();
    expect(arg.cancel_url).toBeUndefined();
  });

  it("502 when Stripe returns a session without a client_secret", async () => {
    await seedPlan({ id: "plus", priceEur: 19.99, tokens: 500 });
    mockSession.mockResolvedValue(fakeUser());
    const create = vi.fn().mockResolvedValue({ id: "cs_1", client_secret: null });
    mockGetStripe.mockReturnValue({ checkout: { sessions: { create } } });

    expect((await post({ planId: "plus" })).status).toBe(502);
  });
});
