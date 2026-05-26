import { NextResponse } from "next/server";
import { z } from "zod";
import { formatValidity } from "@/lib/plans";
import { getPlanById } from "@/lib/plans-repo";
import { getSessionUserId } from "@/lib/repo";
import { getStripe, hasStripeKey } from "@/lib/stripe";

const schema = z.object({ planId: z.string() });

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

  // Resolve the plan server-side — price and token amount are never trusted
  // from the client.
  const plan = await getPlanById(parsed.data.planId);
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const tokenCount = plan.tokens.toLocaleString("en-US");

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(plan.priceEur * 100),
            product_data: {
              name: `Matchwerk — ${plan.name}`,
              description: `${tokenCount} tokens, ${formatValidity(plan.durationMonths)}.`,
            },
          },
        },
      ],
      client_reference_id: userId,
      // The webhook + success confirmation read these back to credit the tokens.
      metadata: { userId, planId: plan.id },
      success_url: `${origin}/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/plans?checkout=cancel`,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
