import { AppHeader } from "@/components/app-header";
import { AccountForm } from "@/components/account-form";

export default function AccountPage() {
  return (
    <>
      <AppHeader />
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
      </main>
    </>
  );
}
