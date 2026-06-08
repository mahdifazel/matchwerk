"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Pipeline stages shown to the user, keyed off elapsed time. Fetch + dedupe are
 *  roughly fixed; AI scoring dominates the tail, so the labels are honest even
 *  though the bar itself is time-estimated, not server-driven. */
const STAGES = [
  { until: 12_000, label: "Searching job boards (LinkedIn, Indeed, BA…)" },
  { until: 18_000, label: "Removing duplicate listings" },
  { until: Infinity, label: "Scoring matches against your CV…" },
] as const;

const OVER_ETA_LABEL = "Almost there, finishing up…";

/** Bar fills fast early, then eases toward this cap; it only reaches 100% once
 *  the request actually returns (parent flips `active` off). */
const PROGRESS_CAP = 0.92;
const TICK_MS = 220;

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatEta(ms: number): string {
  const secs = Math.round(ms / 1000);
  return secs >= 60 ? `~${Math.round(secs / 60)}m` : `~${secs}s`;
}

function stageLabel(elapsedMs: number, etaMs: number): string {
  if (elapsedMs > etaMs) return OVER_ETA_LABEL;
  return STAGES.find((s) => elapsedMs < s.until)!.label;
}

// The card is mounted only while a research run is in flight (the parent renders
// it on `refreshing` and unmounts it on completion), so the hook just measures
// elapsed time from mount — no reset or "done" handling is needed.
function useRefreshProgress(etaMs: number) {
  const startRef = useRef(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    startRef.current = performance.now();
    const id = setInterval(() => {
      setElapsedMs(performance.now() - startRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return {
    pct: (1 - Math.exp(-elapsedMs / (etaMs * 0.45))) * PROGRESS_CAP,
    elapsedMs,
    label: stageLabel(elapsedMs, etaMs),
  };
}

/** Estimated-progress card shown while a job research run is in flight. */
export function RefreshProgress({ etaMs }: { etaMs: number }) {
  const { pct, elapsedMs, label } = useRefreshProgress(etaMs);
  const percent = Math.round(pct * 100);

  return (
    <div className="border-border/70 bg-card/60 rounded-2xl border p-6 ring-1 ring-foreground/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="bg-accent grid size-6 place-items-center rounded-full text-[var(--brand-ink)]">
            <Sparkles className="size-3.5 animate-pulse" />
          </span>
          <span className="text-sm font-medium tracking-tight">
            Researching jobs…
          </span>
        </div>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatClock(elapsedMs)} / {formatEta(etaMs)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Job research progress"
        className="bg-muted relative mt-4 h-2 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p
        aria-live="polite"
        className="text-foreground/80 mt-3 text-sm tracking-tight"
      >
        {label}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        First search is the slowest. We scan every board and AI-score each match.
      </p>
    </div>
  );
}
