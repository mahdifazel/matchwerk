"use client";

import { Check, KeyRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BudgetSettings } from "@/components/admin/budget-settings";
import { ContactDestinationSettings } from "@/components/admin/contact-destination-settings";
import { EmailSettings } from "@/components/admin/email-settings";
import { RateLimitSettings } from "@/components/admin/rate-limit-settings";
import { SourceSettings } from "@/components/admin/source-settings";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ProviderId = "claude" | "gemini" | "groq";

// Canonical fallback priority — Groq (free) sits between Gemini and Claude.
const FALLBACK_ORDER: ProviderId[] = ["gemini", "groq", "claude"];

type Provider = {
  id: ProviderId;
  label: string;
  keyName: string;
  models: { cvParse: string; scoring: string };
  active: boolean;
  enabled: boolean;
  configured: boolean;
  key: { origin: "db" | "env" | "none"; masked: string | null };
};

type Config = {
  active: ProviderId;
  fallback: ProviderId[];
  enabled: Record<ProviderId, boolean>;
  scoringActive: ProviderId | null;
};

export function SystemSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/ai")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setProviders(d.providers ?? []);
        setConfig(d.config ?? null);
      })
      .catch(() => toast.error("Could not load AI settings."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = useCallback(
    async (next: Config) => {
      setBusy(true);
      const res = await fetch("/api/admin/system/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setBusy(false);
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.error ?? "Could not save.");
        return;
      }
      toast.success("AI settings saved.");
      load();
    },
    [load],
  );

  function makeActive(id: ProviderId) {
    if (!config) return;
    saveConfig({
      active: id,
      fallback: FALLBACK_ORDER,
      enabled: { ...config.enabled, [id]: true },
      scoringActive: config.scoringActive,
    });
  }

  function toggleEnabled(id: ProviderId) {
    if (!config) return;
    const nextEnabled = { ...config.enabled, [id]: !config.enabled[id] };
    if (!nextEnabled[config.active]) {
      toast.error("Can't disable the active provider. Switch active first.");
      return;
    }
    saveConfig({
      active: config.active,
      fallback: FALLBACK_ORDER,
      enabled: nextEnabled,
      scoringActive: config.scoringActive,
    });
  }

  function toggleScoringOnGroq() {
    if (!config) return;
    const next: ProviderId | null = config.scoringActive === "groq" ? null : "groq";
    saveConfig({ ...config, scoringActive: next });
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="System Settings"
        description="Manage AI provider keys, switch the active provider, job-source keys, rate limits, and budget alerts. No code changes or redeploy needed."
      />

      <section className="space-y-3">
        <h2 className="eyebrow">AI providers</h2>
        <p className="text-muted-foreground text-sm">
          The <strong>active</strong> provider handles CV parsing and job
          scoring. If it errors, the app falls back to the next enabled provider
          that has a key.
        </p>

        {loading || !config ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                busy={busy}
                onMakeActive={() => makeActive(p.id)}
                onToggleEnabled={() => toggleEnabled(p.id)}
                onChanged={load}
              />
            ))}
          </div>
        )}

        {config && (
          <ScoringProviderToggle
            on={config.scoringActive === "groq"}
            groqReady={Boolean(
              providers.find((p) => p.id === "groq")?.configured &&
                config.enabled.groq,
            )}
            busy={busy}
            onToggle={toggleScoringOnGroq}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Job sources</h2>
        <p className="text-muted-foreground text-sm">
          Global API keys and on/off switches for every job source. These apply
          to all users. There&apos;s no per-user source configuration anymore.
        </p>
        <SourceSettings />
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Rate limits</h2>
        <RateLimitSettings />
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Budget &amp; cost alerts</h2>
        <BudgetSettings />
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Email (SMTP)</h2>
        <EmailSettings />
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Contact destination</h2>
        <ContactDestinationSettings />
      </section>
    </div>
  );
}

function ScoringProviderToggle({
  on,
  groqReady,
  busy,
  onToggle,
}: {
  on: boolean;
  groqReady: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  // Off can always be set; On requires a configured + enabled Groq.
  const disabled = busy || (!on && !groqReady);
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card p-5">
      <div>
        <h3 className="font-display text-lg tracking-tight">Run job scoring on Groq</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Score jobs with Groq (free) while CV parsing stays on the active
          provider for quality. Falls back through the normal chain if Groq is
          unavailable. When off, scoring uses the active provider like today.
        </p>
        {!groqReady && (
          <p className="text-muted-foreground mt-2 text-xs">
            Add a Groq key and enable the Groq provider above to turn this on.
          </p>
        )}
      </div>
      <Switch
        checked={on}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label="Run job scoring on Groq"
      />
    </div>
  );
}

function ProviderCard({
  provider,
  busy,
  onMakeActive,
  onToggleEnabled,
  onChanged,
}: {
  provider: Provider;
  busy: boolean;
  onMakeActive: () => void;
  onToggleEnabled: () => void;
  onChanged: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  async function saveKey(value: string) {
    setSavingKey(true);
    const res = await fetch("/api/admin/system/ai/key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyName: provider.keyName, value }),
    });
    setSavingKey(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save key.");
      return;
    }
    setKeyInput("");
    toast.success(value ? "Key saved." : "Key removed.");
    onChanged();
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-5",
        provider.active ? "border-accent/60 bg-card ring-1 ring-accent/30" : "border-border/60 bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg tracking-tight">{provider.label}</h3>
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">
            {provider.models.scoring}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {provider.active && <StatusBadge tone="accent">Active</StatusBadge>}
          {provider.configured ? (
            <StatusBadge tone="ok">Key set</StatusBadge>
          ) : (
            <StatusBadge tone="error">No key</StatusBadge>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {provider.active ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Check className="size-3.5" /> Active provider
          </span>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={onMakeActive}>
            Make active
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onToggleEnabled}
          className={provider.enabled ? "text-foreground" : "text-muted-foreground"}
        >
          {provider.enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>

      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs">
          <KeyRound className="size-3.5" />
          <span className="font-mono">{provider.keyName}</span>
        </div>
        {provider.key.origin !== "none" ? (
          <p className="mb-2 text-xs">
            <span className="tabular-nums">{provider.key.masked}</span>{" "}
            <span className="text-muted-foreground">
              ({provider.key.origin === "env" ? "from environment" : "stored"})
            </span>
          </p>
        ) : (
          <p className="text-muted-foreground mb-2 text-xs">No key configured.</p>
        )}
        <div className="flex gap-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste API key…"
            className="h-9"
          />
          <Button size="sm" disabled={savingKey || !keyInput.trim()} onClick={() => saveKey(keyInput.trim())}>
            Save
          </Button>
          {provider.key.origin === "db" && (
            <Button size="sm" variant="outline" disabled={savingKey} onClick={() => saveKey("")}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
