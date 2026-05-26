import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlanById } from "@/lib/plans-repo";
import { getSessionUserId } from "@/lib/repo";
import { getStripe, hasStripeKey } from "@/lib/stripe";
import { creditCheckoutSession } from "@/lib/tokens";

const schema = z.object({ sessionId: z.string().min(1) });

/**
 * Confirms a Checkout session the user was redirected back with, and credits the
 * tokens if it's paid. Crediting is idempotent, so this is safe to call even when
 * the webhook has already credited the same session — the second call is a no-op.
 */
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  if (!hasStripeKey()) {
    return NextResponse.json(
      { error: "Payments aren't configured yet." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId);
  } catch {
    return NextResponse.json({ error: "Checkout session not found." }, { status: 404 });
  }

  // Only the user who created the session may confirm it.
  if (session.metadata?.userId !== userId) {
    return NextResponse.json({ error: "Not your checkout session." }, { status: 403 });
  }

  if (session.payment_status !== "paid") {
    // Payment still processing (or abandoned) — nothing to credit yet.
    return NextResponse.json({ credited: false, pending: true });
  }

  const planId = session.metadata?.planId;
  const plan = planId ? await getPlanById(planId) : null;
  if (!planId || !plan) {
    return NextResponse.json({ error: "Unknown plan on session." }, { status: 400 });
  }

  const result = await creditCheckoutSession({
    userId,
    planId,
    stripeSessionId: session.id,
  });

  return NextResponse.json({
    credited: result.credited,
    tokens: result.tokens,
    balance: result.balance,
    planName: plan.name,
  });
}
