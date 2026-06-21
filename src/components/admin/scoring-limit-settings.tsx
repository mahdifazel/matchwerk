"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";

type Scoring = { maxScoreCandidates: number };

export function ScoringLimitSettings() {
  const [scoring, setScoring] = useState<Scoring | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/scoring")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setScoring(d.scoring ?? null))
      .catch(() => toast.error("Could not load scoring settings."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!scoring) return;
    setBusy(true);
    const res = await fetch("/api/admin/system/scoring", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scoring),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Scoring settings saved.");
  }

  if (!scoring) return <Skeleton className="h-28 rounded-2xl" />;

  return (
    <div className="border-border/60 bg-card rounded-2xl border p-5">
      <p className="text-muted-foreground mb-4 text-sm">
        How many fresh jobs each Research run sends to AI scoring. The best
        matches are scored first (pre-ranked), so a lower number trims cost by
        dropping only the weakest tail. Lower = cheaper; higher = wider coverage.
      </p>
      <div className="grid max-w-md gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Jobs scored per Research (10&ndash;150)</Label>
          <NumberInput
            min={10}
            max={150}
            allowDecimal={false}
            value={scoring.maxScoreCandidates}
            onValueChange={(n) => setScoring({ maxScoreCandidates: n })}
            className="h-9"
          />
        </div>
      </div>
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={busy}>Save scoring</Button>
      </div>
    </div>
  );
}
