import { Mail } from "lucide-react";
import Link from "next/link";
import { AccountForm } from "@/components/account-form";

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-5 pb-24 sm:px-8">
      <header className="pt-10">
        <p className="eyebrow mb-4">Account</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] tracking-tight sm:text-[2.6rem]">
          Your account
        </h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-[0.95rem] leading-relaxed">
          Manage your profile, sign-in methods, and password.
        </p>
      </header>
      <AccountForm />
      {/* Quiet support entry point — reads as "support is here when you need
          it" rather than a primary action. Card matches the existing
          AccountForm chrome (border-border/60 + rounded-2xl). */}
      <Link
        href="/contact"
        className="border-border/60 bg-card hover:border-foreground/30 group flex items-center justify-between gap-4 rounded-2xl border p-5 transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Mail className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Need help, or have feedback?</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Send us a note — we read every message.
            </p>
          </div>
        </div>
        <span className="text-muted-foreground group-hover:text-foreground text-xs font-medium uppercase tracking-wide transition-colors">
          Contact →
        </span>
      </Link>
    </main>
  );
}
