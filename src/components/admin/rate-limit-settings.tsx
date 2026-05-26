"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Limits = { researchPerHour: number; cvPerDay: number };

export function RateLimitSettings() {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/limits")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setLimits(d.limits ?? null))
      .catch(() => toast.error("Could not load rate limits."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!limits) return;
    setBusy(true);
    const res = await fetch("/api/admin/system/limits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limits),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Rate limits saved.");
  }

  if (!limits) return <Skeleton className="h-28 rounded-2xl" />;

  return (
    <div className="border-border/60 bg-card rounded-2xl border p-5">
      <p className="text-muted-foreground mb-4 text-sm">
        Cap expensive actions per user. Set to <strong>0</strong> for unlimited.
        Balance gates (≥25 tokens to parse a CV, &gt;0 to research) always apply.
      </p>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Research runs / hour</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={limits.researchPerHour}
            onChange={(e) => setLimits({ ...limits, researchPerHour: Number(e.target.value) })}
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">CV uploads / day</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={limits.cvPerDay}
            onChange={(e) => setLimits({ ...limits, cvPerDay: Number(e.target.value) })}
            className="h-9"
          />
        </div>
      </div>
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={busy}>Save limits</Button>
      </div>
    </div>
  );
}
