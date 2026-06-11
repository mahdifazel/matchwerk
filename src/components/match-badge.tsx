import { Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tier = "strong" | "good" | "weak" | "none";

function tier(score: number | null): Tier {
  if (score === null) return "none";
  if (score >= 90) return "strong";
  if (score >= 70) return "good";
  return "weak";
}

/* ── Compact badge ────────────────────────────────────────────────── */

const BADGE_CLS: Record<Tier, string> = {
  strong:
    "bg-[#DCCE40]/30 text-[#5A4F0A] dark:text-[#DCCE40] ring-1 ring-[#B8A92A]/45",
  good: "bg-[#C4AEF4]/25 text-[#1A1233] dark:text-[#C4AEF4] ring-1 ring-[#7B5BC8]/40",
  weak: "bg-muted text-muted-foreground ring-1 ring-border",
  none: "bg-muted text-muted-foreground ring-1 ring-border",
};

const TIER_LABEL: Record<Tier, string> = {
  strong: "Strong fit",
  good: "Good fit",
  weak: "Stretch",
  none: "Unscored",
};

export function MatchBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <Badge variant="outline" className="gap-1 font-medium">
        <Minus className="size-3" />
        Not scored
      </Badge>
    );
  }
  const t = tier(score);
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-transparent font-semibold tabular-nums", BADGE_CLS[t])}
    >
      <span className="font-mono">{score}%</span>
      <span className="opacity-70">· {TIER_LABEL[t]}</span>
    </Badge>
  );
}

/* ── Editorial circular score meter (used inside JobCard) ─────────── */

const METER: Record<Tier, { ring: string; track: string; label: string }> = {
  strong: {
    ring: "#B8A92A",
    track: "rgba(220, 206, 64, 0.22)",
    label: "Strong fit",
  },
  good: {
    ring: "#7B5BC8",
    track: "rgba(196, 174, 244, 0.28)",
    label: "Good fit",
  },
  weak: {
    ring: "currentColor",
    track: "rgba(120, 105, 150, 0.18)",
    label: "Stretch",
  },
  none: {
    ring: "currentColor",
    track: "rgba(120, 105, 150, 0.18)",
    label: "Unscored",
  },
};

export function ScoreMeter({
  score,
  size = 56,
}: {
  score: number | null;
  size?: number;
}) {
  const t = tier(score);
  const m = METER[t];
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const dash = (pct / 100) * circumference;

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 flex-col items-center justify-center gap-1",
      )}
      aria-label={
        score === null ? "Not scored" : `${score} percent match, ${m.label}`
      }
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={m.track}
            strokeWidth={stroke}
          />
          {score !== null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={m.ring}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          {score === null ? (
            <Minus className="text-muted-foreground size-4" />
          ) : (
            <span className="font-display text-[1.25rem] font-semibold leading-none tabular-nums">
              {score}
            </span>
          )}
        </span>
      </div>
      <span className="eyebrow text-[0.65rem] leading-none">{m.label}</span>
    </div>
  );
}
