"use client";

import { ArrowUpRight, Check, Star, Trash2, Undo2 } from "lucide-react";
import { ScoreMeter } from "@/components/match-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { JobDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export type JobAction = "star" | "unstar" | "apply" | "unapply" | "delete";

const SENIORITY_LABEL: Record<string, string> = {
  JUNIOR: "Junior",
  MID: "Mid-level",
  SENIOR: "Senior",
  LEAD: "Lead",
  UNKNOWN: "",
};

const JOB_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  FREELANCE: "Freelance",
  INTERNSHIP: "Internship",
  UNKNOWN: "",
};

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function JobCard({
  job,
  pending,
  onAction,
}: {
  job: JobDTO;
  pending: boolean;
  onAction: (id: string, action: JobAction) => void;
}) {
  const isStarred = job.status === "STARRED";
  const isApplied = job.status === "APPLIED";
  const score = job.matchScore;
  const accentClass =
    score == null
      ? "before:bg-border/60"
      : score >= 90
        ? "before:bg-[#DCCE40]"
        : score >= 70
          ? "before:bg-[#C4AEF4]"
          : "before:bg-border/80";

  const metaItems = [
    job.company,
    job.location,
    SENIORITY_LABEL[job.seniority] || null,
    JOB_TYPE_LABEL[job.jobType] || null,
  ].filter(Boolean) as string[];

  return (
    <Card
      className={cn(
        "lift-on-hover group/job border-border/70 hover:border-border/90 relative gap-0 overflow-hidden rounded-2xl py-0 ring-1 ring-foreground/[0.04] hover:shadow-[0_18px_40px_-22px_rgba(26,18,51,0.22)]",
        "before:absolute before:inset-y-5 before:left-0 before:w-[3px] before:rounded-r-full",
        accentClass,
        pending && "pointer-events-none opacity-60",
      )}
    >
      <div className="flex flex-col gap-4 p-6 sm:p-7">
        {/* Headline + score */}
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            {isApplied && job.appliedAt && (
              <div className="flex items-center gap-2">
                <span className="bg-accent/25 text-accent-foreground inline-flex h-5 items-center rounded-full px-2 text-[0.65rem] font-medium tracking-tight">
                  Applied {formatDate(job.appliedAt)}
                </span>
              </div>
            )}
            <h3 className="font-display mt-2 text-[1.45rem] leading-[1.18] tracking-tight sm:text-[1.6rem]">
              {job.title}
            </h3>
            <p className="text-muted-foreground dot-sep mt-2.5 flex flex-wrap items-center text-[0.92rem] leading-relaxed">
              {metaItems.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
          </div>
          <ScoreMeter score={score} />
        </div>

        {/* Why */}
        {job.matchExplanation && (
          <p className="text-foreground/90 border-l-2 border-border pl-4 text-[0.95rem] leading-relaxed">
            {job.matchExplanation}
          </p>
        )}

        {/* Gaps */}
        {job.missingSkills.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="eyebrow text-[0.7rem]">Gaps</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {job.missingSkills.slice(0, 6).map((skill) => (
                <span
                  key={skill}
                  className="border-border text-foreground/80 inline-flex h-7 items-center rounded-full border px-3 text-[0.78rem]"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Rule + actions */}
        <div className="bg-border/60 mt-1 h-px w-full" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2",
                isStarred && "text-[#B8A92A] dark:text-[#DCCE40]",
              )}
              aria-label={isStarred ? "Unstar" : "Star"}
              onClick={() => onAction(job.id, isStarred ? "unstar" : "star")}
            >
              <Star
                className={cn("size-3.5", isStarred && "fill-current")}
              />
              <span className="text-[0.85rem]">
                {isStarred ? "Starred" : "Star"}
              </span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2"
              aria-label="Don't show this job again"
              onClick={() => onAction(job.id, "delete")}
            >
              <Trash2 className="size-3.5" />
              <span className="text-[0.85rem]">Don&apos;t Show Again</span>
            </Button>
            {isApplied && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2"
                aria-label="Move this job back to the Inbox"
                onClick={() => onAction(job.id, "unapply")}
              >
                <Undo2 className="size-3.5" />
                <span className="text-[0.85rem]">Back to Inbox</span>
              </Button>
            )}
          </div>

          <Button
            size="sm"
            variant="default"
            className="h-9 gap-1.5 rounded-full px-4"
            nativeButton={false}
            onClick={() => {
              if (!isApplied) onAction(job.id, "apply");
            }}
            render={
              <a href={job.url} target="_blank" rel="noopener noreferrer" />
            }
          >
            {isApplied ? (
              <>
                <Check className="size-3.5" /> Applied
              </>
            ) : (
              <>
                Apply <ArrowUpRight className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
