import type { ComponentType, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Brand tints for stat-card icon chips — fixed pastels + ink glyph (high
 * contrast on both light and dark cards). */
export type Tint = "ink" | "chartreuse" | "lavender" | "sage";

const TINT_CHIP: Record<Tint, string> = {
  ink: "bg-[var(--brand-ink)] text-[var(--brand-paper)]",
  chartreuse: "bg-[var(--brand-chartreuse)] text-[var(--brand-ink)]",
  lavender: "bg-[var(--brand-lavender)] text-[var(--brand-ink)]",
  sage: "bg-[var(--brand-sage)] text-[var(--brand-ink)]",
};

/** A headline metric tile with an optional colored icon chip. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tint,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ComponentType<{ className?: string }>;
  tint?: Tint;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        accent ? "border-accent/60 bg-card" : "border-border/60 bg-card hover:border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-muted-foreground text-xs">{label}</div>
        {Icon &&
          (tint ? (
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", TINT_CHIP[tint])}>
              <Icon className="size-3.5" />
            </span>
          ) : (
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
          ))}
      </div>
      <div className="font-display mt-2 text-2xl leading-none tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground mt-1 text-xs">{sub}</div>}
    </div>
  );
}

/** A titled content card. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-border/60 bg-card rounded-2xl border p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="eyebrow">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Consistent bordered container for a list/table of rows (use `divide-y` inside). */
export function TableCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-2xl border", className)}>
      {children}
    </div>
  );
}

export function AdminEmpty({ children }: { children?: ReactNode }) {
  return (
    <p className="text-muted-foreground px-4 py-8 text-center text-sm">
      {children ?? "Nothing here yet."}
    </p>
  );
}

export type Tone = "ok" | "warn" | "error" | "muted" | "primary" | "accent";

// Colored, on-brand status pills. emerald/amber are the project's established
// "healthy / needs-attention" cues (status dots, impersonation banner); accent
// is chartreuse (light) / lavender (dark). All adapt to dark mode.
const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
  primary: "border-transparent bg-primary text-primary-foreground",
  accent: "border-accent/50 bg-accent/15 text-foreground",
};

/** One source of truth for status pills across admin (active/ready/error/…). */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("border", TONE_CLASS[tone])}>
      {children}
    </Badge>
  );
}

/** A small status dot (green ok / amber warn / red error / grey idle). */
export function StatusDot({ tone }: { tone: "ok" | "warn" | "error" | "idle" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        tone === "ok"
          ? "bg-emerald-500"
          : tone === "warn"
            ? "bg-amber-500"
            : tone === "error"
              ? "bg-destructive"
              : "bg-muted-foreground/40",
      )}
    />
  );
}
