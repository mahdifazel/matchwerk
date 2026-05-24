"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTokens } from "@/lib/use-token-balance";

type Account = {
  name: string | null;
  email: string;
  image: string | null;
  createdAt: string;
  hasPassword: boolean;
  providers: string[];
  tokenBalance: number;
  tokenDebt: number;
};

export function AccountForm() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => setAccount(d.account ?? null))
      .catch(() => toast.error("Could not load your account."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading account…</p>;
  }
  if (!account) {
    return <p className="text-destructive text-sm">Could not load your account.</p>;
  }

  return (
    <div className="space-y-6">
      <ProfileSection account={account} onSaved={(name) => setAccount({ ...account, name })} />
      <TokensSection balance={account.tokenBalance} debt={account.tokenDebt} />
      <SignInSection account={account} />
      <PasswordSection
        hasPassword={account.hasPassword}
        onSet={() => setAccount({ ...account, hasPassword: true })}
      />
    </div>
  );
}

function TokensSection({ balance, debt }: { balance: number; debt: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tokens</CardTitle>
        <CardDescription>
          Spent on CV parsing, job searches, and AI ratings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Balance</span>
          <span className="font-display text-2xl tabular-nums">
            {formatTokens(balance)}
          </span>
        </div>
        {debt > 0 && (
          <p className="text-muted-foreground text-xs">
            Outstanding debt: {formatTokens(debt)} tokens (covered before your
            balance grows again).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileSection({
  account,
  onSaved,
}: {
  account: Account;
  onSaved: (name: string | null) => void;
}) {
  const [name, setName] = useState(account.name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    const d = await res.json();
    onSaved(d.name ?? null);
    toast.success("Profile updated.");
  }

  const dirty = (account.name ?? "") !== name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>The display name shown in the app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="h-9 max-w-sm"
          />
        </div>
        <Button onClick={save} disabled={!dirty || saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SignInSection({ account }: { account: Account }) {
  const methods: string[] = [];
  if (account.hasPassword) methods.push("Email & password");
  if (account.providers.includes("google")) methods.push("Google");
  if (methods.length === 0) methods.push("—");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in</CardTitle>
        <CardDescription>How you access this account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Email</span>
          <span className="font-medium">{account.email}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Sign-in methods</span>
          <span className="font-medium">{methods.join(" · ")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordSection({
  hasPassword,
  onSet,
}: {
  hasPassword: boolean;
  onSet: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: hasPassword ? current : undefined,
        newPassword: next,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Could not update password.");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    onSet();
    toast.success(hasPassword ? "Password changed." : "Password set.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasPassword ? "Change password" : "Set a password"}</CardTitle>
        <CardDescription>
          {hasPassword
            ? "Update the password you use for email sign-in."
            : "Add a password so you can also sign in with your email, not just Google."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasPassword && (
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-9 max-w-sm"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="h-9 max-w-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-9 max-w-sm"
          />
        </div>
        <Button
          onClick={submit}
          disabled={saving || next.length === 0}
          size="sm"
        >
          {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </Button>
      </CardContent>
    </Card>
  );
}
