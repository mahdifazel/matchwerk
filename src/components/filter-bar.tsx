"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import {
  DATE_POSTED_OPTIONS,
  type DatePostedId,
  JOB_TYPE_OPTIONS,
  LANGUAGE_OPTIONS,
  LOCATION_OPTIONS,
  SENIORITY_OPTIONS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

// Match-score filter: a "minimum threshold" slider. Steps of 10 from 0–90;
// the selected value means "show jobs scoring value% → 100%".
export const MATCH_SCORE_MAX = 90;
export const MATCH_SCORE_STEP = 10;

export type Filters = {
  locations: string[];
  seniority: string[];
  jobTypes: string[];
  sources: string[];
  /** Language IDs selected ("de" / "en"). Mapped against Job.requiredLanguages. */
  languages: string[];
  datePosted: DatePostedId;
  minScore: number;
};

type Option = { id: string; label: string; disabled?: boolean; hint?: string };

function FilterMenu({
  label,
  options,
  selected,
  onChange,
  className,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const activeCount = options.filter(
    (o) => !o.disabled && selected.includes(o.id),
  ).length;
  const total = options.filter((o) => !o.disabled).length;
  const narrowed = activeCount !== total;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1.5", className)}
            data-active={narrowed || undefined}
          />
        }
      >
        <span className="truncate">{label}</span>
        <span
          className={cn(
            "tabular-nums",
            narrowed ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          {narrowed ? activeCount : "All"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.id}
              checked={selected.includes(o.id)}
              disabled={o.disabled}
              onCheckedChange={(c) => toggle(o.id, c)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex w-full items-center justify-between gap-2">
                {o.label}
                {o.hint && (
                  <span className="text-muted-foreground text-[10px] uppercase">
                    {o.hint}
                  </span>
                )}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DateFilterMenu({
  value,
  onChange,
  className,
}: {
  value: DatePostedId;
  onChange: (next: DatePostedId) => void;
  className?: string;
}) {
  const active = DATE_POSTED_OPTIONS.find((d) => d.id === value);
  const narrowed = value !== "any";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("gap-1.5", className)}
            data-active={narrowed || undefined}
          />
        }
      >
        <span className="truncate">Date posted</span>
        <span
          className={cn(
            narrowed ? "text-foreground font-medium" : "text-muted-foreground",
          )}
        >
          {active && narrowed ? active.label : "Any time"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Date posted</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => onChange(v as DatePostedId)}
          >
            {DATE_POSTED_OPTIONS.map((o) => (
              <DropdownMenuRadioItem
                key={o.id}
                value={o.id}
                onSelect={(e) => e.preventDefault()}
              >
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-2.5">
      {/* Row 1 — the four discrete multi-selects, evenly distributed across
          the full row. CSS Grid (not flex-wrap) so they share width exactly,
          giving the panel a calm, columnar rhythm even when one chip's
          label-with-count is shorter than its neighbour. `justify-between`
          on every trigger pins the count to the right edge of each cell. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FilterMenu
          label="Location"
          options={LOCATION_OPTIONS.map((l) => ({ id: l.id, label: l.label }))}
          selected={filters.locations}
          onChange={(locations) => onChange({ ...filters, locations })}
          className="w-full justify-between"
        />
        <FilterMenu
          label="Seniority"
          options={SENIORITY_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
          selected={filters.seniority}
          onChange={(seniority) => onChange({ ...filters, seniority })}
          className="w-full justify-between"
        />
        <FilterMenu
          label="Job type"
          options={JOB_TYPE_OPTIONS.map((t) => ({ id: t.id, label: t.label }))}
          selected={filters.jobTypes}
          onChange={(jobTypes) => onChange({ ...filters, jobTypes })}
          className="w-full justify-between"
        />
        <FilterMenu
          label="Language"
          options={LANGUAGE_OPTIONS.map((l) => ({ id: l.id, label: l.label }))}
          selected={filters.languages}
          onChange={(languages) => onChange({ ...filters, languages })}
          className="w-full justify-between"
        />
      </div>

      {/* Row 2 — Date posted (compact, fixed width) + Match slider (flex-1 so
          it absorbs whatever space is left) + Reset (small icon button at the
          far right). A single row that fills edge-to-edge.
          The Date chip is intentionally narrower than the row-1 chips so the
          slider's track is unambiguously the visual centerpiece of the row. */}
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <DateFilterMenu
          value={filters.datePosted}
          onChange={(datePosted) => onChange({ ...filters, datePosted })}
          className="w-full justify-between sm:w-44"
        />

        <div className="hidden h-5 w-px shrink-0 bg-border/60 sm:block" aria-hidden />

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="eyebrow shrink-0 text-[0.7rem]">Match</span>
          <span className="text-muted-foreground/70 shrink-0 text-[0.72rem]">
            Any
          </span>
          <Slider
            className="min-w-24 flex-1"
            min={0}
            // Visual track spans 0..100 so the "90→100" tail is always a
            // visible sliver of the active range — at the previous max=90 the
            // active fill collapsed to 0px at value=90 and read as "empty".
            max={100}
            step={MATCH_SCORE_STEP}
            value={filters.minScore}
            onValueChange={(minScore) =>
              // Functional cap: threshold never exceeds 90, matching the spec
              // and the API clamp (Math.min(90, …) in /api/jobs).
              onChange({ ...filters, minScore: Math.min(MATCH_SCORE_MAX, minScore) })
            }
            inverted
            showTooltip
            tooltipContent={(v) => `${v}%+`}
            ariaLabel="Minimum match score"
            ariaValueText={(v) => `${v} percent match or higher`}
          />
          <span className="text-muted-foreground/70 shrink-0 text-[0.72rem]">
            Top
          </span>
          <span
            className={cn(
              "w-12 shrink-0 text-right text-[0.8rem] font-medium tabular-nums",
              filters.minScore > 0 ? "text-foreground" : "text-muted-foreground/70",
            )}
          >
            {filters.minScore > 0 ? `${filters.minScore}%+` : "—"}
          </span>
        </div>

        <div className="hidden h-5 w-px shrink-0 bg-border/60 sm:block" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Reset all filters"
          title="Reset all filters"
          onClick={onReset}
          className="text-muted-foreground hover:text-foreground h-8 shrink-0 gap-1.5 px-2 text-xs"
        >
          <RotateCcw className="size-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </Button>
      </div>
    </div>
  );
}
