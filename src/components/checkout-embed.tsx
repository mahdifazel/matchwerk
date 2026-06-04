"use client";

import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
    // Skeleton that matches the embed's eventual chrome (same border,
    // shadow, accent strip) so the visual doesn't jolt at the swap.
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl",
          "border border-[#1A1233]/8 dark:border-white/8",
          "bg-card",
          "shadow-[0_1px_2px_rgba(26,18,51,0.04),0_12px_28px_-16px_rgba(26,18,51,0.16)]",
          "dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_12px_28px_-16px_rgba(0,0,0,0.6)]",
        )}
      >
        <div aria-hidden className="bg-accent h-[2px] w-full" />
        <div className="flex h-[600px] items-center justify-center">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Preparing secure checkout…
          </div>
        </div>
      </div>
    );
  }

  return (
    // Editorial payment surface (Atelier voice). Restrained but intentional:
    //  · Hairline border at Ink 8% (light) / white 8% (dark) — visible
    //    enough to define the card edge but not the generic shadcn grey.
    //  · Two-layer shadow: tight 1px inset for definition + a soft 24-32px
    //    halo for natural elevation. Both Ink-tinted to keep on-brand.
    //  · Single 2px accent strip at the top edge — chartreuse in light,
    //    lavender in dark (the Atelier accent flips per theme). One small
    //    brand mark distinguishes the card from "default template".
    //  · Inner padding stays light-horizontal / generous-vertical so the
    //    Stripe iframe gets full width and balanced breathing room.
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl",
        "border border-[#1A1233]/8 dark:border-white/8",
        "bg-card",
        "shadow-[0_1px_2px_rgba(26,18,51,0.04),0_12px_28px_-16px_rgba(26,18,51,0.16)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_12px_28px_-16px_rgba(0,0,0,0.6)]",
      )}
    >
      {/* Editorial accent strip — single brand mark on an otherwise austere
          surface. 2px tall, full-bleed top edge, uses --accent so light mode
          shows chartreuse and dark mode shows lavender. */}
      <div aria-hidden className="bg-accent h-[2px] w-full" />
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}
