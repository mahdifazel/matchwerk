"use client";

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// Stripe's loadStripe() returns a Promise<Stripe | null>. Cache it at module
// scope so we don't re-load the SDK on every component mount — Stripe's docs
// explicitly recommend this pattern.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      // Surface this clearly in dev — Stripe's loadStripe() would throw an
      // unhelpful "publishable key is required" error otherwise.
      console.error(
        "[checkout-embed] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set",
      );
      stripePromise = Promise.resolve(null);
    } else {
      stripePromise = loadStripe(key);
    }
  }
  return stripePromise;
}

/**
 * Mounts the Stripe Embedded Checkout for a given plan.
 *
 * On mount: POSTs /api/checkout with the planId to create a session, then
 * hands the returned `clientSecret` to <EmbeddedCheckoutProvider>. The form
 * lives entirely inside Stripe's iframe — PCI, fraud, payment methods, and
 * 3DS are all unchanged from the previous hosted-redirect integration. The
 * only thing we own is the surrounding chrome.
 *
 * On payment completion (or close), Stripe redirects the user to the
 * session's `return_url`, which is `/plans?checkout=success&session_id=…`.
 * The existing PricingTable redirect handler on /plans takes over from
 * there (POSTs /api/checkout/confirm, credits tokens idempotently, toasts).
 */
export function CheckoutEmbed({ planId }: { planId: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok || !data?.clientSecret) {
          const msg = data?.error ?? "Could not start checkout.";
          setError(msg);
          toast.error(msg);
          return;
        }
        setClientSecret(data.clientSecret);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server.");
        toast.error("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  if (error) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-2xl border p-6 text-sm">
        {error}
      </div>
    );
  }

  if (!clientSecret) {
    // Skeleton that roughly matches the embed's eventual footprint so the
    // page doesn't jump when the form mounts.
    return (
      <div className="border-border/60 bg-card flex h-[640px] items-center justify-center rounded-2xl border">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Preparing secure checkout…
        </div>
      </div>
    );
  }

  return (
    // The Stripe iframe renders its own white card with internal padding —
    // generous horizontally, tight vertically. We can't reach into the
    // iframe to change Stripe's internal layout, but wrapping with our own
    // matching white card + balanced padding pushes the iframe inward so
    // the form gets the same breathing room on every side.
    <div className="bg-card border-border/60 overflow-hidden rounded-2xl border px-4 py-6 sm:px-6 sm:py-8">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
