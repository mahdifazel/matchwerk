import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/repo", () => ({ getSessionUserId: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), hasStripeKey: vi.fn(() => true) }));

import { POST } from "@/app/api/checkout/confirm/route";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";
import { getStripe } from "@/lib/stripe";
import { resetDb, seedPlan, seedUser } from "@test/helpers/db";

const mockSession = getSessionUserId as Mock;
const mockGetStripe = getStripe as Mock;

function post(sessionId: unknown) {
  return POST(
    new Request("http://localhost/api/checkout/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }),
  );
}

/** A fake Stripe whose checkout.sessions.retrieve returns `session` (or throws). */
function stubStripe(session: unknown, throws = false) {
  mockGetStripe.mockReturnValue({
    checkout: {
      sessions: {
        retrieve: vi.fn(throws ? () => Promise.reject(new Error("no")) : () => Promise.resolve(session)),
      },
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});
afterAll(() => prisma.$disconnect());

describe("POST /api/checkout/confirm", () => {
  it("401 when not signed in", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post("cs_1")).status).toBe(401);
  });

  it("404 when the session can't be retrieved", async () => {
    mockSession.mockResolvedValue("u1");
    stubStripe(null, true);
    expect((await post("cs_missing")).status).toBe(404);
  });

  it("403 when the session belongs to another user", async () => {
    mockSession.mockResolvedValue("u1");
    stubStripe({ id: "cs_1", metadata: { userId: "someone-else" }, payment_status: "paid" });
    expect((await post("cs_1")).status).toBe(403);
  });

  it("returns pending when payment isn't completed", async () => {
    mockSession.mockResolvedValue("u1");
    stubStripe({ id: "cs_1", metadata: { userId: "u1", planId: "plus" }, payment_status: "unpaid" });
    const res = await post("cs_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ credited: false, pending: true });
  });

  it("credits once, then is idempotent on a repeat confirm", async () => {
    const user = await seedUser({ tokenBalance: 0 });
    await seedPlan({ id: "plus", tokens: 500 });
    mockSession.mockResolvedValue(user.id);
    stubStripe({ id: "cs_paid", metadata: { userId: user.id, planId: "plus" }, payment_status: "paid" });

    const first = await post("cs_paid");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ credited: true, tokens: 500, balance: 500 });

    const second = await post("cs_paid");
    expect(await second.json()).toMatchObject({ credited: false, balance: 500 });

    expect(await prisma.tokenLedger.count({ where: { userId: user.id, reason: "purchase" } })).toBe(1);
  });

  it("400 when the session references an unknown plan", async () => {
    const user = await seedUser();
    mockSession.mockResolvedValue(user.id);
    stubStripe({ id: "cs_1", metadata: { userId: user.id, planId: "ghost" }, payment_status: "paid" });
    expect((await post("cs_1")).status).toBe(400);
  });
});
