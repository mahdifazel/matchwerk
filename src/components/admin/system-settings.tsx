"use client";

import { Check, ChevronDown, ChevronUp, KeyRound, RotateCcw } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BudgetSettings } from "@/components/admin/budget-settings";
import { ContactDestinationSettings } from "@/components/admin/contact-destination-settings";
import { EmailSettings } from "@/components/admin/email-settings";
import { RateLimitSettings } from "@/components/admin/rate-limit-settings";
import { ScoringLimitSettings } from "@/components/admin/scoring-limit-settings";
import { SourceSettings } from "@/components/admin/source-settings";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
      ...config,
      active: id,
      enabled: { ...config.enabled, [id]: true },
    });
  }

  function toggleEnabled(id: ProviderId) {
    if (!config) return;
    const nextEnabled = { ...config.enabled, [id]: !config.enabled[id] };
    if (!nextEnabled[config.active]) {
      toast.error("Can't disable the active provider. Switch active first.");
      return;
    }
    saveConfig({ ...config, enabled: nextEnabled });
  }

  function setScoringProvider(next: ProviderId | null) {
    if (!config || config.scoringActive === next) return;
    saveConfig({ ...config, scoringActive: next });
  }

  function reorderFallback(index: number, dir: -1 | 1) {
    if (!config) return;
    const target = index + dir;
    if (target < 0 || target >= config.fallback.length) return;
    const next = [...config.fallback];
    [next[index], next[target]] = [next[target], next[index]];
    saveConfig({ ...config, fallback: next });
  }

  function resetFallback() {
    if (!config) return;
    saveConfig({ ...config, fallback: FALLBACK_ORDER });
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
          <FallbackOrderEditor
            fallback={config.fallback}
            providers={providers}
            busy={busy}
            onReorder={reorderFallback}
            onReset={resetFallback}
          />
        )}

        {config && (
          <ScoringProviderSelect
            value={config.scoringActive}
            providers={providers}
            busy={busy}
            onSelect={setScoringProvider}
          />
        )}

        <div className="space-y-3 pt-2">
          <h3 className="font-display text-lg tracking-tight">
            Jobs scored per Research
          </h3>
          <ScoringLimitSettings />
        </div>
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

function FallbackOrderEditor({
  fallback,
  providers,
  busy,
  onReorder,
  onReset,
}: {
  fallback: ProviderId[];
  providers: Provider[];
  busy: boolean;
  onReorder: (index: number, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  const isDefaultOrder =
    fallback.length === FALLBACK_ORDER.length &&
    fallback.every((id, i) => id === FALLBACK_ORDER[i]);
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg tracking-tight">Fallback order</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            When the active (or chosen scoring) provider errors, the app tries
            these in order, skipping any that&apos;s disabled or missing a key.
            Reorder to control which provider catches the overflow first.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || isDefaultOrder}
          onClick={onReset}
        >
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </div>
      <ol className="mt-4 space-y-2">
        {fallback.map((id, i) => {
          const p = providers.find((x) => x.id === id);
          const skipped = p ? !p.enabled || !p.configured : false;
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-4 text-xs tabular-nums">
                  {i + 1}
                </span>
                <span className="text-sm">{p?.label ?? id}</span>
                {skipped && (
                  <span className="text-muted-foreground text-xs">
                    ({p && !p.enabled ? "disabled" : "no key"} — skipped)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || i === 0}
                  onClick={() => onReorder(i, -1)}
                  aria-label={`Move ${p?.label ?? id} up`}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || i === fallback.length - 1}
                  onClick={() => onReorder(i, 1)}
                  aria-label={`Move ${p?.label ?? id} down`}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Short cost/quality hint per scoring choice. `null` = "use the active provider".
const SCORING_HINTS: Record<ProviderId, string> = {
  claude: "Haiku 4.5 — highest quality, highest cost.",
  gemini: "Gemini Flash — ~3× cheaper than Haiku, near-Haiku quality. Best value.",
  groq: "Llama 3.3 — free, but lower nuance on language/seniority signals.",
};

function ScoringProviderSelect({
  value,
  providers,
  busy,
  onSelect,
}: {
  value: ProviderId | null;
  providers: Provider[];
  busy: boolean;
  onSelect: (id: ProviderId | null) => void;
}) {
  // A provider is selectable for scoring only when it has a key AND is enabled,
  // so scoring never points at a provider the chain would skip. "Same as active"
  // (null) is always available — it just defers to the active provider.
  const ready = (id: ProviderId) =>
    Boolean(providers.find((p) => p.id === id)?.configured) &&
    Boolean(providers.find((p) => p.id === id)?.enabled);

  const options: { id: ProviderId | null; label: string }[] = [
    { id: null, label: "Same as active" },
    ...providers.map((p) => ({ id: p.id, label: p.label })),
  ];

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <h3 className="font-display text-lg tracking-tight">Scoring provider</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Which provider rates jobs. CV parsing always uses the active provider for
        quality; this only changes job scoring (the recurring cost). Falls back
        through the normal chain if the chosen provider is unavailable.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt.id;
          const disabled =
            busy || (opt.id !== null && !ready(opt.id) && !selected);
          return (
            <Button
              key={opt.id ?? "active"}
              size="sm"
              variant={selected ? "default" : "outline"}
              disabled={disabled}
              onClick={() => onSelect(opt.id)}
            >
              {selected && <Check className="size-3.5" />}
              {opt.label}
            </Button>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        {value === null
          ? "Scoring uses the active provider, same as today."
          : SCORING_HINTS[value]}
      </p>
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
