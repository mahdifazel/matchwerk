"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Field = {
  id: string;
  label: string;
  secret: boolean;
  set: boolean;
  masked: string | null;
  origin: "db" | "env" | "none";
};

type Source = {
  id: string;
  label: string;
  tier: "primary" | "backup" | "fallback";
  connected: boolean;
  editable: boolean;
  configured: boolean;
  enabled: boolean;
  fields: Field[];
};

export function SourceSettings() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/system/sources")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSources(d.sources ?? []))
      .catch(() => toast.error("Could not load sources."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.map((s) => (
        <SourceRow key={s.id} source={s} onChanged={load} />
      ))}
    </div>
  );
}

function SourceRow({ source, onChanged }: { source: Source; onChanged: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function put(body: object, msg: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/system/sources/${source.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    setValues({});
    toast.success(msg);
    onChanged();
  }

  const hasInput = Object.values(values).some((v) => v.trim().length > 0);

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        source.enabled ? "border-border/60 bg-card" : "border-border/60 bg-muted/30",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{source.label}</span>
          <Badge variant="outline" className="capitalize">{source.tier}</Badge>
          {!source.connected ? (
            <StatusBadge tone="muted">No adapter</StatusBadge>
          ) : source.editable && !source.configured ? (
            <StatusBadge tone="warn">Key needed</StatusBadge>
          ) : (
            <StatusBadge tone="ok">Ready</StatusBadge>
          )}
        </div>
        <Button
          size="sm"
          variant={source.enabled ? "outline" : "default"}
          disabled={busy}
          onClick={() => put({ enabled: !source.enabled }, source.enabled ? "Source disabled." : "Source enabled.")}
        >
          {source.enabled ? "Disable" : "Enable"}
        </Button>
      </div>

      {source.editable && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-end gap-2">
            {source.fields.map((f) => (
              <div key={f.id} className="min-w-[12rem] flex-1">
                <label className="text-muted-foreground mb-1 block text-xs">
                  {f.label}
                  {f.set && (
                    <span className="ml-1.5">
                      {f.masked} ({f.origin === "env" ? "env" : "stored"})
                    </span>
                  )}
                </label>
                <Input
                  type={f.secret ? "password" : "text"}
                  value={values[f.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  placeholder={f.set ? "Replace…" : "Paste value…"}
                  className="h-9"
                />
              </div>
            ))}
            <Button
              size="sm"
              disabled={busy || !hasInput}
              onClick={() => put({ credentials: values }, "Keys saved.")}
            >
              Save
            </Button>
            {source.fields.some((f) => f.origin === "db") && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => put({ clear: true }, "Keys removed.")}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
