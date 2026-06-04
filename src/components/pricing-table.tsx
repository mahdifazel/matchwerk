"use client";

import { ArrowRight, Coins, Eye, FileText, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEur, formatValidity, type Plan } from "@/lib/plans";
import {
  formatTokens,
  notifyTokensUpdated,
  useTokenBalance,
} from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

export function PricingTable({
  plans,
  checkoutStatus,
  sessionId,
}: {
  plans: Plan[];
  checkoutStatus?: string;
  sessionId?: string;
}) {
  const router = useRouter();
  const { balance, debt } = useTokenBalance();
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const handledReturn = useRef(false);

  // Handle the redirect back from Stripe (?checkout=success|cancel).
  useEffect(() => {
    if (!checkoutStatus || handledReturn.current) return;
    handledReturn.current = true;

    if (checkoutStatus === "cancel") {
      toast("Checkout canceled.", { description: "No payment was made." });
      router.replace("/plans");
      return;
    }

    if (checkoutStatus === "success" && sessionId) {
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            toast.error(data?.error ?? "Couldn't confirm your payment.");
            return;
          }
          if (data.credited) {
            toast.success(`Added ${formatTokens(data.tokens)} tokens.`, {
              description: `${data.planName} — payment received.`,
            });
            notifyTokensUpdated();
          } else if (data.pending) {
            toast("Payment is processing.", {
              description: "Your tokens will appear once it clears.",
            });
          } else {
            // Already credited (e.g. the webhook beat the redirect here).
            notifyTokensUpdated();
          }
        })
        .catch(() => toast.error("Couldn't confirm your payment."))
        .finally(() => router.replace("/plans"));
      return;
    }

    router.replace("/plans");
  }, [checkoutStatus, sessionId, router]);

  function handleContinue(plan: Plan) {
    // Navigate to our own /checkout/[planId] page; the Stripe session is
    // created there (via POST /api/checkout) and the form is mounted
    // inline via <CheckoutEmbed>. setPendingPlan keeps the spinner on the
    // tapped card during the navigation so the user gets immediate
    // feedback even before the new page paints.
    setPendingPlan(plan.id);
    router.push(`/checkout/${plan.id}`);
  }

  return (
    <div className="space-y-8">
      {balance != null && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Coins className="size-3.5" />
          <span>
            Current balance{" "}
            <span className="text-foreground tabular-nums">
              <span className="text-lg font-semibold">
                {formatTokens(balance)}
              </span>{" "}
              tokens
            </span>
          </span>
          {debt != null && debt > 0 && (
            <span className="text-muted-foreground">
              · {formatTokens(debt)} owed (covered before your balance grows)
            </span>
          )}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-3 sm:items-stretch">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            loading={pendingPlan === plan.id}
            disabled={pendingPlan != null}
            onContinue={() => handleContinue(plan)}
          />
        ))}
      </div>

      <Footnote />
    </div>
  );
}

function PlanCard({
  plan,
  loading,
  disabled,
  onContinue,
}: {
  plan: Plan;
  loading: boolean;
  disabled: boolean;
  onContinue: () => void;
}) {
  const featured = Boolean(plan.recommended);

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-3xl border p-6 sm:p-7",
        featured
          ? "border-accent/50 bg-card ring-2 ring-accent/40 shadow-[0_24px_52px_-28px_rgba(26,18,51,0.5)] sm:-my-2 sm:scale-[1.03]"
          : "border-border/70 bg-card lift-on-hover",
      )}
    >
      {featured && (
        <Badge className="bg-accent absolute -top-2.5 left-6 text-[var(--brand-ink)] shadow-sm">
          Recommended
        </Badge>
      )}

      <div className="space-y-1.5">
        <h2 className="font-display text-2xl tracking-tight">{plan.name}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {plan.tagline}
        </p>
      </div>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="font-display text-[2.6rem] leading-none tracking-tight tabular-nums">
          {formatEur(plan.priceEur)}
        </span>
      </div>

      <div
        className={cn(
          "mt-5 rounded-2xl border px-4 py-3",
          featured ? "border-accent/40 bg-accent/10" : "border-border/60 bg-muted/40",
        )}
      >
        <div className="font-display text-xl leading-none tracking-tight tabular-nums">
          {plan.tokens.toLocaleString("en-US")} tokens
        </div>
        <div className="text-muted-foreground mt-1.5 text-xs">
          {formatValidity(plan.durationMonths)}
        </div>
      </div>

      <div className="mt-auto pt-7">
        <Button
          onClick={onContinue}
          disabled={disabled}
          variant={featured ? "default" : "outline"}
          className="h-10 w-full"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              Opening checkout…
            </>
          ) : (
            <>
              Continue to payment
              <ArrowRight />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

const COSTS = [
  { icon: FileText, cost: "25", unit: "tokens", label: "Parse your CV" },
  { icon: Eye, cost: "0.5", unit: "tokens", label: "Each job shown" },
  { icon: Sparkles, cost: "1", unit: "token", label: "Each AI rating" },
] as const;

function Footnote() {
  return (
    <div className="border-border/60 bg-card/50 rounded-2xl border p-5 sm:p-6">
      <p className="eyebrow mb-4">What tokens buy</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {COSTS.map((item) => (
          <div
            key={item.label}
            className="border-border/60 bg-background/40 flex items-center gap-3 rounded-xl border px-3.5 py-3"
          >
            <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <item.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="font-display text-lg leading-none tracking-tight tabular-nums">
                {item.cost}{" "}
                <span className="text-muted-foreground font-sans text-xs font-normal">
                  {item.unit}
                </span>
              </div>
              <div className="text-muted-foreground mt-1 text-xs">
                {item.label}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        Tokens land in your balance the moment your payment is confirmed.
        Secure checkout by Stripe.
      </p>
    </div>
  );
}
