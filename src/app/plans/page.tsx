import { PricingTable } from "@/components/pricing-table";
import { getActivePlans } from "@/lib/plans-repo";

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const { checkout, session_id } = await searchParams;
  const plans = await getActivePlans();
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
      <header className="max-w-2xl pt-10 sm:pt-14">
        <p className="eyebrow mb-4">Pricing</p>
        <h1 className="font-display text-[2.4rem] leading-[1.05] tracking-tight sm:text-[3rem]">
          Top up your tokens.
        </h1>
        <p className="text-muted-foreground mt-4 text-[1rem] leading-relaxed">
          Tokens power CV parsing and AI job matching. Pick the plan that fits
          how actively you&apos;re searching bigger plans last longer and cost
          less per token.
        </p>
      </header>
      <div className="mt-10 sm:mt-12">
        <PricingTable
          plans={plans}
          checkoutStatus={checkout}
          sessionId={session_id}
        />
      </div>
    </main>
  );
}
