"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  JOB_TYPE_OPTIONS,
  LOCATION_OPTIONS,
  SENIORITY_OPTIONS,
  SOURCE_META,
} from "@/lib/constants";
import { useSourceStatus } from "@/lib/use-source-status";

export type Filters = {
  locations: string[];
  seniority: string[];
  jobTypes: string[];
  sources: string[];
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

export function FilterBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  onReset: () => void;
}) {
  const sourceStatus = useSourceStatus();

  const sourceOptions: Option[] = SOURCE_META.map((s) => {
    const status = sourceStatus.get(s.id);
    const usable = status
      ? status.connected && status.configured
      : s.connected;
    let hint: string | undefined;
    if (!s.connected) hint = "Off";
    else if (status && !status.configured) hint = "Key needed";
    return { id: s.id, label: s.label, disabled: !usable, hint };
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow mr-1 text-[0.7rem]">Refine by</span>

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
        label="Source"
        options={sourceOptions}
        selected={filters.sources}
        onChange={(sources) => onChange({ ...filters, sources })}
      />

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground gap-1.5"
        onClick={onReset}
      >
        <RotateCcw className="size-3.5" />
        Reset
      </Button>
    </div>
  );
}
