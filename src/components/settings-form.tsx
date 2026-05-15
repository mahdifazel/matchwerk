"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import {
  JOB_TYPE_OPTIONS,
  LOCATION_OPTIONS,
  SENIORITY_OPTIONS,
  SOURCE_META,
} from "@/lib/constants";
import type { SettingsDTO } from "@/lib/types";
import { useSourceStatus } from "@/lib/use-source-status";
import { cn } from "@/lib/utils";

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function SettingsForm() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const sourceStatus = useSourceStatus();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => toast.error("Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  function patch(next: Partial<SettingsDTO>) {
    setSettings((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function save() {
    if (!settings) return;
    const jobTitles = settings.jobTitles
      .map((t) => t.trim())
      .filter(Boolean);
    if (jobTitles.length === 0) {
      toast.error("Add at least one job title.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobTitles,
          defaultLocations: settings.defaultLocations,
          defaultSeniority: settings.defaultSeniority,
          defaultJobTypes: settings.defaultJobTypes,
          defaultSources: settings.defaultSources,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save settings.");
        return;
      }
      setSettings(data.settings);
      toast.success("Settings saved.");
    } catch {
      toast.error("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return <Skeleton className="h-96 rounded-xl" />;
  }

  return (
    <Card className="rounded-2xl ring-1 ring-foreground/[0.04]">
      <CardHeader>
        <CardTitle className="font-display text-[1.5rem] leading-tight tracking-tight">
          Search Preferences
        </CardTitle>
        <CardDescription className="text-[0.875rem]">
          Target titles and defaults used every time you refresh jobs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Job titles</h3>
          <p className="text-muted-foreground text-xs">
            These drive the actual job search queries.
          </p>
          <div className="space-y-2">
            {settings.jobTitles.map((title, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={title}
                  placeholder="e.g. Senior Product Designer"
                  onChange={(e) => {
                    const next = [...settings.jobTitles];
                    next[i] = e.target.value;
                    patch({ jobTitles: next });
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove title"
                  onClick={() =>
                    patch({
                      jobTitles: settings.jobTitles.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              patch({ jobTitles: [...settings.jobTitles, ""] })
            }
          >
            <Plus className="size-3.5" /> Add title
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Locations</h3>
          <div className="flex flex-wrap gap-2">
            {LOCATION_OPTIONS.map((l) => (
              <Toggle
                key={l.id}
                size="sm"
                variant="outline"
                pressed={settings.defaultLocations.includes(l.id)}
                onPressedChange={() =>
                  patch({
                    defaultLocations: toggleIn(settings.defaultLocations, l.id),
                  })
                }
              >
                {l.label}
              </Toggle>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Seniority</h3>
          <div className="flex flex-wrap gap-2">
            {SENIORITY_OPTIONS.map((s) => (
              <Toggle
                key={s.id}
                size="sm"
                variant="outline"
                pressed={settings.defaultSeniority.includes(s.id)}
                onPressedChange={() =>
                  patch({
                    defaultSeniority: toggleIn(
                      settings.defaultSeniority,
                      s.id,
                    ),
                  })
                }
              >
                {s.label}
              </Toggle>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Job types</h3>
          <div className="flex flex-wrap gap-2">
            {JOB_TYPE_OPTIONS.map((t) => (
              <Toggle
                key={t.id}
                size="sm"
                variant="outline"
                pressed={settings.defaultJobTypes.includes(t.id)}
                onPressedChange={() =>
                  patch({
                    defaultJobTypes: toggleIn(settings.defaultJobTypes, t.id),
                  })
                }
              >
                {t.label}
              </Toggle>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Sources</h3>
          <p className="text-muted-foreground text-xs">
            JSearch is the primary aggregator; Adzuna is queried as a backup when
            JSearch is short. Sources without API keys stay inactive — no mock
            data is ever shown.
          </p>
          <div className="space-y-2">
            {SOURCE_META.map((s) => {
              const status = sourceStatus.get(s.id);
              const usable = status
                ? status.connected && status.configured
                : s.connected;
              let statusLabel = "";
              if (!s.connected) statusLabel = "disabled";
              else if (status && !status.configured) statusLabel = "API key needed";
              else if (usable) statusLabel = "ready";
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <Toggle
                    size="sm"
                    variant="outline"
                    pressed={settings.defaultSources.includes(s.id)}
                    disabled={!usable}
                    onPressedChange={() =>
                      patch({
                        defaultSources: toggleIn(
                          settings.defaultSources,
                          s.id,
                        ),
                      })
                    }
                  >
                    {s.label}
                  </Toggle>
                  <span className="text-muted-foreground text-xs">
                    {s.note}
                    {statusLabel && (
                      <span
                        className={cn(
                          "ml-1.5 font-medium",
                          statusLabel === "ready" && "text-emerald-600 dark:text-emerald-400",
                          statusLabel === "API key needed" && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        · {statusLabel}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save preferences
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
