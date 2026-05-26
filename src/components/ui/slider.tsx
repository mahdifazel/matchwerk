"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SliderProps {
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  /** Show a small value bubble above the thumb on hover, focus, or drag. */
  showTooltip?: boolean;
  tooltipContent?: (value: number) => React.ReactNode;
  /**
   * Render the filled/"active" range on the trailing (right) side of the thumb
   * instead of the leading side. Used for "minimum threshold" sliders where the
   * value → max range is the meaningful selection.
   */
  inverted?: boolean;
  ariaLabel?: string;
  ariaValueText?: (value: number) => string;
}

function Slider({
  className,
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  disabled,
  onValueChange,
  showTooltip = false,
  tooltipContent,
  inverted = false,
  ariaLabel,
  ariaValueText,
}: SliderProps) {
  const current = value ?? defaultValue ?? min;

  return (
    <SliderPrimitive.Root
      min={min}
      max={max}
      step={step}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onValueChange={(next) => {
        const v = Array.isArray(next) ? next[0] : (next as number);
        onValueChange?.(v);
      }}
      className={cn(
        "group/slider relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
        className,
      )}
    >
      <SliderPrimitive.Control className="flex w-full items-center py-1.5">
        <SliderPrimitive.Track
          className={cn(
            "relative h-2 w-full grow overflow-hidden rounded-full",
            inverted ? "bg-primary" : "bg-secondary",
          )}
        >
          <SliderPrimitive.Indicator
            className={cn(
              "h-full rounded-full",
              inverted ? "bg-secondary" : "bg-primary",
            )}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
          getAriaValueText={
            ariaValueText ? (_formatted, v) => ariaValueText(v) : undefined
          }
          className="border-primary bg-background relative block size-5 shrink-0 cursor-grab rounded-full border-2 shadow-sm outline-none transition-shadow has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 data-disabled:cursor-not-allowed data-dragging:cursor-grabbing"
        >
          {showTooltip && (
            <span
              aria-hidden
              className="bg-foreground text-background pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap opacity-0 shadow-sm transition-opacity group-hover/slider:opacity-100 group-focus-within/slider:opacity-100 group-data-dragging/slider:opacity-100"
            >
              {tooltipContent ? tooltipContent(current) : current}
            </span>
          )}
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
