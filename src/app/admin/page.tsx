"use client";

import {
  AlertTriangle,
  Briefcase,
  Coins,
  CreditCard,
  Download,
  Search,
  Sparkles,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminEmpty, Panel, StatCard } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SOURCE_META } from "@/lib/constants";
import { formatTokens } from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

type Daily = { date: string; searches: number; tokensConsumed: number; revenue: number; signups: number };

type Analytics = {
  kpis: {
    totalUsers: number;
    activeUsers: number;
    newUsers30d: number;
    jobsStored: number;
    revenueAllTime: number;
    revenue30d: number;
    tokensSold: number;
    tokensConsumed30d: number;
    searches30d: number;
  };
  daily: Daily[];
  tokenFlowByReason: { reason: string; delta: number }[];
  jobsBySource: { source: string; count: number }[];
  topUsers: { id: string; email: string; name: string | null; tokensConsumed: number }[];
  aiProviders: { provider: string; ok: number; errors: number; total: number }[];
  recentErrors: {
    id: string;
    provider: string | null;
    operation: string | null;
    error: string | null;
    createdAt: string;
  }[];
};

const eur = (n: number) => `€${n.toFixed(2)}`;

const METRICS = [
  { key: "searches", label: "Searches", fmt: (n: number) => String(n) },
  { key: "tokensConsumed", label: "Tokens used", fmt: (n: number) => formatTokens(n) },
  { key: "revenue", label: "Revenue", fmt: eur },
  { key: "signups", label: "Signups", fmt: (n: number) => String(n) },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

// Each metric gets a brand chart color (adapts across light/dark via tokens).
const METRIC_BAR: Record<MetricKey, string> = {
  searches: "bg-chart-3", // lavender
  tokensConsumed: "bg-chart-4", // chartreuse
  revenue: "bg-chart-5", // sage
  signups: "bg-chart-2", // muted purple
};

const REASON_LABEL: Record<string, string> = {
  signup_grant: "Signup grants",
  cv_parse: "CV parsing",
  research: "Job research",
  purchase: "Purchases",
  admin_grant: "Admin grants",
  admin_deduct: "Admin deductions",
  refund: "Refunds",
};

const SOURCE_LABEL = new Map<string, string>(SOURCE_META.map((s) => [s.id, s.label]));

type BudgetAlert = { key: string; label: string; value: number; threshold: number };

export default function AdminDashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<MetricKey>("searches");
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/admin/alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAlerts(d?.alerts ?? []))
      .catch(() => {});
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const k = data.kpis;
  const activeMetric = METRICS.find((m) => m.key === metric)!;
  const maxVal = Math.max(1, ...data.daily.map((d) => d[metric]));

  return (
    <div className="space-y-8">
      <AdminPageHeader title="Dashboard" description="Platform health over the last 30 days.">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => window.open("/api/admin/analytics/pdf", "_blank")}
        >
          <Download className="size-3.5" />
          Download PDF
        </Button>
      </AdminPageHeader>

      {alerts.length > 0 && (
        <div className="border-destructive/40 bg-destructive/10 rounded-2xl border p-4">
          <p className="text-destructive flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4" />
            Budget alerts
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.key} className="text-muted-foreground">
                <span className="text-foreground font-medium">{a.label}</span>:{" "}
                <span className="tabular-nums">
                  {a.key === "tokens" ? formatTokens(a.value) : a.value.toLocaleString()}
                </span>{" "}
                exceeded the threshold of{" "}
                <span className="tabular-nums">
                  {a.key === "tokens" ? formatTokens(a.threshold) : a.threshold.toLocaleString()}
                </span>
                .
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tint="lavender" icon={Users} label="Total users" value={k.totalUsers.toLocaleString()} sub={`${k.activeUsers} active`} />
        <StatCard tint="lavender" icon={UserPlus} label="New (30d)" value={k.newUsers30d.toLocaleString()} />
        <StatCard tint="sage" icon={Search} label="Searches (30d)" value={k.searches30d.toLocaleString()} />
        <StatCard tint="chartreuse" icon={Sparkles} label="Tokens used (30d)" value={formatTokens(k.tokensConsumed30d)} />
        <StatCard tint="chartreuse" icon={CreditCard} label="Revenue (30d)" value={eur(k.revenue30d)} accent />
        <StatCard tint="chartreuse" icon={CreditCard} label="Revenue (all-time)" value={eur(k.revenueAllTime)} />
        <StatCard tint="chartreuse" icon={Coins} label="Tokens sold" value={formatTokens(k.tokensSold)} />
        <StatCard tint="sage" icon={Briefcase} label="Jobs stored" value={k.jobsStored.toLocaleString()} />
      </div>

      <Panel
        title="Daily · last 30 days"
        actions={
          <div className="border-border/60 inline-flex rounded-lg border p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  metric === m.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex h-40 items-end gap-1">
          {data.daily.map((d) => {
            const v = d[metric];
            return (
              <div
                key={d.date}
                className={cn(
                  METRIC_BAR[metric],
                  "min-h-[2px] flex-1 rounded-t opacity-90 transition-opacity hover:opacity-100",
                )}
                style={{ height: `${(v / maxVal) * 100}%` }}
                title={`${d.date}: ${activeMetric.fmt(v)}`}
              />
            );
          })}
        </div>
        <div className="text-muted-foreground mt-2 flex justify-between text-[0.7rem] tabular-nums">
          <span>{data.daily[0]?.date}</span>
          <span>{data.daily[data.daily.length - 1]?.date}</span>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Token flow by reason">
          <Bars
            items={data.tokenFlowByReason.map((r) => ({ label: REASON_LABEL[r.reason] ?? r.reason, value: r.delta }))}
            variant="signed"
            format={(n) => formatTokens(n)}
          />
        </Panel>
        <Panel title="Jobs by source">
          <Bars
            items={data.jobsBySource.map((s) => ({ label: SOURCE_LABEL.get(s.source) ?? s.source, value: s.count }))}
            variant="palette"
            format={(n) => n.toLocaleString()}
          />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Most active users · by AI usage">
          {data.topUsers.length === 0 ? (
            <AdminEmpty>No usage yet.</AdminEmpty>
          ) : (
            <ol className="space-y-2">
              {data.topUsers.map((u, i) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
                    {u.name || u.email}
                  </span>
                  <span className="tabular-nums">{formatTokens(u.tokensConsumed)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="AI providers">
          {data.aiProviders.length === 0 ? (
            <AdminEmpty>No AI requests recorded yet.</AdminEmpty>
          ) : (
            <ul className="space-y-2">
              {data.aiProviders.map((p) => (
                <li key={p.provider} className="flex items-center justify-between gap-3 text-sm">
                  <span className="capitalize">{p.provider}</span>
                  <span className="tabular-nums">
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">
                      {p.ok.toLocaleString()} ok
                    </span>
                    {p.errors > 0 && (
                      <span className="text-destructive ml-2">{p.errors.toLocaleString()} failed</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent failed requests">
        {data.recentErrors.length === 0 ? (
          <AdminEmpty>No errors logged. 🎉</AdminEmpty>
        ) : (
          <div className="divide-border/60 -my-2 divide-y">
            {data.recentErrors.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium capitalize">{e.provider ?? "—"}</span>
                  <span className="text-muted-foreground"> · {e.operation ?? "—"}</span>
                  <span className="text-muted-foreground block truncate text-xs">{e.error ?? ""}</span>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const PALETTE = ["bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-1", "bg-chart-2"];

function Bars({
  items,
  format,
  variant,
}: {
  items: { label: string; value: number }[];
  format: (n: number) => string;
  variant?: "signed" | "palette";
}) {
  if (items.length === 0) return <AdminEmpty>No data yet.</AdminEmpty>;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => {
        const barColor =
          variant === "signed"
            ? it.value < 0
              ? "bg-destructive/70"
              : "bg-chart-5"
            : variant === "palette"
              ? PALETTE[i % PALETTE.length]
              : "bg-primary/70";
        return (
          <div key={it.label} className="text-sm">
            <div className="mb-1 flex justify-between">
              <span>{it.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {variant === "signed" && it.value > 0 ? "+" : ""}
                {format(it.value)}
              </span>
            </div>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full", barColor)}
                style={{ width: `${(Math.abs(it.value) / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
