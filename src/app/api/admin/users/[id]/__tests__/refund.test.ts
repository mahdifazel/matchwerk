import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/admin", () => ({ getAdminUser: vi.fn(), logAdminAction: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), hasStripeKey: vi.fn(() => true) }));

import { POST } from "@/app/api/admin/users/[id]/refund/route";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { resetDb, seedUser } from "@test/helpers/db";

const mockGetAdmin = getAdminUser as Mock;
const mockGetStripe = getStripe as Mock;
const mockLog = logAdminAction as Mock;

function post(targetId: string, ledgerId: unknown) {
  return POST(
    new Request(`http://localhost/api/admin/users/${targetId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ledgerId }),
    }),
    { params: Promise.resolve({ id: targetId }) },
  );
}

/** Fake Stripe: session has a payment_intent and refunds.create succeeds. */
function stubStripeOk() {
  const refundsCreate = vi.fn().mockResolvedValue({ id: "re_1" });
  mockGetStripe.mockReturnValue({
    checkout: { sessions: { retrieve: vi.fn().mockResolvedValue({ payment_intent: "pi_1" }) } },
    refunds: { create: refundsCreate },
  });
  return { refundsCreate };
}

async function seedPurchase(userId: string, sessionId: string, tokens: number, balance: number) {
  await prisma.user.update({ where: { id: userId }, data: { tokenBalance: balance } });
  return prisma.tokenLedger.create({
    data: {
      userId,
      delta: tokens,
      balanceAfter: balance,
      reason: "purchase",
      stripeSessionId: sessionId,
      metadata: { planName: "Plus" },
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});
afterAll(() => prisma.$disconnect());

describe("POST /api/admin/users/[id]/refund", () => {
  it("403 for non-admins", async () => {
    mockGetAdmin.mockResolvedValue(null);
    const user = await seedUser();
    expect((await post(user.id, "lg_1")).status).toBe(403);
  });

  it("403 when a non-super admin refunds an admin account", async () => {
    mockGetAdmin.mockResolvedValue({ id: "a1", email: "a@x.dev", role: "ADMIN" });
    const target = await seedUser({ role: "ADMIN" });
    expect((await post(target.id, "lg_1")).status).toBe(403);
  });

  it("400 when the ledger row isn't a refundable purchase", async () => {
    mockGetAdmin.mockResolvedValue({ id: "a1", email: "a@x.dev", role: "SUPER_ADMIN" });
    const user = await seedUser();
    const row = await prisma.tokenLedger.create({
      data: { userId: user.id, delta: -25, balanceAfter: 0, reason: "research" },
    });
    expect((await post(user.id, row.id)).status).toBe(400);
  });

  it("409 when the purchase was already refunded", async () => {
    mockGetAdmin.mockResolvedValue({ id: "a1", email: "a@x.dev", role: "SUPER_ADMIN" });
    const user = await seedUser();
    const row = await seedPurchase(user.id, "cs_done", 500, 500);
    await prisma.tokenLedger.create({
      data: {
        userId: user.id,
        delta: -500,
        balanceAfter: 0,
        reason: "refund",
        stripeSessionId: "refund:cs_done",
      },
    });
    expect((await post(user.id, row.id)).status).toBe(409);
  });

  it("refunds: reverses tokens, uses the idempotency key, and audit-logs", async () => {
    mockGetAdmin.mockResolvedValue({ id: "a1", email: "a@x.dev", role: "SUPER_ADMIN" });
    const user = await seedUser();
    const row = await seedPurchase(user.id, "cs_ref", 500, 500);
    const { refundsCreate } = stubStripeOk();

    const res = await post(user.id, row.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, reversed: true, tokens: 500, balance: 0 });

    // Stripe refund created with the per-session idempotency key.
    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: "pi_1" },
      { idempotencyKey: "refund:cs_ref" },
    );
    // Token reversal landed exactly once.
    expect(await prisma.tokenLedger.count({ where: { userId: user.id, reason: "refund" } })).toBe(1);
    expect(mockLog).toHaveBeenCalledOnce();
  });
});
