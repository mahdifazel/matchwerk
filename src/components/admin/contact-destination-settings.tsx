"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Origin = "db" | "env" | "none";
type State = { origin: Origin; value: string };

/**
 * Where /contact-form messages get delivered. Stored in the AppSetting
 * `contact_to` (DB) with `CONTACT_TO` env as a fallback. Saving an empty
 * value clears the DB row and re-exposes the env fallback.
 */
export function ContactDestinationSettings() {
  const [state, setState] = useState<State | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/system/contact")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: State) => {
        setState(d);
        setInput(d.origin === "db" ? d.value : "");
      })
      .catch(() => toast.error("Could not load contact destination."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(value: string) {
    setBusy(true);
    const res = await fetch("/api/admin/system/contact", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    setState(d);
    setInput(d.origin === "db" ? d.value : "");
    toast.success(value ? "Contact destination saved." : "Cleared. Using env fallback.");
  }

  if (!state) {
    return <Skeleton className="h-32 rounded-2xl" />;
  }

  return (
    <div className="border-border/60 bg-card rounded-2xl border p-5">
      <p className="text-muted-foreground mb-4 text-sm">
        Email address that receives messages submitted via{" "}
        <code className="font-mono text-xs">/contact</code>. DB value
        overrides the <code className="font-mono text-xs">CONTACT_TO</code>{" "}
        env var; clear the field to fall back to env.
      </p>

      <div className="space-y-2">
        <Label htmlFor="contact-to">Destination email</Label>
        <div className="flex gap-2">
          <Input
            id="contact-to"
            type="email"
            inputMode="email"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="you@example.com"
            className="h-9"
          />
          <Button size="sm" disabled={busy} onClick={() => save(input.trim())}>
            Save
          </Button>
          {state.origin === "db" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => save("")}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          {state.origin === "db" ? (
            <>
              <strong>Stored:</strong>{" "}
              <span className="font-mono">{state.value}</span>
            </>
          ) : state.origin === "env" ? (
            <>
              <strong>From env:</strong>{" "}
              <span className="font-mono">{state.value}</span> · save a value
              above to override.
            </>
          ) : (
            <>
              <span className="text-destructive">
                Not configured. Contact messages are saved but no email is
                sent.
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
