import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { getStripe, hasStripeKey } from "@/lib/stripe";
import { reverseCheckoutTokens } from "@/lib/tokens";

const schema = z.object({ ledgerId: z.string().min(1) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  if (!hasStripeKey()) {
    return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });
  }

  const { id: userId } = await params;
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (admin.role !== "SUPER_ADMIN" && target.role !== "USER") {
    return NextResponse.json(
      { error: "Only a Super Admin can refund admin accounts." },
      { status: 403 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // The ledger row must be a purchase that belongs to this user.
  const row = await prisma.tokenLedger.findUnique({
    where: { id: parsed.data.ledgerId },
  });
  if (!row || row.userId !== userId || row.reason !== "purchase" || !row.stripeSessionId) {
    return NextResponse.json({ error: "Not a refundable purchase." }, { status: 400 });
  }
  const sessionId = row.stripeSessionId;
  const tokens = Math.abs(row.delta);

  // Already refunded? (token reversal row uses the derived "refund:<id>" key.)
  const existingRefund = await prisma.tokenLedger.findUnique({
    where: { stripeSessionId: `refund:${sessionId}` },
    select: { id: true },
  });
  if (existingRefund) {
    return NextResponse.json({ error: "This purchase was already refunded." }, { status: 409 });
  }

  const stripe = getStripe();

  // Resolve the payment behind the checkout session.
  let paymentIntentId: string | null = null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;
  } catch {
    return NextResponse.json({ error: "Could not load the Stripe session." }, { status: 502 });
  }
  if (!paymentIntentId) {
    return NextResponse.json(
      { error: "No payment found for this purchase to refund." },
      { status: 400 },
    );
  }

  // Issue the Stripe refund (idempotency key prevents a double money refund).
  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund:${sessionId}` },
    );
    refundId = refund.id;
  } catch (err) {
    console.error("Stripe refund failed:", err);
    return NextResponse.json({ error: "Stripe refund failed." }, { status: 502 });
  }

  // Reverse the granted tokens (idempotent).
  const result = await reverseCheckoutTokens({
    userId,
    stripeSessionId: sessionId,
    tokens,
    metadata: {
      originalSessionId: sessionId,
      stripeRefundId: refundId,
      planName: (row.metadata as { planName?: string } | null)?.planName ?? null,
    },
  });

  await logAdminAction(admin, "tokens.refund", {
    targetId: target.id,
    targetEmail: target.email,
    metadata: { sessionId, tokens, refundId },
  });

  return NextResponse.json({
    ok: true,
    reversed: result.reversed,
    tokens: result.tokens,
    balance: result.balance,
  });
}
