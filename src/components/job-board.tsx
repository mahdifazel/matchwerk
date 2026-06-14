"use client";

import {
  Archive,
  ArrowUp,
  Award,
  Briefcase,
  Coins,
  Download,
  FileText,
  Inbox,
  ListFilter,
  MessagesSquare,
  Search,
  Star,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { FilterBar, type Filters } from "@/components/filter-bar";
import {
  JobCard,
  type ActionPayload,
  type JobAction,
} from "@/components/job-card";
import { PipelineTable } from "@/components/pipeline-table";
import { RefreshButton } from "@/components/refresh-button";
import { RefreshProgress } from "@/components/refresh-progress";
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
  ALL_LANGUAGE_IDS,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  JOB_STATUS_LABEL,
} from "@/lib/constants";
import { LOW_TOKEN_THRESHOLD } from "@/lib/plans";
import type { JobDTO, RefreshResult, SettingsDTO } from "@/lib/types";
import {
  formatTokens,
  notifyTokensUpdated,
  useTokenBalance,
} from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

const ALL_FILTERS: Filters = {
  locations: [...ALL_LOCATION_IDS],
  seniority: [...ALL_SENIORITY],
  jobTypes: [...ALL_JOB_TYPES],
  sources: [...ALL_SOURCE_IDS],
  languages: [...ALL_LANGUAGE_IDS],
  datePosted: "any",
  minScore: 0,
};

// Estimated-research ETA. The card targets the last measured run (persisted in
// localStorage, clamped to a sane band); first-ever run uses the default.
const REFRESH_ETA_KEY = "mw:lastRefreshMs";
const REFRESH_ETA_DEFAULT = 55_000;
const REFRESH_ETA_MIN = 20_000;
const REFRESH_ETA_MAX = 75_000;

function readRefreshEta(): number {
  if (typeof window === "undefined") return REFRESH_ETA_DEFAULT;
  const raw = Number(window.localStorage.getItem(REFRESH_ETA_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return REFRESH_ETA_DEFAULT;
  return Math.min(REFRESH_ETA_MAX, Math.max(REFRESH_ETA_MIN, raw));
}

// Soft-cleared job IDs persist across reloads so "Clear List" stays cleared
// until the next Research (which resets it). Memory-only would reset on reload
// and bring every hidden row back from the DB.
const CLEARED_IDS_KEY = "mw:clearedJobIds";

function readClearedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CLEARED_IDS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeClearedIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  if (ids.size === 0) window.localStorage.removeItem(CLEARED_IDS_KEY);
  else window.localStorage.setItem(CLEARED_IDS_KEY, JSON.stringify([...ids]));
}

// IDs discovered on the most recent Research run. Persisted so the blue "New"
// badge survives reloads/tab switches; the next Research replaces the set with
// that run's fresh IDs (so older "New" flags clear and the latest ones light up).
const NEW_IDS_KEY = "mw:newJobIds";

function readNewIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NEW_IDS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeNewIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  if (ids.size === 0) window.localStorage.removeItem(NEW_IDS_KEY);
  else window.localStorage.setItem(NEW_IDS_KEY, JSON.stringify([...ids]));
}

type Tab =
  | "inbox"
  | "starred"
  | "applied"
  | "interviewing"
  | "offer"
  | "archived"
  | "pipeline";

type TabDef = { id: Tab; label: string; icon: typeof Inbox };

const TABS: TabDef[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "starred", label: "Starred", icon: Star },
  { id: "applied", label: "Applied", icon: Briefcase },
  { id: "interviewing", label: "Interviewing", icon: MessagesSquare },
  { id: "offer", label: "Offer", icon: Award },
  { id: "archived", label: "Archived", icon: Archive },
];

// Pipeline is a separate, table-style view pinned to the right of the tab nav.
const PIPELINE_TAB: TabDef = { id: "pipeline", label: "Pipeline", icon: Table2 };

export function JobBoard() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [jobs, setJobs] = useState<JobDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshEta, setRefreshEta] = useState(REFRESH_ETA_DEFAULT);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [heroTitle, setHeroTitle] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  // Free-text search over the Pipeline table (Pipeline tab only).
  const [pipelineSearch, setPipelineSearch] = useState("");
  // IDs flagged "New" from the last Research. Hydrated from localStorage after
  // mount (empty on the server render to avoid a hydration mismatch).
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  // "Back to top" button visibility — shown once the page is scrolled down.
  const [showToTop, setShowToTop] = useState(false);
  // IDs the user has "Cleared" from the Inbox view. Soft-hide only — the rows
  // stay in the DB. We filter fetched jobs through this ref on every load so a
  // tab switch (or a full reload) doesn't bring them back; a fresh Research
  // click resets it so they reappear (along with any new fresh listings).
  // Persisted in localStorage so the cleared state survives a page reload.
  // Lazily hydrated from storage on first use (never during render).
  const clearedIdsRef = useRef<Set<string> | null>(null);
  const getClearedIds = useCallback(() => {
    if (clearedIdsRef.current === null) clearedIdsRef.current = readClearedIds();
    return clearedIdsRef.current;
  }, []);
  const { balance } = useTokenBalance();

  const fetchJobs = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      const params = new URLSearchParams({
        tab,
        locations: filters.locations.join(","),
        seniority: filters.seniority.join(","),
        jobTypes: filters.jobTypes.join(","),
        sources: filters.sources.join(","),
        languages: filters.languages.join(","),
        datePosted: filters.datePosted,
        minScore: String(filters.minScore),
      });
      try {
        const res = await fetch(`/api/jobs?${params.toString()}`, { signal });
        if (signal?.aborted) return;
        const data = await res.json();
        const incoming: JobDTO[] = data.jobs ?? [];
        // Suppress jobs the user soft-cleared (persisted across reloads);
        // Research clears the set so they come back. Clear List behaves the
        // same on every status tab; only the Pipeline tracker ignores it so it
        // always shows the full set.
        const cleared = getClearedIds();
        const applyCleared = tab !== "pipeline" && cleared.size > 0;
        setJobs(
          applyCleared ? incoming.filter((j) => !cleared.has(j.id)) : incoming,
        );
      } catch (err) {
        // AbortError is expected — a newer filter change superseded this fetch.
        if ((err as Error)?.name === "AbortError") return;
        toast.error("Could not load jobs.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tab, filters, getClearedIds],
  );

  // Cancel any in-flight fetch when filters/tab change so an older, slower
  // response can't overwrite a newer one (fixes "match filter sometimes
  // doesn't work" — same race applied to all filter dropdowns).
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchJobs(controller.signal);
    return () => controller.abort();
  }, [fetchJobs]);

  // Toggle the "back to top" button once the user scrolls past one viewport.
  useEffect(() => {
    const onScroll = () => setShowToTop(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Hydrate the "New" badge set from storage once, after mount. Done in an
  // effect (not a lazy initializer) so the server render stays empty and there's
  // no hydration mismatch when localStorage carries flags from a prior run.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewIds(readNewIds());
  }, []);

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
    setRefreshEta(readRefreshEta());
    setRefreshing(true);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Refresh failed.");
        return;
      }
      // Remember how long a successful run took so the next ETA self-tunes.
      window.localStorage.setItem(
        REFRESH_ETA_KEY,
        String(Math.round(performance.now() - t0)),
      );
      const result = data as RefreshResult;
      const spent = result.tokens?.charged ?? 0;
      const spentText =
        spent > 0 ? ` · spent ${formatTokens(spent)} tokens` : "";
      toast.success(
        (result.added > 0
          ? `Added ${result.added} new job${result.added === 1 ? "" : "s"} (scanned ${result.scanned})`
          : `No new jobs, scanned ${result.scanned} listings`) +
          spentText +
          ".",
      );
      notifyTokensUpdated();
      // A fresh Research means the user wants to see everything again, so
      // forget anything they soft-cleared from the Inbox view.
      clearedIdsRef.current = new Set();
      writeClearedIds(clearedIdsRef.current);
      // Flag this run's freshly added jobs with the blue "New" badge, replacing
      // any flags from a previous run.
      const fresh = new Set(result.newJobIds ?? []);
      setNewIds(fresh);
      writeNewIds(fresh);
      await fetchJobs();
    } catch {
      toast.error("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [fetchJobs]);

  const handleAction = useCallback(
    async (id: string, action: JobAction, payload?: ActionPayload) => {
      setPending((prev) => new Set(prev).add(id));
      // Sub-stage/outcome edits keep the job on the current tab; stage moves
      // take it elsewhere, so it should drop out of the visible list.
      const inPlace =
        action === "setInterviewStage" || action === "setArchiveReason";
      try {
        const res = await fetch(`/api/jobs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(data?.error ?? "Action failed.");
          return;
        }
        if (inPlace && data?.job) {
          setJobs((prev) => prev.map((j) => (j.id === id ? data.job : j)));
        } else {
          setJobs((prev) => prev.filter((j) => j.id !== id));
        }
        const messages: Record<JobAction, string> = {
          star: "Starred.",
          apply: "Moved to Applied.",
          interview: "Moved to Interviewing.",
          offer: "Moved to Offer.",
          archive: "Moved to Archived.",
          inbox: "Moved back to Inbox.",
          delete: "Hidden, won't show again.",
          setInterviewStage: "Interview stage updated.",
          setArchiveReason: "Archive reason updated.",
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
    // Same soft-clear behavior on every tab: ask first, then hide the visible
    // rows (they stay in the DB and return on the next Research). The actual
    // clear runs in handleConfirmClear.
    setClearOpen(true);
  }, [jobs]);

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
    const clearedIds = getClearedIds();
    for (const j of jobs) clearedIds.add(j.id);
    writeClearedIds(clearedIds);
    setJobs([]);
    setClearOpen(false);
    toast.success(
      `Cleared ${cleared} job${cleared === 1 ? "" : "s"} from view. They'll come back on the next Research.`,
    );
  }, [jobs, getClearedIds]);

  // Inline note auto-save from the Pipeline table. Returns success so the cell
  // knows whether to keep the value as "saved".
  const handleSaveNote = useCallback(async (id: string, note: string) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setNote", note }),
      });
      if (!res.ok) {
        toast.error("Could not save note.");
        return false;
      }
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, note } : j)));
      return true;
    } catch {
      toast.error("Could not save note.");
      return false;
    }
  }, []);

  // Export is generated server-side as a styled .xlsx (preserves columns,
  // widths, header + status/stage colors, and Link hyperlinks). We just trigger
  // a download of the authenticated endpoint.
  const handleExport = useCallback(() => {
    if (jobs.length === 0) return;
    const a = document.createElement("a");
    a.href = "/api/jobs/pipeline/export";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [jobs.length]);

  const emptyByTab: Record<
    Exclude<Tab, "pipeline">,
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
    interviewing: {
      icon: MessagesSquare,
      title: "No interviews yet",
      description: "Move jobs here once you're interviewing for them.",
    },
    offer: {
      icon: Award,
      title: "No offers yet",
      description: "Move jobs here when you receive an offer.",
    },
    archived: {
      icon: Archive,
      title: "Nothing archived",
      description: "Archived jobs are kept here, out of your active pipeline.",
    },
  };

  // Pipeline search: filter the table rows across the visible fields. When no
  // query is active this is the full set, so the table + count are unchanged.
  const pipelineFiltered = useMemo(() => {
    if (tab !== "pipeline") return jobs;
    const q = pipelineSearch.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [
        j.company,
        j.title,
        j.location,
        j.note,
        JOB_STATUS_LABEL[j.status],
      ]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q)),
    );
  }, [tab, jobs, pipelineSearch]);

  // Count shown next to the search box: matches when searching, total otherwise.
  const pipelineCount = pipelineSearch.trim()
    ? pipelineFiltered.length
    : jobs.length;

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

  const renderTab = (t: TabDef) => {
    const active = tab === t.id;
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => setTab(t.id)}
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[0.95rem] font-medium tracking-tight whitespace-nowrap transition-colors",
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
            "bg-foreground pointer-events-none absolute inset-x-2 -bottom-3 h-px origin-left transition-transform duration-200",
            active ? "scale-x-100" : "scale-x-0",
          )}
        />
      </button>
    );
  };

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

        <div className="mt-8 flex flex-col items-start gap-x-8 gap-y-6 sm:flex-row sm:flex-wrap sm:items-center">
          <RefreshButton
            refreshing={refreshing}
            onClick={handleRefresh}
            className="w-full sm:w-auto"
          />
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
              {formatTokens(balance)} left. Top up to keep researching and
              rating jobs.
            </AlertDescription>
          </div>
          <Button size="sm" nativeButton={false} render={<Link href="/plans" />}>
            Buy tokens
          </Button>
        </Alert>
      )}

      {/* Tabs + toolbar + results share one parent so the sticky bar stays
          pinned for the whole list (a sticky element only stays stuck while its
          containing block is in view). */}
      <section>
        {/* Only the tab nav row sticks directly below the app header on scroll.
            The negative gutters + backdrop blur make the band span the content
            width so the toolbar and listings scroll cleanly underneath it. */}
        <div className="bg-background/85 sticky top-14 z-20 -mx-5 px-5 pt-3 pb-2 backdrop-blur-md sm:top-16 sm:-mx-8 sm:px-8">
        {/* On mobile the tabs form one horizontally-scrollable strip with
            Pipeline folded in at the end (the "Listings /" label is hidden to
            save room). On desktop it's the original layout: "Listings / [tabs]"
            on the left, Pipeline pinned to the right. Baseline alignment keeps
            the label level with the tab text. */}
        <div className="flex items-baseline justify-between gap-2 border-b border-border/70 sm:gap-3">
          <div className="flex min-w-0 items-baseline gap-2 sm:gap-3">
            <span className="eyebrow hidden shrink-0 sm:inline">Listings</span>
            <span
              aria-hidden
              className="text-muted-foreground/50 hidden shrink-0 sm:inline"
            >
              /
            </span>
            <nav
              className="flex items-center gap-x-3 overflow-x-auto pb-3 sm:gap-x-5 sm:overflow-x-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Job tabs"
            >
              {TABS.map(renderTab)}
              {/* Pipeline folds into the scroll row on mobile only. */}
              <span
                aria-hidden
                className="bg-border/70 mx-0.5 h-4 w-px shrink-0 self-center sm:hidden"
              />
              <span className="contents sm:hidden">
                {renderTab(PIPELINE_TAB)}
              </span>
            </nav>
          </div>

          {/* Pipeline pinned to the right — desktop only. */}
          <nav
            className="hidden shrink-0 items-center pb-3 sm:flex"
            aria-label="Pipeline view"
          >
            {renderTab(PIPELINE_TAB)}
          </nav>
        </div>
        </div>

        {/* Secondary toolbar. Pipeline: a search box (with the matching/total
            count to its right) on the left + Export Table on the right. Status
            tabs: the listing count on the left + Filters/Clear List on the right. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {tab === "pipeline" ? (
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="relative w-full max-w-xs">
                <Search className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={pipelineSearch}
                  onChange={(e) => setPipelineSearch(e.target.value)}
                  placeholder="Search the pipeline…"
                  aria-label="Search the pipeline"
                  className="border-border/70 bg-card/40 focus:border-ring focus:ring-ring/30 h-9 w-full rounded-full border pl-9 pr-9 text-sm outline-none transition-colors focus:ring-2"
                />
                {pipelineSearch && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setPipelineSearch("")}
                    className="text-muted-foreground/70 hover:text-foreground hover:bg-muted absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <span className="text-muted-foreground text-xs tabular-nums">
                <span className="font-mono">{pipelineCount}</span>{" "}
                {pipelineCount === 1 ? "listing" : "listings"}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {!loading && jobs.length > 0 && (
                <>
                  <span className="font-mono">{jobs.length}</span>{" "}
                  {jobs.length === 1 ? "listing" : "listings"}
                </>
              )}
            </span>
          )}

          <div className="flex items-center gap-2">
            {tab === "pipeline" ? (
              jobs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground gap-1.5"
                  onClick={handleExport}
                >
                  <Download className="size-3.5" />
                  Export Table
                </Button>
              )
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Clear {jobs.length} job{jobs.length === 1 ? "" : "s"} from view?
              </AlertDialogTitle>
              <AlertDialogDescription>
                These jobs stay in your database, they&apos;re just hidden from
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

        {showFilters && tab !== "pipeline" && (
          <div className="border-border/70 bg-card/40 rounded-2xl border p-4 mt-4 ring-1 ring-foreground/[0.03]">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(ALL_FILTERS)}
            />
          </div>
        )}

        {/* ── Results ─────────────────────────────────────────────── */}
        <div className="mt-4">
        {refreshing ? (
          <RefreshProgress etaMs={refreshEta} />
        ) : loading ? (
          <div className="grid gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </div>
        ) : tab === "pipeline" ? (
          pipelineSearch.trim() && pipelineFiltered.length === 0 && jobs.length > 0 ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title="No matching jobs"
              description="No pipeline entries match your search. Try a different company, role, or status."
            />
          ) : (
            <PipelineTable jobs={pipelineFiltered} onSaveNote={handleSaveNote} />
          )
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
                isNew={newIds.has(job.id)}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
        </div>
      </section>

      {/* Back to top — appears once scrolled down, scrolls to the top on click. */}
      <button
        type="button"
        aria-label="Back to top"
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: typeof window !== "undefined" &&
              window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          })
        }
        className={cn(
          "bg-card text-foreground border-border/70 hover:bg-muted fixed right-5 bottom-6 z-40 flex size-11 items-center justify-center rounded-full border shadow-[0_8px_24px_-8px_rgba(26,18,51,0.35)] ring-1 ring-foreground/[0.04] backdrop-blur-md transition-all sm:right-8",
          showToTop
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <ArrowUp className="size-5" />
      </button>
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
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
      <Stat label="In view" value={total} />
      <span className="bg-border/80 hidden h-7 w-px sm:block" aria-hidden />
      <Stat
        label="Strong fits"
        sublabel="90+"
        value={strong}
        accent="chartreuse"
      />
      <span className="bg-border/80 hidden h-7 w-px sm:block" aria-hidden />
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
