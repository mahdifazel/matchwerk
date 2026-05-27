"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge, StatusDot } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Result = {
  id: string;
  label: string;
  kind: "ai" | "source";
  configured: boolean;
  ok: boolean;
  rateLimited: boolean;
  latencyMs: number | null;
  error: string | null;
};

export default function AdminHealthPage() {
  const [results, setResults] = useState<Result[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(() => {
    return fetch("/api/admin/system/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setResults(d.results ?? []);
        setCheckedAt(d.checkedAt ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  function recheck() {
    setLoading(true);
    fetchHealth();
  }

  const ai = results.filter((r) => r.kind === "ai");
  const sources = results.filter((r) => r.kind === "source");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="API Health"
        description={`Live status of every external API. Each check makes one lightweight request to each configured service${checkedAt ? ` · last checked ${new Date(checkedAt).toLocaleTimeString()}` : ""}.`}
      >
        <Button size="sm" variant="outline" onClick={recheck} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Re-check
        </Button>
      </AdminPageHeader>

      {loading && results.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <>
          <Group title="AI providers" results={ai} />
          <Group title="Job sources" results={sources} />
        </>
      )}
    </div>
  );
}

function Group({ title, results }: { title: string; results: Result[] }) {
  return (
    <section className="space-y-2">
      <h2 className="eyebrow">{title}</h2>
      <div className="border-border/60 bg-card divide-border/60 divide-y rounded-2xl border">
        {results.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <StatusDot
                tone={
                  !r.configured ? "idle" : r.ok ? "ok" : r.rateLimited ? "warn" : "error"
                }
              />
              <div className="min-w-0">
                <div className="font-medium">{r.label}</div>
                {r.error && (
                  <div
                    className={cn(
                      "truncate text-xs",
                      r.rateLimited ? "text-amber-700 dark:text-amber-400" : "text-destructive",
                    )}
                  >
                    {r.error}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {r.latencyMs != null && (
                <span className="text-muted-foreground text-xs tabular-nums">{r.latencyMs} ms</span>
              )}
              {!r.configured ? (
                <StatusBadge tone="muted">Not configured</StatusBadge>
              ) : r.ok ? (
                <StatusBadge tone="ok">Operational</StatusBadge>
              ) : r.rateLimited ? (
                <StatusBadge tone="warn">Rate-limited</StatusBadge>
              ) : (
                <StatusBadge tone="error">Down</StatusBadge>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

