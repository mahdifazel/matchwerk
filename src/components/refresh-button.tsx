"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function RefreshButton({
  refreshing,
  onClick,
}: {
  refreshing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      className={cn(
        "group/refresh relative inline-flex h-11 items-center gap-2.5 rounded-full px-5 text-sm font-medium tracking-tight",
        "bg-primary text-primary-foreground",
        "ring-1 ring-inset ring-white/8 dark:ring-black/20",
        "shadow-[0_8px_20px_-12px_rgba(26,18,51,0.45)]",
        "transition-[transform,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(26,18,51,0.55)]",
        "active:translate-y-0",
        "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0",
        "dark:bg-primary dark:text-primary-foreground",
      )}
    >
      <span className="bg-accent relative grid size-6 place-items-center rounded-full text-[var(--brand-ink)]">
        <Sparkles
          className={cn(
            "size-3.5",
            refreshing && "animate-pulse",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full",
            refreshing
              ? "bg-accent/40 animate-ping"
              : "opacity-0 group-hover/refresh:opacity-100 bg-accent/30 transition-opacity",
          )}
        />
      </span>
      <span>{refreshing ? "Researching…" : "Research jobs"}</span>
    </button>
  );
}
