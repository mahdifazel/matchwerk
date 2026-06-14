"use client";

import { ExternalLink, Table2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/empty-state";
import {
  ARCHIVE_REASONS,
  INTERVIEW_STAGES,
  JOB_STATUS_LABEL,
} from "@/lib/constants";
import type { JobDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

const NEUTRAL_BADGE = "border-border text-muted-foreground";

const STATUS_BADGE: Partial<Record<JobDTO["status"], string>> = {
  APPLIED: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  INTERVIEWING:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  OFFER:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ARCHIVED:
    "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

/** Label + color for the "Stage" cell, per the product rules: Applied=Pending,
 * Offer=Thinking, Interviewing/Archived show the chosen sub-stage / outcome. */
function stageBadge(job: JobDTO): { label: string; badge: string } {
  switch (job.status) {
    case "APPLIED":
      return {
        label: "Pending",
        badge:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      };
    case "OFFER":
      return {
        label: "Thinking",
        badge:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      };
    case "INTERVIEWING": {
      const s = INTERVIEW_STAGES.find((x) => x.id === job.interviewStage);
      return {
        label: s ? (s.short ?? s.label) : "Not set",
        badge: s?.badge ?? NEUTRAL_BADGE,
      };
    }
    case "ARCHIVED": {
      const r = ARCHIVE_REASONS.find((x) => x.id === job.archiveReason);
      return {
        label: r ? (r.short ?? r.label) : "Not set",
        badge: r?.badge ?? NEUTRAL_BADGE,
      };
    }
    default:
      return { label: "", badge: NEUTRAL_BADGE };
  }
}

/** Inline, auto-saving note cell (debounced while typing + on blur). */
function NoteCell({
  job,
  onSave,
}: {
  job: JobDTO;
  onSave: (id: string, note: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(job.note);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(job.note);

  const save = useCallback(
    async (text: string) => {
      if (text === lastSaved.current) return;
      setSaving(true);
      const ok = await onSave(job.id, text);
      if (ok) lastSaved.current = text;
      setSaving(false);
    },
    [job.id, onSave],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="relative">
      <textarea
        value={value}
        rows={1}
        placeholder="Add a note…"
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => save(text), 700);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          save(value);
        }}
        className="border-border/0 hover:border-border focus:border-ring focus:bg-background min-h-9 w-full min-w-44 resize-y rounded-md border bg-transparent px-2 py-1.5 text-[0.85rem] leading-relaxed outline-none transition-colors"
      />
      {saving && (
        <span className="text-muted-foreground/70 pointer-events-none absolute right-2 top-2 text-[0.65rem]">
          Saving…
        </span>
      )}
    </div>
  );
}

export function PipelineTable({
  jobs,
  onSaveNote,
}: {
  jobs: JobDTO[];
  onSaveNote: (id: string, note: string) => Promise<boolean>;
}) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<Table2 className="size-5" />}
        title="Your pipeline is empty"
        description="Jobs you move to Applied, Interviewing, Offer or Archived show up here as a table you can track and annotate."
      />
    );
  }

  return (
    <div className="bg-card border-border/70 overflow-hidden rounded-2xl border shadow-[0_1px_3px_rgba(26,18,51,0.06)] ring-1 ring-foreground/[0.03]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40 border-border/70 border-b text-left">
              {["Company", "Role", "Status", "Stage", "Link", "Note"].map((h) => (
                <th
                  key={h}
                  className="text-muted-foreground px-5 py-3.5 text-[0.68rem] font-semibold tracking-[0.08em] uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const stage = stageBadge(job);
              return (
                <tr
                  key={job.id}
                  className="border-border/45 hover:bg-muted/25 border-b align-top transition-colors last:border-0"
                >
                  <td className="text-foreground px-5 py-4 font-medium">
                    {job.company}
                  </td>
                  <td className="text-foreground/80 px-5 py-4">{job.title}</td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span
                      className={cn(
                        "inline-flex h-6 items-center rounded-full border px-2.5 text-[0.7rem] font-medium tracking-tight whitespace-nowrap",
                        STATUS_BADGE[job.status] ?? NEUTRAL_BADGE,
                      )}
                    >
                      {JOB_STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span
                      className={cn(
                        "inline-flex h-6 items-center rounded-full border px-2.5 text-[0.7rem] font-medium tracking-tight whitespace-nowrap",
                        stage.badge,
                      )}
                    >
                      {stage.label}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-border/70 text-foreground/70 hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8rem] transition-colors"
                    >
                      Open <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                  <td className="min-w-64 px-5 py-3">
                    <NoteCell job={job} onSave={onSaveNote} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
