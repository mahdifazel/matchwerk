import { redirect } from "next/navigation";
import { ContactForm } from "@/components/contact-form";
import { getSessionUser } from "@/lib/repo";

export const metadata = {
  title: "Contact us — Matchwerk",
};

/**
 * Logged-in feedback channel. The proxy redirects unauthenticated users to
 * /login already, but this second check guarantees the form never renders
 * for an anonymous viewer (e.g. via a stale tab after sign-out).
 */
export default async function ContactPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?callbackUrl=%2Fcontact");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-10 pb-24 sm:px-8">
      <header className="mb-10">
        <p className="eyebrow mb-3">Contact</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] tracking-tight sm:text-[2.6rem]">
          Send us a note
        </h1>
        <p className="text-muted-foreground mt-3 max-w-prose text-[0.95rem] leading-relaxed">
          Bug to report, idea for a feature, or a question we haven&apos;t covered?
          Drop it below — your account details come along automatically so we
          can reply.
        </p>
      </header>

      <div className="border-border/60 bg-card rounded-2xl border p-6 shadow-sm sm:p-8">
        <ContactForm name={user.name ?? ""} email={user.email} />
      </div>
    </main>
  );
}
