import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), hasStripeKey: vi.fn(() => true) }));

import { POST } from "@/app/api/stripe/webhook/route";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { resetDb, seedPlan, seedUser } from "@test/helpers/db";

const mockGetStripe = getStripe as Mock;

function post(signature: string | null = "sig", rawBody = "{}") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["stripe-signature"] = signature;
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers,
      body: rawBody,
    }),
  );
}

/** Mock getStripe so webhooks.constructEvent returns `event` (or throws). */
function stubConstruct(event: unknown, throws = false) {
  mockGetStripe.mockReturnValue({
    webhooks: {
      constructEvent: vi.fn(
        throws
          ? () => {
              throw new Error("bad signature");
            }
          : () => event,
      ),
    },
  });
}

function completedEvent(opts: {
  id?: string;
  userId?: string;
  planId?: string;
  paymentStatus?: string;
  sessionId?: string;
}) {
  return {
    id: opts.id ?? "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId ?? "cs_wh",
        metadata: {
          ...(opts.userId ? { userId: opts.userId } : {}),
          ...(opts.planId ? { planId: opts.planId } : {}),
        },
        payment_status: opts.paymentStatus ?? "paid",
        amount_total: 1999,
        currency: "eur",
        customer_details: { email: "buyer@test.dev" },
      },
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  await resetDb();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("POST /api/stripe/webhook", () => {
  it("400 when the webhook secret is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post()).status).toBe(400);
  });

  it("400 when the stripe-signature header is missing", async () => {
    expect((await post(null)).status).toBe(400);
  });

  it("400 on an invalid signature", async () => {
    stubConstruct(null, true);
    expect((await post()).status).toBe(400);
  });

  it("credits a paid checkout.session.completed and records it processed", async () => {
    const user = await seedUser({ tokenBalance: 0 });
    await seedPlan({ id: "plus", tokens: 500 });
    stubConstruct(completedEvent({ id: "evt_ok", userId: user.id, planId: "plus", sessionId: "cs_ok" }));

    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(await prisma.tokenLedger.count({ where: { userId: user.id, reason: "purchase" } })).toBe(1);
    expect((await prisma.webhookEvent.findUnique({ where: { id: "evt_ok" } }))?.status).toBe(
      "processed",
    );
  });

  it("does not double-credit when the same event is redelivered", async () => {
    const user = await seedUser({ tokenBalance: 0 });
    await seedPlan({ id: "plus", tokens: 500 });
    stubConstruct(completedEvent({ id: "evt_dup", userId: user.id, planId: "plus", sessionId: "cs_dup" }));

    await post();
    await post(); // Stripe retry, same event.id + session

    expect(await prisma.tokenLedger.count({ where: { userId: user.id, reason: "purchase" } })).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { id: "evt_dup" } })).toBe(1);
  });

  it("ignores an unpaid session (200, no credit)", async () => {
    const user = await seedUser({ tokenBalance: 0 });
    await seedPlan({ id: "plus", tokens: 500 });
    stubConstruct(
      completedEvent({ id: "evt_unpaid", userId: user.id, planId: "plus", paymentStatus: "unpaid" }),
    );

    expect((await post()).status).toBe(200);
    expect(await prisma.tokenLedger.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.webhookEvent.findUnique({ where: { id: "evt_unpaid" } }))?.status).toBe(
      "ignored",
    );
  });

  it("ignores a session missing userId metadata", async () => {
    await seedPlan({ id: "plus", tokens: 500 });
    stubConstruct(completedEvent({ id: "evt_nouser", planId: "plus" }));
    expect((await post()).status).toBe(200);
    expect((await prisma.webhookEvent.findUnique({ where: { id: "evt_nouser" } }))?.status).toBe(
      "ignored",
    );
  });

  it("returns 500 (Stripe retry signal) and records error when crediting throws", async () => {
    const user = await seedUser();
    // planId not seeded → creditCheckoutSession throws "Unknown plan".
    stubConstruct(completedEvent({ id: "evt_err", userId: user.id, planId: "ghost", sessionId: "cs_err" }));

    expect((await post()).status).toBe(500);
    expect((await prisma.webhookEvent.findUnique({ where: { id: "evt_err" } }))?.status).toBe("error");
  });

  it("ignores event types other than checkout.session.completed", async () => {
    stubConstruct({ id: "evt_other", type: "payment_intent.succeeded", data: { object: {} } });
    expect((await post()).status).toBe(200);
    expect((await prisma.webhookEvent.findUnique({ where: { id: "evt_other" } }))?.status).toBe(
      "ignored",
    );
  });
});
