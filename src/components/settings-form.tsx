"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import type { SettingsDTO } from "@/lib/types";

export function SettingsForm() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(data.settings);
    } catch {
      toast.error("Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
  }, [loadSettings]);

  // CV upload auto-fills jobTitles with the 3 model-suggested titles — reload
  // the form so the user sees the updated values immediately.
  useEffect(() => {
    function onCvUpdated() {
      loadSettings();
    }
    window.addEventListener("cv-updated", onCvUpdated);
    return () => window.removeEventListener("cv-updated", onCvUpdated);
  }, [loadSettings]);

  function patch(next: Partial<SettingsDTO>) {
    setSettings((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function save() {
    if (!settings) return;
    const jobTitles = settings.jobTitles.map((t) => t.trim()).filter(Boolean);
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
      window.dispatchEvent(new Event("settings-updated"));
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
          Target titles used every time you refresh jobs.
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
                  className="bg-card dark:bg-background h-9"
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
            onClick={() => patch({ jobTitles: [...settings.jobTitles, ""] })}
          >
            <Plus className="size-3.5" /> Add title
          </Button>
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
