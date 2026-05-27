import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { creditCheckoutSession } from "@/lib/tokens";

// Stripe needs the raw request body to verify the signature, and the crypto used
// by constructEvent requires the Node runtime (not edge).
export const runtime = "nodejs";

/** Persist a verified event for the admin inspector. Never breaks the ack. */
async function record(
  event: Stripe.Event,
  status: "processed" | "ignored" | "error",
  summary: string | null,
  error: string | null,
) {
  try {
    await prisma.webhookEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, type: event.type, status, summary, error },
      update: { type: event.type, status, summary, error },
    });
  } catch (err) {
    console.error("Failed to record webhook event:", err);
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) {
    return NextResponse.json(
      { error: "Webhook is not configured." },
      { status: 400 },
    );
  }

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const planId = session.metadata?.planId;
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";
    const amount =
      typeof session.amount_total === "number"
        ? `${(session.amount_total / 100).toFixed(2)} ${(session.currency ?? "").toUpperCase()}`
        : "—";
    // Label the event with the app account that gets credited (keyed on
    // metadata.userId), not the email typed on Stripe's checkout page — those
    // can differ. Fall back to the Stripe email when there's no user match.
    const accountEmail = userId
      ? ((await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ??
        null)
      : null;
    const summary = `${planId ?? "?"} · ${amount} · ${accountEmail ?? session.customer_details?.email ?? "—"}`;

    if (userId && planId && paid) {
      try {
        await creditCheckoutSession({ userId, planId, stripeSessionId: session.id });
        await record(event, "processed", summary, null);
      } catch (err) {
        console.error("Failed to credit checkout session:", err);
        await record(event, "error", summary, err instanceof Error ? err.message : String(err));
        // 500 tells Stripe to retry delivery.
        return NextResponse.json({ error: "Crediting failed." }, { status: 500 });
      }
    } else {
      await record(event, "ignored", summary, null);
    }
  } else {
    await record(event, "ignored", null, null);
  }

  return NextResponse.json({ received: true });
}
