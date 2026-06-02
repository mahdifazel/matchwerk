"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Category = "QUESTION" | "BUG" | "FEATURE_REQUEST" | "OTHER";
type Status = "NEW" | "READ" | "REPLIED";

type Message = {
  id: string;
  userId: string;
  name: string;
  email: string;
  subject: string;
  category: Category;
  status: Status;
  createdAt: string;
};

const CATEGORY_LABEL: Record<Category, string> = {
  QUESTION: "Question",
  BUG: "Bug",
  FEATURE_REQUEST: "Feature",
  OTHER: "Other",
};

const STATUS_TONE = {
  NEW: "primary",
  READ: "muted",
  REPLIED: "ok",
} as const;

const STATUS_FILTERS: { id: Status | "ALL"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "NEW", label: "New" },
  { id: "READ", label: "Read" },
  { id: "REPLIED", label: "Replied" },
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function ContactMessagesManager() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/messages?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter, q]);

  useEffect(() => {
    // Tiny debounce so typing in the search box doesn't fire one request per
    // keystroke. AbortController on fetch is overkill here; the request list
    // is bounded by 200 rows and the API is local.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  function refresh() {
    setLoading(true);
    load();
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Messages"
        description="Feedback, bug reports, and questions submitted through the /contact form. Click a row to read the full message and mark it read or replied."
      >
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </AdminPageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted/50",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto w-full max-w-xs">
          <Input
            placeholder="Search subject, name, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      {loading && messages.length === 0 ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : messages.length === 0 ? (
        <div className="border-border/60 bg-card rounded-2xl border p-10 text-center">
          <p className="text-muted-foreground text-sm">
            {q || statusFilter !== "ALL"
              ? "No messages match this filter."
              : "No contact messages yet."}
          </p>
        </div>
      ) : (
        <div className="border-border/60 bg-card divide-border/60 divide-y rounded-2xl border">
          {messages.map((m) => (
            <Link
              key={m.id}
              href={`/admin/messages/${m.id}`}
              className="hover:bg-muted/40 block px-4 py-3 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={STATUS_TONE[m.status]}>
                      {m.status === "NEW" ? "New" : m.status === "READ" ? "Read" : "Replied"}
                    </StatusBadge>
                    <StatusBadge tone="muted">{CATEGORY_LABEL[m.category]}</StatusBadge>
                    <span className="text-foreground truncate text-sm font-medium">
                      {m.subject}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {m.name} · {m.email}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {formatRelative(m.createdAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
