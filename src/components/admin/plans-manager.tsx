"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEur } from "@/lib/plans";
import { cn } from "@/lib/utils";

type Draft = {
  name: string;
  tagline: string;
  priceEur: number;
  tokens: number;
  durationMonths: number;
  recommended: boolean;
  sortOrder: number;
  active: boolean;
};

type AdminPlan = Draft & { id: string };

const EMPTY: Draft = {
  name: "",
  tagline: "",
  priceEur: 9.99,
  tokens: 1000,
  durationMonths: 1,
  recommended: false,
  sortOrder: 0,
  active: true,
};

export function PlansManager() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/plans")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => toast.error("Could not load plans."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Plans & Pricing"
        description="Edit the token plans shown on the pricing page and used by Stripe checkout. Changes take effect immediately, no redeploy."
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((p) => (
            <PlanCard key={p.id} plan={p} onChanged={load} />
          ))}
        </div>
      )}

      <AddPlanForm onCreated={load} />
    </div>
  );
}

function Fields({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name">
        <Input value={draft.name} onChange={(e) => set("name", e.target.value)} className="h-9" />
      </Field>
      <Field label="Tagline">
        <Input value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} className="h-9" />
      </Field>
      <Field label="Price (€)">
        <NumberInput min={0} value={draft.priceEur} onValueChange={(n) => set("priceEur", n)} className="h-9" />
      </Field>
      <Field label="Tokens">
        <NumberInput min={0} allowDecimal={false} value={draft.tokens} onValueChange={(n) => set("tokens", n)} className="h-9" />
      </Field>
      <Field label="Validity (months)">
        <NumberInput min={0} allowDecimal={false} value={draft.durationMonths} onValueChange={(n) => set("durationMonths", n)} className="h-9" />
      </Field>
      <Field label="Sort order">
        <NumberInput min={0} allowDecimal={false} value={draft.sortOrder} onValueChange={(n) => set("sortOrder", n)} className="h-9" />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Toggle on={draft.recommended} onClick={() => set("recommended", !draft.recommended)} label="Recommended" />
        <Toggle on={draft.active} onClick={() => set("active", !draft.active)} label="Active" />
      </div>
    </div>
  );
}

function PlanCard({ plan, onChanged }: { plan: AdminPlan; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(plan);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/plans/${plan.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Plan saved.");
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete the "${plan.name}" plan? This can't be undone.`)) return;
    const res = await fetch(`/api/admin/plans/${plan.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not delete.");
      return;
    }
    toast.success("Plan deleted.");
    onChanged();
  }

  return (
    <div className={cn("rounded-2xl border p-5", draft.active ? "border-border/60 bg-card" : "border-border/60 bg-muted/30")}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{plan.id}</span>
          <span className="font-medium">{formatEur(draft.priceEur)}</span>
          <span className="text-muted-foreground text-sm">· {draft.tokens.toLocaleString()} tokens</span>
          {draft.recommended && <StatusBadge tone="accent">Recommended</StatusBadge>}
          {!draft.active && <StatusBadge tone="muted">Inactive</StatusBadge>}
        </div>
        <Button variant="destructive" size="sm" onClick={remove}>
          <Trash2 />
        </Button>
      </div>
      <Fields draft={draft} set={set} />
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={save} disabled={busy}>Save</Button>
      </div>
    </div>
  );
}

function AddPlanForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function create() {
    setBusy(true);
    const res = await fetch("/api/admin/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...draft }),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not create plan.");
      return;
    }
    toast.success("Plan created.");
    setId("");
    setDraft(EMPTY);
    setOpen(false);
    onCreated();
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="size-4" /> Add plan
      </Button>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/50 bg-accent/[0.05] p-5">
      <h3 className="mb-3 font-medium">New plan</h3>
      <div className="mb-3">
        <Field label="Plan id (slug: lowercase, dashes)">
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. team" className="h-9 max-w-xs" />
        </Field>
      </div>
      <Fields draft={draft} set={set} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={create} disabled={busy || !id.trim() || !draft.name.trim()}>Create</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <Button type="button" variant={on ? "default" : "outline"} size="sm" onClick={onClick}>
      {label}: {on ? "Yes" : "No"}
    </Button>
  );
}
