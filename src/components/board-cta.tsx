"use client";

import { ArrowRight, Check, FileText, Sparkles, Tags } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Discoverability nudge: once a CV profile is parsed and at least one job title
// is set, the user has everything the board needs — surface a clear way to move
// on. Both pieces of state live in sibling components (CvUpload / SettingsForm),
// so we re-derive readiness here and re-check on their update events.
export function BoardCta() {
  const [hasProfile, setHasProfile] = useState(false);
  const [hasTitles, setHasTitles] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [cvRes, settingsRes] = await Promise.all([
        fetch("/api/cv"),
        fetch("/api/settings"),
      ]);
      const cv = await cvRes.json();
      const settings = await settingsRes.json();
      setHasProfile(Boolean(cv.profile));
      setHasTitles(
        (settings.settings?.jobTitles ?? []).some(
          (t: string) => t.trim().length > 0,
        ),
      );
    } catch {
      // Leave the gate closed if we can't determine readiness.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener("cv-updated", refresh);
    window.addEventListener("settings-updated", refresh);
    return () => {
      window.removeEventListener("cv-updated", refresh);
      window.removeEventListener("settings-updated", refresh);
    };
  }, [refresh]);

  if (loading) {
    return <Skeleton className="h-72 rounded-2xl" />;
  }

  const ready = hasProfile && hasTitles;
  const completed = [hasProfile, hasTitles].filter(Boolean).length;

  const checklist: {
    done: boolean;
    icon: typeof FileText;
    label: string;
    hint: string;
  }[] = [
    {
      done: hasProfile,
      icon: FileText,
      label: "CV uploaded & parsed",
      hint: "We use it to score how well each job fits you.",
    },
    {
      done: hasTitles,
      icon: Tags,
      label: "At least one job title",
      hint: "These drive the searches we run on your behalf.",
    },
  ];

  return (
    <Card className="relative overflow-hidden rounded-2xl ring-1 ring-foreground/[0.04]">
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-1 transition-colors",
          ready ? "bg-accent" : "bg-border",
        )}
      />
      <CardHeader>
        <p className="eyebrow mb-3 flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          {ready ? "You're all set" : "Last step"}
        </p>
        <CardTitle className="font-display text-[1.75rem] leading-[1.1] tracking-tight">
          {ready ? "Time to meet your matches" : "Finish setup to start matching"}
        </CardTitle>
        <CardDescription className="mt-2 max-w-lg text-[0.9rem] leading-relaxed">
          {ready
            ? "Your CV and search preferences are saved. Open the board and hit Research to pull fresh listings and score every one against your profile."
            : "We need a couple of things before the board can find and rank jobs for you. Complete the checklist below. Uploading a CV fills most of it in automatically."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2.5">
          {checklist.map(({ done, icon: Icon, label, hint }) => (
            <div
              key={label}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3.5 transition-colors",
                done
                  ? "border-accent/40 bg-accent/[0.06] dark:bg-accent/[0.08]"
                  : "border-border/60 bg-muted/30 dark:border-white/10 dark:bg-white/[0.03]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                  done
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground dark:bg-white/10",
                )}
              >
                {done ? (
                  <Check className="size-4" />
                ) : (
                  <Icon className="size-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    !done && "text-foreground/80",
                  )}
                >
                  {label}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {hint}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs tabular-nums">
            {ready
              ? "Both steps complete, you're good to go."
              : `${completed} of ${checklist.length} steps done`}
          </p>
          {ready ? (
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href="/" />}
              className="gap-2"
            >
              Take me to the board
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button size="lg" disabled className="gap-2">
              Take me to the board
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
