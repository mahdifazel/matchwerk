"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Skeleton } from "@/components/ui/skeleton";

type Config = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
};
type PasswordState = { origin: "db" | "env" | "none"; masked: string | null };

export function EmailSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [password, setPassword] = useState<PasswordState | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/email")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setConfig(d.config ?? null);
        setPassword(d.password ?? null);
      })
      .catch(() => toast.error("Could not load email settings."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!config) return;
    setBusy(true);
    const res = await fetch("/api/admin/system/email", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pwInput.trim() ? { ...config, password: pwInput.trim() } : config),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    setPwInput("");
    toast.success("Email settings saved.");
    load();
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setTesting(true);
    const res = await fetch("/api/admin/system/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testTo.trim() }),
    });
    setTesting(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Test send failed.");
      return;
    }
    toast.success(`Test email sent via ${d.via}.`);
  }

  if (!config) return <Skeleton className="h-80 rounded-2xl" />;

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setConfig({ ...config, [k]: v });

  return (
    <div className="border-border/60 bg-card space-y-4 rounded-2xl border p-5">
      <p className="text-muted-foreground text-sm">
        SMTP server used to send the <strong>forgot-password</strong> reset
        email. When SMTP is off, the app falls back to Resend
        (<code>RESEND_API_KEY</code>) if set, otherwise logs the reset link to the
        server console in dev.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={config.enabled ? "default" : "outline"}
          onClick={() => set("enabled", !config.enabled)}
        >
          SMTP: {config.enabled ? "On" : "Off"}
        </Button>
        <Button
          size="sm"
          variant={config.secure ? "default" : "outline"}
          onClick={() => set("secure", !config.secure)}
        >
          TLS (secure): {config.secure ? "On" : "Off"}
        </Button>
        <span className="text-muted-foreground text-xs">port 465 → TLS on · 587 → off (STARTTLS)</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Host">
          <Input value={config.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" className="h-9" />
        </Field>
        <Field label="Port">
          <NumberInput min={1} max={65535} allowDecimal={false} fallback={587} value={config.port} onValueChange={(n) => set("port", n)} className="h-9" />
        </Field>
        <Field label="Username">
          <Input value={config.user} onChange={(e) => set("user", e.target.value)} placeholder="smtp username" className="h-9" />
        </Field>
        <Field label="From address">
          <Input value={config.from} onChange={(e) => set("from", e.target.value)} placeholder="Matchwerk <no-reply@example.com>" className="h-9" />
        </Field>
        <Field label="Password">
          {password && password.origin !== "none" && (
            <p className="text-muted-foreground mb-1 text-xs tabular-nums">
              {password.masked} ({password.origin === "env" ? "from env" : "stored"})
            </p>
          )}
          <Input
            type="password"
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder={password && password.origin !== "none" ? "Replace…" : "Paste password…"}
            className="h-9"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button size="sm" onClick={save} disabled={busy}>
          Save email settings
        </Button>
        <div className="hidden flex-1 sm:block" />
        <Input
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="you@example.com"
          className="h-9 sm:max-w-[14rem]"
        />
        <Button size="sm" variant="outline" onClick={sendTest} disabled={testing || !testTo.trim()}>
          {testing ? "Sending…" : "Send test"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
