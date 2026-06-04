import { NextResponse } from "next/server";
import { z } from "zod";
import { formatValidity } from "@/lib/plans";
import { getPlanById } from "@/lib/plans-repo";
import { getSessionUser } from "@/lib/repo";
import { getStripe, hasStripeKey } from "@/lib/stripe";

const schema = z.object({ planId: z.string() });

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
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
    // Embedded Checkout (ui_mode: "embedded") instead of the previous hosted
    // redirect. The form mounts inside our own /checkout/[planId] page, so
    // we own the surrounding chrome (brand panel on the left). The Stripe-
    // managed payment form, PCI compliance, fraud signals, Link, Apple Pay
    // and friends are unchanged.
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      // Stripe API `2026-04-22.dahlia` (what Stripe SDK v22 targets by
      // default) renamed `ui_mode` values: `embedded` → `embedded_page`
      // and `hosted` → `hosted_page`. Most of Stripe's public docs still
      // show the old names, but the live API for this version requires the
      // `_page` suffix.
      ui_mode: "embedded_page",
      payment_method_types: ["card"],
      // Auto-detect German vs English (and beyond) from the user's browser —
      // the embedded form re-renders text in their language.
      locale: "auto",
      // Pre-fill the email so the user doesn't re-type it.
      customer_email: user.email,
      // Collect billing address only when required for tax / regulation in
      // the user's country (avoids a needless extra field for most users).
      billing_address_collection: "auto",
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
      client_reference_id: user.id,
      // The webhook + success confirmation read these back to credit the tokens.
      metadata: { userId: user.id, planId: plan.id },
      // Embedded Checkout uses a single `return_url` (no cancel_url). After
      // payment completes (or the user closes the embed) Stripe redirects
      // here. The existing PricingTable redirect handler picks up
      // `?checkout=success&session_id=…` and runs /api/checkout/confirm.
      return_url: `${origin}/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    });

    if (!session.client_secret) {
      return NextResponse.json(
        { error: "Stripe did not return a client secret." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
    });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    // In development, surface Stripe's own message so the dev tools network
    // tab tells you exactly what's wrong (param name, invalid value, etc.).
    // Production keeps the generic message so we don't leak Stripe internals.
    const isDev = process.env.NODE_ENV !== "production";
    const message = isDev && err instanceof Error
      ? `Could not start checkout: ${err.message}`
      : "Could not start checkout. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
