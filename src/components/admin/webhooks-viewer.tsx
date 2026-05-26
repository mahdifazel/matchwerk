"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Event = {
  id: string;
  type: string;
  status: "processed" | "ignored" | "error";
  summary: string | null;
  error: string | null;
  createdAt: string;
};

export function WebhooksViewer() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/webhooks")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    setLoading(true);
    load();
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stripe Events"
        description="Verified Stripe webhook events and how each was handled. Events appear only when a webhook secret is configured and Stripe is delivering (locally via `stripe listen`)."
      >
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </AdminPageHeader>

      {loading && events.length === 0 ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No webhook events recorded yet.</p>
      ) : (
        <div className="border-border/60 bg-card divide-border/60 divide-y rounded-2xl border">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <EventBadge status={e.status} />
                  <span className="font-mono text-xs">{e.type}</span>
                </div>
                {e.summary && (
                  <div className="text-muted-foreground mt-1 truncate text-xs">{e.summary}</div>
                )}
                {e.error && (
                  <div className="text-destructive mt-1 truncate text-xs">{e.error}</div>
                )}
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventBadge({ status }: { status: Event["status"] }) {
  if (status === "processed") return <StatusBadge tone="ok">Processed</StatusBadge>;
  if (status === "error") return <StatusBadge tone="error">Error</StatusBadge>;
  return <StatusBadge tone="muted">Ignored</StatusBadge>;
}
