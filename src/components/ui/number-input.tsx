"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

type Props = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "min" | "max"
> & {
  /** Current numeric value held by the parent. */
  value: number;
  /** Fires while the buffer parses to a fresh, valid number. */
  onValueChange: (n: number) => void;
  /** Value committed when the field is left blank on blur. Defaults to `min ?? 0`. */
  fallback?: number;
  /** When false, only integers are accepted. Default true. */
  allowDecimal?: boolean;
  /** Optional numeric clamps applied on blur. `min >= 0` also disallows typing `-`. */
  min?: number;
  max?: number;
};

/**
 * Number input that's actually usable. Backed by an internal string buffer so
 * users can backspace through every digit and start over — the native
 * `<input type="number">` + `value={number}` pattern coerces `Number("")`
 * back to 0, trapping you with a leading "0" you can't delete.
 *
 * - Commits the numeric value to `onValueChange` while typing.
 * - On blur: blank → `fallback`, then clamp to `[min, max]`, then re-format.
 * - Uses `type="text"` + `inputMode` so mobile keypads still show, but the
 *   browser-native spin buttons (which were inconsistent anyway) go away.
 */
export function NumberInput({
  value,
  onValueChange,
  fallback,
  allowDecimal = true,
  min,
  max,
  onBlur,
  ...rest
}: Props) {
  const [buffer, setBuffer] = React.useState<string>(formatNumber(value));
  const [lastValue, setLastValue] = React.useState<number>(value);

  // Re-seed the buffer when the parent's number changes out from under us
  // (e.g. form reset, server reload). Don't trample a freshly typed buffer
  // that already represents the same number. Render-time `setState` is the
  // pattern React docs recommend for syncing state to changing props.
  if (value !== lastValue) {
    setLastValue(value);
    const n = Number(buffer);
    if (buffer === "" || Number.isNaN(n) || n !== value) {
      setBuffer(formatNumber(value));
    }
  }

  const signed = min === undefined || min < 0;
  const pattern = signed
    ? allowDecimal
      ? /^-?\d*\.?\d*$/
      : /^-?\d*$/
    : allowDecimal
      ? /^\d*\.?\d*$/
      : /^\d*$/;

  return (
    <Input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={buffer}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || pattern.test(v)) {
          setBuffer(v);
          // Don't commit when the buffer is a partial token ("", "-", ".") —
          // wait until it's a full number so the parent never sees NaN.
          if (v !== "" && v !== "-" && v !== "." && v !== "-.") {
            const n = Number(v);
            if (!Number.isNaN(n)) onValueChange(n);
          }
        }
      }}
      onBlur={(e) => {
        const fallbackValue = fallback ?? min ?? 0;
        let n = Number(buffer);
        if (buffer === "" || buffer === "-" || buffer === "." || Number.isNaN(n)) {
          n = fallbackValue;
        }
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        setBuffer(formatNumber(n));
        if (n !== value) onValueChange(n);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}
