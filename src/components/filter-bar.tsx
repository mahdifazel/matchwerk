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
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const activeCount = options.filter(
    (o) => !o.disabled && selected.includes(o.id),
  ).length;
  const total = options.filter((o) => !o.disabled).length;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        {label}
        <span className="text-muted-foreground tabular-nums">
          {activeCount === total ? "All" : activeCount}
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
}: {
  value: DatePostedId;
  onChange: (next: DatePostedId) => void;
}) {
  const active = DATE_POSTED_OPTIONS.find((d) => d.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        Date posted
        <span className="text-muted-foreground">
          {active && active.id !== "any" ? active.label : "Any time"}
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
    <div className="space-y-3">
      {/* Row 1 — discrete filters. The eyebrow anchors the row, the dropdowns
          flow with consistent height, and Reset sits on the far right after
          a hairline separator so it never gets confused with a filter chip. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow shrink-0 text-[0.7rem]">Refine by</span>

        <FilterMenu
          label="Location"
          options={LOCATION_OPTIONS.map((l) => ({ id: l.id, label: l.label }))}
          selected={filters.locations}
          onChange={(locations) => onChange({ ...filters, locations })}
        />
        <FilterMenu
          label="Seniority"
          options={SENIORITY_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
          selected={filters.seniority}
          onChange={(seniority) => onChange({ ...filters, seniority })}
        />
        <FilterMenu
          label="Job type"
          options={JOB_TYPE_OPTIONS.map((t) => ({ id: t.id, label: t.label }))}
          selected={filters.jobTypes}
          onChange={(jobTypes) => onChange({ ...filters, jobTypes })}
        />
        <FilterMenu
          label="Language"
          options={LANGUAGE_OPTIONS.map((l) => ({ id: l.id, label: l.label }))}
          selected={filters.languages}
          onChange={(languages) => onChange({ ...filters, languages })}
        />
        <DateFilterMenu
          value={filters.datePosted}
          onChange={(datePosted) => onChange({ ...filters, datePosted })}
        />

        <div className="ml-auto flex items-center gap-2">
          <div className="bg-border/70 h-5 w-px shrink-0" aria-hidden />
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* Hairline separator visually splits the discrete row above from the
          continuous (slider) row below. Same tone as the parent ring so it
          reads as structure, not chrome. */}
      <div className="bg-border/50 h-px w-full" aria-hidden />

      {/* Row 2 — Match-score threshold slider. Gets the full row width so the
          90→100 tail (visible sliver after `max={100}`) is easy to land on
          with a click. Endpoints are labeled ("Any" → "Top picks") so the
          direction of the threshold is unambiguous. */}
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <span className="eyebrow shrink-0 text-[0.7rem]">Match</span>
        <span className="text-muted-foreground/80 text-[0.72rem] shrink-0 tabular-nums">
          Any
        </span>
        <Slider
          className="min-w-32 flex-1"
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
        <span className="text-muted-foreground/80 text-[0.72rem] shrink-0 tabular-nums">
          Top picks
        </span>
        <span
          className={
            (filters.minScore > 0 ? "text-foreground" : "text-muted-foreground") +
            " w-12 shrink-0 text-right text-[0.8rem] font-medium tabular-nums"
          }
        >
          {filters.minScore > 0 ? `${filters.minScore}%+` : "—"}
        </span>
      </div>
    </div>
  );
}
