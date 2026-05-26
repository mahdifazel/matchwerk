import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/repo", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), hasStripeKey: vi.fn(() => true) }));

import { POST } from "@/app/api/checkout/route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";
import { getStripe, hasStripeKey } from "@/lib/stripe";
import { resetDb, seedPlan } from "@test/helpers/db";

const mockSession = getSessionUserId as Mock;
const mockGetStripe = getStripe as Mock;
const mockHasKey = hasStripeKey as Mock;

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
    mockSession.mockResolvedValue("u1");
    mockHasKey.mockReturnValue(false);
    expect((await post({ planId: "plus" })).status).toBe(503);
  });

  it("400 on an invalid body", async () => {
    mockSession.mockResolvedValue("u1");
    expect((await post({})).status).toBe(400);
  });

  it("400 on an unknown plan", async () => {
    mockSession.mockResolvedValue("u1");
    expect((await post({ planId: "ghost" })).status).toBe(400);
  });

  it("creates a session with the server-sourced price and metadata", async () => {
    await seedPlan({ id: "plus", priceEur: 19.99, tokens: 500 });
    mockSession.mockResolvedValue("u1");
    const create = vi.fn().mockResolvedValue({ url: "https://stripe.test/cs_1" });
    mockGetStripe.mockReturnValue({ checkout: { sessions: { create } } });

    const res = await post({ planId: "plus" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://stripe.test/cs_1" });

    const arg = create.mock.calls[0][0];
    expect(arg.line_items[0].price_data.unit_amount).toBe(1999); // 19.99 € → cents
    expect(arg.metadata).toEqual({ userId: "u1", planId: "plus" });
    expect(arg.client_reference_id).toBe("u1");
  });
});
