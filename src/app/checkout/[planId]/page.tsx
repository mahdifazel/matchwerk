import { ArrowLeft, Coins, CreditCard, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutEmbed } from "@/components/checkout-embed";
import { formatEur } from "@/lib/plans";
import { getPlanById } from "@/lib/plans-repo";
import { getSessionUser } from "@/lib/repo";
import { TOKEN } from "@/lib/tokens";

export const metadata = {
  title: "Checkout · Matchwerk",
};

/**
 * Custom checkout page that hosts Stripe's Embedded Checkout in the right
 * column and owns the merchant panel on the left.
 *
 * Surface contract:
 * - Auth-gated. Anonymous → /login with callbackUrl.
 * - Unknown planId → 404.
 * - The session itself is created client-side by <CheckoutEmbed> POSTing
 *   /api/checkout. That keeps the publishable-key flow + return_url
 *   handshake in one place, and lets the server component stay pure / fast.
 *
 * Theming: both columns respect light/dark mode via Atelier semantic tokens
 * (`bg-secondary` for the merchant panel, theme bg for the embed column,
 * `bg-primary`/`bg-accent` for the logomark, etc.). The Stripe iframe
 * itself stays Stripe-white internally — that's not something we can
 * theme — but everything *around* it flips with the user's choice.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const user = await getSessionUser();
  const { planId } = await params;
  if (!user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/checkout/${planId}`)}`);
  }
  const plan = await getPlanById(planId);
  // `getPlanById` returns the plan regardless of `active`; if an admin
  // deactivated the plan after this page loaded the user's existing link
  // still works (they were quoted a price; let them complete it). The
  // /plans page only lists active plans, so casual discovery is gated.
  if (!plan) notFound();

  // Concrete usage anchor — how many jobs the user can have fully matched
  // against their CV with this many tokens. Derived from the canonical
  // TOKEN prices so it stays in sync if pricing changes (~1.5 tokens per
  // fully-rated job at typical use: 0.5 to surface + 1 to score).
  const fullyRatedJobs = Math.floor(
    plan.tokens / (TOKEN.PER_JOB_DISPLAY + TOKEN.PER_JOB_RATING),
  );

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* LEFT — merchant panel. `bg-secondary` is Sand in light mode and
          muted plum in dark mode (per the Atelier system) — a warm,
          theme-aware brand surface that contrasts the right column's bg
          without being aggressive. Right border on lg+ defines the
          column boundary. */}
      <aside className="bg-secondary text-secondary-foreground border-border/40 relative flex flex-col px-5 py-10 sm:px-8 lg:basis-[52%] lg:border-r lg:px-12 lg:py-14">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/plans"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Back to plans
          </Link>

          {/* Brand lockup — same shape as the app header. Uses semantic
              tokens so light = Ink-square/Paper-M/Chartreuse-dot and
              dark = Chartreuse-square/Midnight-M/Lavender-dot (Atelier's
              accent flips by theme). */}
          <div className="mt-8 flex items-center gap-2.5">
            <span
              aria-hidden
              className="bg-primary text-primary-foreground relative flex size-10 shrink-0 items-center justify-center rounded-lg shadow-sm"
            >
              <span className="font-display text-[1.3rem] leading-none">M</span>
              <span
                className="bg-accent absolute -right-0.5 -top-0.5 size-2 rounded-full"
                style={{ boxShadow: "0 0 0 2px var(--secondary)" }}
              />
            </span>
            <span className="font-display text-foreground text-[1.35rem] leading-none tracking-tight">
              Matchwerk
            </span>
          </div>

          {/* Plan headline */}
          <p className="eyebrow text-muted-foreground mt-12 text-[0.72rem]">
            You&apos;re paying for
          </p>
          <h1 className="font-display text-foreground mt-2 text-[2.2rem] leading-[1.05] tracking-tight sm:text-[2.6rem]">
            {plan.name} pack
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {plan.tagline}
          </p>

          {/* Price + units */}
          <div className="mt-8 flex items-baseline gap-2">
            <span className="font-display text-foreground text-[2.8rem] leading-none tracking-tight tabular-nums">
              {formatEur(plan.priceEur)}
            </span>
            <span className="text-muted-foreground text-sm">one-time</span>
          </div>

          {/* Plan summary chip — uses semantic `bg-accent` / `border-accent`
              tints so the chip shows chartreuse in light and lavender in
              dark, matching the Atelier accent flip. */}
          <div className="border-accent/40 bg-accent/10 mt-6 rounded-2xl border p-4">
            <div className="flex items-baseline gap-1.5">
              <Coins className="text-foreground size-4 shrink-0" />
              <span className="font-display text-foreground text-xl leading-none tracking-tight tabular-nums">
                {plan.tokens.toLocaleString("en-US")} tokens
              </span>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs">
              Valid for {plan.durationMonths} month
              {plan.durationMonths === 1 ? "" : "s"}. Roughly{" "}
              <strong className="text-foreground font-semibold">
                {fullyRatedJobs.toLocaleString("en-US")} jobs
              </strong>{" "}
              fully matched against your CV.
            </p>
          </div>

          {/* Trust band — security + payment methods + reassurance */}
          <div className="mt-8 space-y-3">
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Lock className="size-3.5" />
              <span>Secure checkout, payment processed by Stripe.</span>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <ShieldCheck className="size-3.5" />
              <span>No subscription. No auto-renewal.</span>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <CreditCard className="size-3.5" />
              <span>Cards, Apple Pay, Google Pay, and Link supported.</span>
            </div>
          </div>

          {/* Editorial closing line — quiet, Fraunces italic, mirrors the
              auth page's caption voice. */}
          <p className="font-display text-muted-foreground mt-10 max-w-sm text-sm italic leading-relaxed">
            Tokens land in your balance the moment your payment is confirmed.
          </p>
        </div>
      </aside>

      {/* RIGHT — Stripe Embedded Checkout. Inherits theme background. */}
      <section className="flex flex-col px-5 py-10 sm:px-8 lg:basis-[48%] lg:px-10 lg:py-14">
        <div className="mx-auto w-full max-w-xl">
          <CheckoutEmbed planId={plan.id} />
        </div>
      </section>
    </main>
  );
}
