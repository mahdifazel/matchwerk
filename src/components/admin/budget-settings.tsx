"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";

type Config = { tokensPerDay: number; aiRequestsPerDay: number; aiErrorsPerDay: number };

export function BudgetSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/budget")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setConfig(d.config ?? null))
      .catch(() => toast.error("Could not load budget alerts."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!config) return;
    setBusy(true);
    const res = await fetch("/api/admin/system/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Budget alerts saved.");
  }

  if (!config) return <Skeleton className="h-32 rounded-2xl" />;

  return (
    <div className="border-border/60 bg-card rounded-2xl border p-5">
      <p className="text-muted-foreground mb-4 text-sm">
        Alert on the dashboard when a daily threshold is crossed (resets at UTC
        midnight). Set to <strong>0</strong> to disable. Alerts are in-app only;
        email would need an email provider.
      </p>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
        <Num label="Tokens used / day" value={config.tokensPerDay} onChange={(v) => setConfig({ ...config, tokensPerDay: v })} />
        <Num label="AI requests / day" value={config.aiRequestsPerDay} onChange={(v) => setConfig({ ...config, aiRequestsPerDay: v })} />
        <Num label="AI failures / day" value={config.aiErrorsPerDay} onChange={(v) => setConfig({ ...config, aiErrorsPerDay: v })} />
      </div>
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={busy}>Save thresholds</Button>
      </div>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <NumberInput
        min={0}
        allowDecimal={false}
        value={value}
        onValueChange={onChange}
        className="h-9"
      />
    </div>
  );
}
