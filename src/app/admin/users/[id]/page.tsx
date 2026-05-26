"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/generated/prisma/enums";
import { formatTokens } from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

type LedgerRow = {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  metadata: Record<string, unknown> | null;
  stripeSessionId: string | null;
  createdAt: string;
};

type Detail = {
  user: {
    id: string;
    name: string | null;
    email: string;
    role: UserRole;
    disabled: boolean;
    tokenBalance: number;
    tokenDebt: number;
    createdAt: string;
    hasPassword: boolean;
    providers: string[];
    cv: { fileName: string; parsedAt: string } | null;
    jobTitles: string[];
  };
  jobs: Record<string, number>;
  ledger: LedgerRow[];
  canMutate: boolean;
};

const REASON_LABEL: Record<string, string> = {
  signup_grant: "Signup grant",
  cv_parse: "CV parse",
  research: "Job research",
  purchase: "Purchase",
  admin_grant: "Admin grant",
  admin_deduct: "Admin deduction",
};

const PAYMENT_REASONS = new Set(["purchase"]);
const USAGE_REASONS = new Set(["cv_parse", "research"]);

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerView, setLedgerView] = useState<"all" | "payments" | "usage">("all");
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/users/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d))
      .catch(() => toast.error("Could not load user."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  const { user, jobs, ledger, canMutate } = data;
  const filteredLedger = ledger.filter((l) =>
    ledgerView === "all"
      ? true
      : ledgerView === "payments"
        ? PAYMENT_REASONS.has(l.reason)
        : USAGE_REASONS.has(l.reason),
  );
  const refundedSessions = new Set(
    ledger
      .filter((l) => l.reason === "refund")
      .map((l) => (l.metadata as { originalSessionId?: string } | null)?.originalSessionId)
      .filter((s): s is string => Boolean(s)),
  );

  async function refund(ledgerId: string) {
    if (
      !confirm(
        "Refund this purchase? This issues a Stripe refund and reverses the granted tokens.",
      )
    ) {
      return;
    }
    setRefundingId(ledgerId);
    const res = await fetch(`/api/admin/users/${id}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledgerId }),
    });
    setRefundingId(null);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Refund failed.");
      return;
    }
    toast.success("Purchase refunded.");
    load();
  }

  async function deleteUser() {
    if (
      !confirm(
        `Permanently delete ${user.email} and ALL their data (jobs, history, profile)? This cannot be undone.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not delete account.");
      return;
    }
    toast.success("Account permanently deleted.");
    router.push("/admin/users");
  }

  async function impersonate() {
    const res = await fetch(`/api/admin/users/${id}/impersonate`, { method: "POST" });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not impersonate.");
      return;
    }
    // Full reload so the impersonation cookie takes effect everywhere.
    window.location.href = "/";
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        All users
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.8rem] leading-tight tracking-tight">
            {user.name || user.email}
          </h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
          <div className="mt-2 flex items-center gap-2">
            {user.role === "SUPER_ADMIN" ? (
              <Badge>Super Admin</Badge>
            ) : user.role === "ADMIN" ? (
              <Badge variant="secondary">Admin</Badge>
            ) : (
              <Badge variant="outline">User</Badge>
            )}
            {user.disabled ? (
              <StatusBadge tone="error">Deactivated</StatusBadge>
            ) : (
              <StatusBadge tone="ok">Active</StatusBadge>
            )}
          </div>
        </div>
        {canMutate && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={impersonate}>
              Impersonate
            </Button>
            <StatusToggle
              userId={user.id}
              disabled={user.disabled}
              onChanged={load}
            />
          </div>
        )}
      </header>

      {!canMutate && (
        <p className="text-muted-foreground border-border/60 bg-muted/40 rounded-lg border px-3 py-2 text-xs">
          Read-only — only a Super Admin can modify admin accounts.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <TokensCard user={user} canMutate={canMutate} onChanged={load} />
        <ProfileCard user={user} jobs={jobs} onChanged={load} canMutate={canMutate} />
      </div>

      {canMutate && (
        <Card>
          <CardHeader>
            <CardTitle>Data &amp; privacy</CardTitle>
            <CardDescription>
              Export this user&apos;s data, or erase the account and all of its
              data (GDPR).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/api/admin/users/${id}/export`, "_blank")}
            >
              Export data (JSON)
            </Button>
            <Button size="sm" variant="destructive" onClick={deleteUser}>
              Delete account
            </Button>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow">Activity &amp; payment history</h2>
          <div className="border-border/60 bg-card inline-flex rounded-lg border p-0.5">
            {(["all", "payments", "usage"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLedgerView(v)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  ledgerView === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="border-border/60 bg-card divide-border/60 divide-y rounded-2xl border">
          {filteredLedger.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">No entries.</p>
          ) : (
            filteredLedger.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">
                    {REASON_LABEL[l.reason] ?? l.reason}
                    {l.reason === "purchase" &&
                      typeof l.metadata?.planName === "string" &&
                      ` · ${l.metadata.planName}`}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {new Date(l.createdAt).toLocaleString()}
                    {typeof l.metadata?.note === "string" && l.metadata.note
                      ? ` · ${l.metadata.note}`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {l.reason === "purchase" && l.stripeSessionId && (
                    refundedSessions.has(l.stripeSessionId) ? (
                      <StatusBadge tone="muted">Refunded</StatusBadge>
                    ) : canMutate ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={refundingId === l.id}
                        onClick={() => refund(l.id)}
                      >
                        {refundingId === l.id ? "Refunding…" : "Refund"}
                      </Button>
                    ) : null
                  )}
                  <div className="text-right tabular-nums">
                    <span className={l.delta >= 0 ? "text-foreground" : "text-muted-foreground"}>
                      {l.delta >= 0 ? "+" : ""}
                      {formatTokens(l.delta)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      → {formatTokens(l.balanceAfter)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatusToggle({
  userId,
  disabled,
  onChanged,
}: {
  userId: string;
  disabled: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !disabled }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Could not update status.");
      return;
    }
    toast.success(disabled ? "User activated." : "User deactivated.");
    onChanged();
  }
  return (
    <Button
      variant={disabled ? "default" : "destructive"}
      size="sm"
      onClick={toggle}
      disabled={busy}
    >
      {disabled ? "Activate" : "Deactivate"}
    </Button>
  );
}

function TokensCard({
  user,
  canMutate,
  onChanged,
}: {
  user: Detail["user"];
  canMutate: boolean;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function adjust(sign: 1 | -1) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/users/${user.id}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta: sign * n, note: note || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Could not adjust tokens.");
      return;
    }
    setAmount("");
    setNote("");
    toast.success(sign > 0 ? `Granted ${formatTokens(n)} tokens.` : `Deducted ${formatTokens(n)} tokens.`);
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tokens</CardTitle>
        <CardDescription>Adjust the balance with a reason for the audit log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-6">
          <div>
            <div className="text-muted-foreground text-xs">Balance</div>
            <div className="font-display text-2xl tabular-nums">
              {formatTokens(user.tokenBalance)}
            </div>
          </div>
          {user.tokenDebt > 0 && (
            <div>
              <div className="text-muted-foreground text-xs">Debt</div>
              <div className="font-display text-destructive text-2xl tabular-nums">
                {formatTokens(user.tokenDebt)}
              </div>
            </div>
          )}
        </div>

        {canMutate && (
          <div className="space-y-2.5 border-t border-border/60 pt-4">
            <div className="flex gap-2">
              <div className="w-32">
                <Label htmlFor="amount" className="sr-only">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount"
                  className="h-9"
                />
              </div>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason (optional)"
                className="h-9 flex-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => adjust(1)} disabled={busy}>
                Grant
              </Button>
              <Button size="sm" variant="outline" onClick={() => adjust(-1)} disabled={busy}>
                Deduct
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCard({
  user,
  jobs,
  canMutate,
  onChanged,
}: {
  user: Detail["user"];
  jobs: Record<string, number>;
  canMutate: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = (user.name ?? "") !== name;

  async function saveName() {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Saved.");
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Account details and activity.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {canMutate ? (
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="—"
                className="h-9"
              />
              <Button size="sm" onClick={saveName} disabled={!dirty || busy}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <Field label="Name" value={user.name || "—"} />
        )}
        <Field label="Sign-in" value={[user.hasPassword && "Password", user.providers.includes("google") && "Google"].filter(Boolean).join(" · ") || "—"} />
        <Field label="CV" value={user.cv ? `${user.cv.fileName} · parsed ${new Date(user.cv.parsedAt).toLocaleDateString()}` : "None uploaded"} />
        <Field label="Target titles" value={user.jobTitles.length ? user.jobTitles.join(", ") : "—"} />
        <Field
          label="Jobs"
          value={
            Object.keys(jobs).length
              ? Object.entries(jobs).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(" · ")
              : "None"
          }
        />
        <Field label="Joined" value={new Date(user.createdAt).toLocaleDateString()} />
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
