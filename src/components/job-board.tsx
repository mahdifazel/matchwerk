"use client";

import {
  Briefcase,
  FileText,
  Inbox,
  ListFilter,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, type Filters } from "@/components/filter-bar";
import { JobCard, type JobAction } from "@/components/job-card";
import { RefreshButton } from "@/components/refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ALL_JOB_TYPES,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  SOURCE_META,
} from "@/lib/constants";
import type { JobDTO, RefreshResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL = new Map(SOURCE_META.map((s) => [s.id, s.label]));

const ALL_FILTERS: Filters = {
  locations: [...ALL_LOCATION_IDS],
  seniority: [...ALL_SENIORITY],
  jobTypes: [...ALL_JOB_TYPES],
  sources: [...ALL_SOURCE_IDS],
};

type Tab = "new" | "starred" | "applied";

const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
  { id: "new", label: "New", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "applied", label: "Applied", icon: Briefcase },
];

export function JobBoard() {
  const [tab, setTab] = useState<Tab>("new");
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      tab,
      locations: filters.locations.join(","),
      seniority: filters.seniority.join(","),
      jobTypes: filters.jobTypes.join(","),
      sources: filters.sources.join(","),
    });
    try {
      const res = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      toast.error("Could not load jobs.");
    } finally {
      setLoading(false);
    }
  }, [tab, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => setHasProfile(Boolean(d.profile)))
      .catch(() => setHasProfile(false));
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Refresh failed.");
        return;
      }
      const result = data as RefreshResult;
      const breakdown = result.reports
        .map((r) => {
          const label = SOURCE_LABEL.get(r.id) ?? r.id;
          return r.ran ? `${label}: ${r.count}` : `${label}: skipped`;
        })
        .join(" · ");
      toast.success(
        result.added > 0
          ? `Added ${result.added} new job${result.added === 1 ? "" : "s"} (scanned ${result.scanned}).`
          : `No new jobs — scanned ${result.scanned} listings.`,
        { description: breakdown },
      );
      await fetchJobs();
    } catch {
      toast.error("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [fetchJobs]);

  const handleAction = useCallback(
    async (id: string, action: JobAction) => {
      setPending((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/jobs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          toast.error("Action failed.");
          return;
        }
        setJobs((prev) => prev.filter((j) => j.id !== id));
        const messages: Record<JobAction, string> = {
          star: "Starred.",
          unstar: "Moved back to New.",
          apply: "Marked as applied.",
          delete: "Hidden — won't show again.",
        };
        toast.success(messages[action]);
      } catch {
        toast.error("Action failed.");
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  const handleClearList = useCallback(async () => {
    const ids = jobs.map((j) => j.id);
    if (ids.length === 0) return;
    setClearing(true);
    try {
      const res = await fetch("/api/jobs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not clear the list.");
        return;
      }
      setJobs([]);
      setClearOpen(false);
      toast.success(
        `Cleared ${data.count} job${data.count === 1 ? "" : "s"} — they won't show again.`,
      );
    } catch {
      toast.error("Could not clear the list.");
    } finally {
      setClearing(false);
    }
  }, [jobs]);

  const emptyByTab: Record<
    Tab,
    { icon: typeof Inbox; title: string; description: string }
  > = {
    new: {
      icon: Inbox,
      title: "No matching jobs yet",
      description:
        "Hit Research jobs to pull fresh listings and score them against your CV.",
    },
    starred: {
      icon: Star,
      title: "Nothing starred",
      description: "Star jobs from New to keep them here.",
    },
    applied: {
      icon: Briefcase,
      title: "No applications logged",
      description: "Jobs you apply to will be tracked here with a timestamp.",
    },
  };

  const stats = useMemo(() => {
    let strong = 0;
    let good = 0;
    for (const j of jobs) {
      if (j.matchScore == null) continue;
      if (j.matchScore >= 90) strong++;
      else if (j.matchScore >= 70) good++;
    }
    return { total: jobs.length, strong, good };
  }, [jobs]);

  return (
    <div className="space-y-10 sm:space-y-12">
      {/* ── Editorial hero ─────────────────────────────────────────── */}
      <section className="pt-6 sm:pt-10">
        <p className="eyebrow mb-5">AI-matched · Germany · 2026</p>
        <h1 className="font-display text-[2.25rem] leading-[1.1] tracking-tight sm:text-[3rem]">
          Product Design jobs,
          <br className="hidden sm:block" />
          <span className="text-foreground/85"> ranked for you.</span>
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-[1rem] leading-relaxed">
          One quiet feed. Continuously scanned across BA Jobbörse, JSearch and
          Adzuna — each listing scored against your CV.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-5">
          <RefreshButton refreshing={refreshing} onClick={handleRefresh} />
          <StatStrip
            total={stats.total}
            strong={stats.strong}
            good={stats.good}
          />
        </div>
      </section>

      {hasProfile === false && (
        <Alert className="flex flex-wrap items-center justify-between gap-3 rounded-2xl">
          <FileText className="size-4" />
          <div className="flex-1">
            <AlertTitle>No CV on file</AlertTitle>
            <AlertDescription>
              Upload one so jobs can be matched and scored.
            </AlertDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/settings" />}
          >
            Upload CV
          </Button>
        </Alert>
      )}

      {/* ── Section header: tabs + filter trigger ─────────────────── */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-3">
          <div className="flex items-baseline gap-1">
            <span className="eyebrow">Listings</span>
            <span aria-hidden className="text-muted-foreground/50 mx-2">
              /
            </span>
            <nav className="flex items-center gap-1" aria-label="Job tabs">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.95rem] font-medium tracking-tight transition-colors",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <t.icon className="size-3.5" />
                    {t.label}
                    <span
                      aria-hidden
                      className={cn(
                        "bg-foreground pointer-events-none absolute inset-x-2 -bottom-[13px] h-px origin-left transition-transform duration-200",
                        active ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground gap-1.5"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <ListFilter className="size-3.5" />
              {showFilters ? "Hide filters" : "Filters"}
            </Button>
            {!loading && jobs.length > 0 && (
              <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground gap-1.5"
                    />
                  }
                >
                  <Trash2 className="size-3.5" />
                  Clear
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear this list?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This hides all {jobs.length} job
                      {jobs.length === 1 ? "" : "s"} currently shown. Deleted
                      jobs won&apos;t appear again, even after a refresh.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clearing}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={clearing}
                      onClick={(e) => {
                        e.preventDefault();
                        handleClearList();
                      }}
                    >
                      {clearing ? "Clearing…" : "Clear list"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="border-border/70 bg-card/40 rounded-2xl border p-4 mt-4 ring-1 ring-foreground/[0.03]">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(ALL_FILTERS)}
            />
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <p className="text-muted-foreground mt-3 text-xs tabular-nums">
            <span className="font-mono">{jobs.length}</span>{" "}
            {jobs.length === 1 ? "listing" : "listings"}
          </p>
        )}
      </section>

      {/* ── Results ───────────────────────────────────────────────── */}
      <section className="!mt-6">
        {loading ? (
          <div className="grid gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={(() => {
              const Icon = emptyByTab[tab].icon;
              return <Icon className="size-5" />;
            })()}
            title={emptyByTab[tab].title}
            description={emptyByTab[tab].description}
            action={
              tab === "new" ? (
                <RefreshButton refreshing={refreshing} onClick={handleRefresh} />
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                pending={pending.has(job.id)}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatStrip({
  total,
  strong,
  good,
}: {
  total: number;
  strong: number;
  good: number;
}) {
  return (
    <dl className="flex items-center gap-x-5 gap-y-2 text-sm">
      <Stat label="In view" value={total} />
      <span className="bg-border/80 h-7 w-px" aria-hidden />
      <Stat
        label="Strong fits"
        sublabel="90+"
        value={strong}
        accent="chartreuse"
      />
      <span className="bg-border/80 h-7 w-px" aria-hidden />
      <Stat label="Good fits" sublabel="70–89" value={good} accent="lavender" />
    </dl>
  );
}

function Stat({
  label,
  sublabel,
  value,
  accent,
}: {
  label: string;
  sublabel?: string;
  value: number;
  accent?: "chartreuse" | "lavender";
}) {
  const dotCls =
    accent === "chartreuse"
      ? "bg-[#DCCE40]"
      : accent === "lavender"
        ? "bg-[#C4AEF4]"
        : "bg-muted-foreground/40";
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={cn("inline-block size-1.5 translate-y-[-2px] rounded-full", dotCls)}
      />
      <dt className="text-muted-foreground text-[0.85rem] tracking-tight">
        {label}
        {sublabel && (
          <span className="text-muted-foreground/70 ml-1 font-mono text-[0.72rem]">
            {sublabel}
          </span>
        )}
      </dt>
      <dd className="font-display text-foreground text-[1.6rem] leading-none tabular-nums">
        {value}
      </dd>
    </div>
  );
}
