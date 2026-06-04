import { ArrowLeft, Apple, Coins, CreditCard, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutEmbed } from "@/components/checkout-embed";
import { formatEur } from "@/lib/plans";
import { getPlanById } from "@/lib/plans-repo";
import { getSessionUser } from "@/lib/repo";
import { TOKEN } from "@/lib/tokens";

export const metadata = {
  title: "Checkout — Matchwerk",
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
  const fullyRatedJobs = Math.floor(plan.tokens / (TOKEN.PER_JOB_DISPLAY + TOKEN.PER_JOB_RATING));

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* LEFT — merchant panel. Pinned Paper background in both themes (the
          checkout is brand-anchored on this side; the right side respects
          theme). Matches the Atelier auth-page pattern. */}
      <aside
        className="relative flex flex-col px-5 py-10 sm:px-8 lg:basis-[52%] lg:px-12 lg:py-14"
        style={{ backgroundColor: "#F5F1E8" }}
      >
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/plans"
            className="inline-flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: "rgba(26, 18, 51, 0.6)" }}
          >
            <ArrowLeft className="size-3.5" />
            Back to plans
          </Link>

          {/* Brand lockup — logomark + wordmark, Atelier-pinned to Paper. */}
          <div className="mt-8 flex items-center gap-2.5">
            <span
              aria-hidden
              className="relative flex size-10 shrink-0 items-center justify-center rounded-lg shadow-sm"
              style={{ backgroundColor: "#1A1233", color: "#F5F1E8" }}
            >
              <span className="font-display text-[1.3rem] leading-none">M</span>
              <span
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full"
                style={{ backgroundColor: "#DCCE40", boxShadow: "0 0 0 2px #F5F1E8" }}
              />
            </span>
            <span
              className="font-display text-[1.35rem] leading-none tracking-tight"
              style={{ color: "#1A1233" }}
            >
              Matchwerk
            </span>
          </div>

          {/* Plan headline */}
          <p
            className="eyebrow mt-12 text-[0.72rem]"
            style={{ color: "rgba(26, 18, 51, 0.55)" }}
          >
            You&apos;re paying for
          </p>
          <h1
            className="font-display mt-2 text-[2.2rem] leading-[1.05] tracking-tight sm:text-[2.6rem]"
            style={{ color: "#1A1233" }}
          >
            {plan.name} pack
          </h1>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "rgba(26, 18, 51, 0.65)" }}
          >
            {plan.tagline}
          </p>

          {/* Price + units */}
          <div className="mt-8 flex items-baseline gap-2">
            <span
              className="font-display text-[2.8rem] leading-none tracking-tight tabular-nums"
              style={{ color: "#1A1233" }}
            >
              {formatEur(plan.priceEur)}
            </span>
            <span
              className="text-sm"
              style={{ color: "rgba(26, 18, 51, 0.55)" }}
            >
              one-time
            </span>
          </div>

          {/* Plan summary chip */}
          <div
            className="mt-6 rounded-2xl border p-4"
            style={{
              backgroundColor: "rgba(220, 206, 64, 0.10)",
              borderColor: "rgba(220, 206, 64, 0.40)",
            }}
          >
            <div className="flex items-baseline gap-1.5">
              <Coins className="size-4 shrink-0" style={{ color: "#1A1233" }} />
              <span
                className="font-display text-xl leading-none tracking-tight tabular-nums"
                style={{ color: "#1A1233" }}
              >
                {plan.tokens.toLocaleString("en-US")} tokens
              </span>
            </div>
            <p
              className="mt-1.5 text-xs"
              style={{ color: "rgba(26, 18, 51, 0.60)" }}
            >
              Valid for {plan.durationMonths} month
              {plan.durationMonths === 1 ? "" : "s"}. Roughly{" "}
              <strong className="font-semibold">
                {fullyRatedJobs.toLocaleString("en-US")} jobs
              </strong>{" "}
              fully matched against your CV.
            </p>
          </div>

          {/* Trust band — security + payment methods + reassurance */}
          <div className="mt-8 space-y-3">
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "rgba(26, 18, 51, 0.70)" }}
            >
              <Lock className="size-3.5" />
              <span>Secure checkout, payment processed by Stripe.</span>
            </div>
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "rgba(26, 18, 51, 0.70)" }}
            >
              <ShieldCheck className="size-3.5" />
              <span>No subscription. No auto-renewal.</span>
            </div>
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "rgba(26, 18, 51, 0.70)" }}
            >
              <CreditCard className="size-3.5" />
              <span>Cards, Apple Pay, Google Pay, and Link supported.</span>
            </div>
          </div>

          {/* Editorial closing line — quiet, Fraunces italic, mirrors the
              auth page's caption voice. */}
          <p
            className="font-display mt-10 max-w-sm text-sm italic leading-relaxed"
            style={{ color: "rgba(26, 18, 51, 0.55)" }}
          >
            Tokens land in your balance the moment your payment is confirmed.
          </p>

          {/* Hidden but reserved: payment-method glyph row. We render text
              above for the actual list; this slot keeps a logical place
              for the icon strip if we wire it later. */}
          <div className="sr-only">
            <Apple aria-hidden />
          </div>
        </div>
      </aside>

      {/* RIGHT — Stripe Embedded Checkout. */}
      <section className="flex flex-col px-5 py-10 sm:px-8 lg:basis-[48%] lg:px-10 lg:py-14">
        <div className="mx-auto w-full max-w-xl">
          <CheckoutEmbed planId={plan.id} />
        </div>
      </section>
    </main>
  );
}
