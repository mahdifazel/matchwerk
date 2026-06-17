"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Inline, auto-saving note editor — debounced (700ms) while typing + immediate
 * on blur, with a "no-op if unchanged" guard. Shared by the Pipeline table cell
 * and the job card so both surfaces persist `Job.note` identically.
 */
export function NoteField({
  job,
  onSave,
  className,
  rows = 1,
  placeholder = "Add a note…",
  autoFocus = false,
  onBlur,
  style,
}: {
  job: JobDTO;
  onSave: (id: string, note: string) => Promise<boolean>;
  className?: string;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called when the field loses focus, with the current value (after save). */
  onBlur?: (value: string) => void;
  /** Inline styles applied to the textarea (e.g. note-text color). */
  style?: CSSProperties;
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
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={style}
        onChange={(e) => {
          const text = e.target.value;
          setValue(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => save(text), 700);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          save(value);
          onBlur?.(value);
        }}
        className={cn(
          "border-border/0 hover:border-border focus:border-ring focus:bg-background min-h-9 w-full resize-y rounded-md border bg-transparent px-2 py-1.5 text-[0.85rem] leading-relaxed outline-none transition-colors",
          className,
        )}
      />
      {saving && (
        <span className="text-muted-foreground/70 pointer-events-none absolute right-2 top-2 text-[0.65rem]">
          Saving…
        </span>
      )}
    </div>
  );
}
