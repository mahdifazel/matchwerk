"use client";

import {
  Archive,
  ArrowUpRight,
  Award,
  Briefcase,
  Check,
  ChevronDown,
  MessagesSquare,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { ScoreMeter } from "@/components/match-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ArchiveReason, InterviewStage } from "@/generated/prisma/enums";
import {
  ARCHIVE_REASONS,
  INTERVIEW_STAGES,
  type StatusOption,
} from "@/lib/constants";
import type { JobDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export type JobAction =
  | "star"
  | "apply"
  | "interview"
  | "offer"
  | "archive"
  | "inbox"
  | "delete"
  | "setInterviewStage"
  | "setArchiveReason";

export type ActionPayload = {
  interviewStage?: InterviewStage;
  archiveReason?: ArchiveReason;
};

/** Forward/lateral stage moves offered from each stage (excludes the star
 * toggle, "Back to Inbox", and "Don't Show Again", which render inline). */
type MoveAction = "apply" | "interview" | "offer" | "archive";

const STAGE_MOVES: Record<JobDTO["status"], MoveAction[]> = {
  NEW: ["apply", "interview", "archive"],
  STARRED: ["apply", "interview", "archive"],
  APPLIED: ["interview", "archive"],
  INTERVIEWING: ["offer", "archive"],
  OFFER: ["archive"],
  ARCHIVED: [],
  DELETED: [],
};

const MOVE_META: Record<
  Exclude<MoveAction, "archive">,
  { label: string; icon: typeof Briefcase }
> = {
  apply: { label: "Applied", icon: Briefcase },
  interview: { label: "Interviewing", icon: MessagesSquare },
  offer: { label: "Offer", icon: Award },
};

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

/** A color-coded status pill that doubles as a picker for the current
 * sub-stage (interview stage) or outcome (archive reason). */
function StatusSelect<T extends string>({
  value,
  options,
  placeholder,
  onSelect,
}: {
  value: T | null;
  options: StatusOption<T>[];
  placeholder: string;
  onSelect: (id: T) => void;
}) {
  const current = options.find((o) => o.id === value) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Change stage"
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-[0.85rem] font-medium tracking-tight transition-colors outline-none focus-visible:ring-3",
              current
                ? current.badge
                : "border-border text-muted-foreground border-dashed",
            )}
          />
        }
      >
        <span
          className={cn(
            "size-2 rounded-full",
            current ? current.dot : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        {current ? current.label : placeholder}
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onSelect(o.id)}>
            <span className={cn("size-2 rounded-full", o.dot)} aria-hidden />
            {o.label}
            {o.id === value && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function JobCard({
  job,
  pending,
  onAction,
}: {
  job: JobDTO;
  pending: boolean;
  onAction: (id: string, action: JobAction, payload?: ActionPayload) => void;
}) {
  const isInbox = job.status === "NEW";
  const isApplied = job.status === "APPLIED";
  const moves = STAGE_MOVES[job.status] ?? [];
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

  const hasStatusChip = (isApplied && job.appliedAt) || job.status === "OFFER";

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
            {hasStatusChip && (
              <div className="flex flex-wrap items-center gap-2">
                {isApplied && job.appliedAt && (
                  <span className="bg-accent/25 text-accent-foreground inline-flex h-6 items-center rounded-full px-2.5 text-[0.7rem] font-medium tracking-tight">
                    Applied {formatDate(job.appliedAt)}
                  </span>
                )}
                {job.status === "OFFER" && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[0.7rem] font-medium tracking-tight text-emerald-700 dark:text-emerald-400">
                    <Award className="size-3" /> Offer
                  </span>
                )}
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
            {job.publisher && (
              <p className="text-muted-foreground mt-2 text-[0.8rem]">
                via{" "}
                <span className="text-foreground/70 font-medium">
                  {job.publisher}
                </span>
              </p>
            )}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5">
              {isInbox ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2"
                  aria-label="Star"
                  onClick={() => onAction(job.id, "star")}
                >
                  <Star className="size-3.5" />
                  <span className="text-[0.85rem]">Star</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-8 gap-1.5 px-2"
                  aria-label="Move this job back to the Inbox"
                  onClick={() => onAction(job.id, "inbox")}
                >
                  <Undo2 className="size-3.5" />
                  <span className="text-[0.85rem]">Back to Inbox</span>
                </Button>
              )}

              {isInbox && (
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
              )}
            </div>

            {job.status === "INTERVIEWING" && (
              <StatusSelect
                value={job.interviewStage}
                options={INTERVIEW_STAGES}
                placeholder="Set stage"
                onSelect={(interviewStage) =>
                  onAction(job.id, "setInterviewStage", { interviewStage })
                }
              />
            )}
            {job.status === "ARCHIVED" && (
              <StatusSelect
                value={job.archiveReason}
                options={ARCHIVE_REASONS}
                placeholder="Set reason"
                onSelect={(archiveReason) =>
                  onAction(job.id, "setArchiveReason", { archiveReason })
                }
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            {moves.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 rounded-full px-4"
                      aria-label="Move this job to another stage"
                    />
                  }
                >
                  <span className="text-[0.85rem]">Update Status</span>
                  <ChevronDown className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {moves
                    .filter((m): m is Exclude<MoveAction, "archive"> => m !== "archive")
                    .map((move) => {
                      const { label, icon: Icon } = MOVE_META[move];
                      return (
                        <DropdownMenuItem
                          key={move}
                          onClick={() => onAction(job.id, move)}
                        >
                          <Icon className="size-3.5" />
                          {label}
                        </DropdownMenuItem>
                      );
                    })}
                  {moves.includes("archive") && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Archive className="size-3.5" />
                        Archived
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-44">
                        {ARCHIVE_REASONS.map((r) => (
                          <DropdownMenuItem
                            key={r.id}
                            onClick={() =>
                              onAction(job.id, "archive", { archiveReason: r.id })
                            }
                          >
                            <span
                              className={cn("size-2 rounded-full", r.dot)}
                              aria-hidden
                            />
                            {r.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              size="sm"
              variant="default"
              className="h-9 gap-1.5 rounded-full px-4"
              nativeButton={false}
              render={
                <a href={job.url} target="_blank" rel="noopener noreferrer" />
              }
            >
              View Job Details <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
