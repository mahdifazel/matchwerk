"use client";

import {
  Briefcase,
  Coins,
  FileText,
  Inbox,
  ListFilter,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LOW_TOKEN_THRESHOLD } from "@/lib/plans";
import type { JobDTO, RefreshResult, SettingsDTO } from "@/lib/types";
import {
  formatTokens,
  notifyTokensUpdated,
  useTokenBalance,
} from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

const SOURCE_LABEL = new Map(SOURCE_META.map((s) => [s.id, s.label]));

const ALL_FILTERS: Filters = {
  locations: [...ALL_LOCATION_IDS],
  seniority: [...ALL_SENIORITY],
  jobTypes: [...ALL_JOB_TYPES],
  sources: [...ALL_SOURCE_IDS],
  datePosted: "any",
  minScore: 0,
};

type Tab = "inbox" | "starred" | "applied";

const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "applied", label: "Applied", icon: Briefcase },
];

export function JobBoard() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [heroTitle, setHeroTitle] = useState<string | null>(null);
  const [unapplyOpen, setUnapplyOpen] = useState(false);
  const [unapplying, setUnapplying] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  // IDs the user has "Cleared" from the Inbox view. Soft-hide only — the rows
  // stay in the DB. We filter fetched jobs through this ref on every load so a
  // tab switch doesn't bring them back; a fresh Research click resets it so
  // they reappear (along with any new fresh listings).
  const clearedIdsRef = useRef<Set<string>>(new Set());
  const { balance } = useTokenBalance();

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      tab,
      locations: filters.locations.join(","),
      seniority: filters.seniority.join(","),
      jobTypes: filters.jobTypes.join(","),
      sources: filters.sources.join(","),
      datePosted: filters.datePosted,
      minScore: String(filters.minScore),
    });
    try {
      const res = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      const incoming: JobDTO[] = data.jobs ?? [];
      // Suppress jobs the user soft-cleared from the Inbox earlier in this
      // session; Research clears the ref so they come back.
      setJobs(
        clearedIdsRef.current.size === 0
          ? incoming
          : incoming.filter((j) => !clearedIdsRef.current.has(j.id)),
      );
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

  // A new CV deletes all NEW jobs server-side; if the board is open in the
  // same tab, drop the visible list immediately so the user sees a clean slate.
  useEffect(() => {
    function onCvUpdated() {
      setJobs([]);
    }
    window.addEventListener("cv-updated", onCvUpdated);
    return () => window.removeEventListener("cv-updated", onCvUpdated);
  }, []);

  useEffect(() => {
    function loadHeroTitle() {
      fetch("/api/settings")
        .then((r) => r.json())
        .then((d: { settings: SettingsDTO | null }) => {
          const first = d.settings?.jobTitles?.[0]?.trim();
          // Null when the user has no job title yet → the hero shows a generic
          // headline instead of a specific profession.
          setHeroTitle(first || null);
        })
        .catch(() => {
          // Leave the generic headline; failure is non-blocking.
        });
    }
    loadHeroTitle();
    window.addEventListener("cv-updated", loadHeroTitle);
    window.addEventListener("settings-updated", loadHeroTitle);
    return () => {
      window.removeEventListener("cv-updated", loadHeroTitle);
      window.removeEventListener("settings-updated", loadHeroTitle);
    };
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
      const spent = result.tokens?.charged ?? 0;
      const spentText =
        spent > 0 ? ` · spent ${formatTokens(spent)} tokens` : "";
      toast.success(
        (result.added > 0
          ? `Added ${result.added} new job${result.added === 1 ? "" : "s"} (scanned ${result.scanned})`
          : `No new jobs — scanned ${result.scanned} listings`) +
          spentText +
          ".",
        { description: breakdown },
      );
      notifyTokensUpdated();
      // A fresh Research means the user wants to see everything again, so
      // forget anything they soft-cleared from the Inbox view.
      clearedIdsRef.current = new Set();
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
          unstar: "Moved back to Inbox.",
          apply: "Marked as applied.",
          unapply: "Moved back to Inbox.",
          delete: "Hidden, won't show again.",
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

  const handleClearList = useCallback(() => {
    if (jobs.length === 0) return;
    // Applied: bulk-unapply needs its own confirmation (moves jobs back to Inbox).
    if (tab === "applied") {
      setUnapplyOpen(true);
      return;
    }
    // Inbox + Starred: ask first; the soft-clear itself runs in handleConfirmClear.
    setClearOpen(true);
  }, [jobs, tab]);

  const handleConfirmClear = useCallback(() => {
    if (jobs.length === 0) {
      setClearOpen(false);
      return;
    }
    // Soft clear only. The rows stay in the DB; we just remember the visible
    // IDs and filter them out of subsequent fetches in this session so a tab
    // switch doesn't bring them back. handleRefresh resets the ref so a
    // Research click surfaces them again.
    const cleared = jobs.length;
    for (const j of jobs) clearedIdsRef.current.add(j.id);
    setJobs([]);
    setClearOpen(false);
    toast.success(
      `Cleared ${cleared} job${cleared === 1 ? "" : "s"} from view. They'll come back on the next Research.`,
    );
  }, [jobs]);

  const handleBulkUnapply = useCallback(async () => {
    const ids = jobs.map((j) => j.id);
    if (ids.length === 0) return;
    setUnapplying(true);
    try {
      const res = await fetch("/api/jobs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unapply", ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not move jobs back.");
        return;
      }
      setJobs([]);
      setUnapplyOpen(false);
      toast.success(
        `Moved ${data.count} job${data.count === 1 ? "" : "s"} back to Inbox.`,
      );
    } catch {
      toast.error("Could not move jobs back.");
    } finally {
      setUnapplying(false);
    }
  }, [jobs]);

  const emptyByTab: Record<
    Tab,
    { icon: typeof Inbox; title: string; description: string }
  > = {
    inbox: {
      icon: Inbox,
      title: "Your inbox is empty",
      description:
        "Hit Research jobs to pull fresh listings and score them against your CV.",
    },
    starred: {
      icon: Star,
      title: "Nothing starred",
      description: "Star jobs from your Inbox to keep them here.",
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
          {heroTitle ? `${heroTitle} jobs,` : "Roles matched to you,"}
          <br className="hidden sm:block" />
          <span className="text-foreground/85">
            {heroTitle ? " ranked for you." : " ranked by fit."}
          </span>
        </h1>
        <p className="text-muted-foreground mt-5 max-w-3xl text-[1rem] leading-relaxed">
          Every job worth a look, from LinkedIn, Indeed, Glassdoor, BA Jobbörse
          and more, gathered into one quiet feed and scored against your CV, so
          the best matches rise to the top.
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

      {balance != null && balance < LOW_TOKEN_THRESHOLD && (
        <Alert className="border-accent/50 bg-accent/[0.07] flex flex-wrap items-center justify-between gap-3 rounded-2xl">
          <Coins className="size-4" />
          <div className="flex-1">
            <AlertTitle>Running low on tokens</AlertTitle>
            <AlertDescription>
              {formatTokens(balance)} left — top up to keep researching and
              rating jobs.
            </AlertDescription>
          </div>
          <Button size="sm" nativeButton={false} render={<Link href="/plans" />}>
            Buy tokens
          </Button>
        </Alert>
      )}

      {/* ── Section header: tabs + filter trigger ─────────────────── */}
      <section className="!mb-4">
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
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground gap-1.5"
                onClick={handleClearList}
              >
                <Trash2 className="size-3.5" />
                Clear List
              </Button>
            )}
          </div>
        </div>

        <AlertDialog open={unapplyOpen} onOpenChange={setUnapplyOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move applied jobs back to Inbox?</AlertDialogTitle>
              <AlertDialogDescription>
                This moves all {jobs.length} job
                {jobs.length === 1 ? "" : "s"} on the Applied tab back to your
                Inbox and clears their applied date. You can re-apply at any
                time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={unapplying}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={unapplying}
                onClick={(e) => {
                  e.preventDefault();
                  handleBulkUnapply();
                }}
              >
                {unapplying ? "Moving…" : "Move to Inbox"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear {jobs.length} job{jobs.length === 1 ? "" : "s"} from view?
              </AlertDialogTitle>
              <AlertDialogDescription>
                These jobs stay in your database — they&apos;re just hidden from
                this view and will come back on the next Research.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleConfirmClear();
                }}
              >
                Clear
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
      <section className="!mt-0">
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
              tab === "inbox" ? (
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
