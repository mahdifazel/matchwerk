"use client";

import { Eye, EyeOff, KeyRound, Loader2, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JobSourceId } from "@/generated/prisma/enums";
import type { CredentialStatusDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  sourceId: JobSourceId;
  sourceLabel: string;
  sourceNote?: string;
  onStatusChange?: () => void;
};

const SOURCE_LABEL: Record<"db" | "env" | "none", string> = {
  db: "Saved in app",
  env: "Using .env.local",
  none: "Not configured",
};

const SOURCE_DOT_CLASS: Record<"db" | "env" | "none", string> = {
  db: "bg-[#DCCE40]",
  env: "bg-[#C4AEF4]",
  none: "bg-muted-foreground/40",
};

export function CredentialEditor({
  sourceId,
  sourceLabel,
  sourceNote,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<CredentialStatusDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/credentials`);
      const data = await res.json();
      setStatus(data.status);
    } catch {
      toast.error(`Could not load ${sourceLabel} credentials.`);
    } finally {
      setLoading(false);
    }
  }, [sourceId, sourceLabel]);

  useEffect(() => {
    // refresh sets a loading flag synchronously — intended for this data effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function startEdit() {
    if (!status) return;
    setValues(Object.fromEntries(status.fields.map((f) => [f.id, ""])));
    setRevealed({});
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setValues({});
    setRevealed({});
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save credential.");
        return;
      }
      setStatus(data.status);
      setEditing(false);
      setValues({});
      setRevealed({});
      toast.success(`${sourceLabel} credentials saved.`);
      onStatusChange?.();
    } catch {
      toast.error("Network error — credential not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function clearCred() {
    setClearing(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/credentials`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not clear credential.");
        return;
      }
      setStatus(data.status);
      toast.success(
        data.status?.source === "env"
          ? `${sourceLabel} key cleared — using .env.local fallback.`
          : `${sourceLabel} key cleared.`,
      );
      onStatusChange?.();
    } catch {
      toast.error("Network error — credential not cleared.");
    } finally {
      setClearing(false);
    }
  }

  if (loading) {
    return (
      <div className="border-border/70 rounded-2xl border p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading {sourceLabel}…
        </div>
      </div>
    );
  }

  if (!status) return null;

  const rollup = status.source;

  return (
    <div
      className={cn(
        "border-border/70 rounded-2xl border p-5 transition-colors",
        editing && "border-foreground/30 bg-card/80 ring-1 ring-foreground/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KeyRound className="text-muted-foreground size-3.5" />
            <h4 className="text-[0.95rem] font-medium tracking-tight">
              {sourceLabel}
            </h4>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                SOURCE_DOT_CLASS[rollup],
              )}
              aria-hidden
            />
            <span className="text-muted-foreground text-xs">
              {SOURCE_LABEL[rollup]}
            </span>
            {status.lastUpdated && rollup === "db" && (
              <span className="text-muted-foreground/70 text-[0.7rem]">
                · updated {new Date(status.lastUpdated).toLocaleDateString()}
              </span>
            )}
          </div>
          {sourceNote && !editing && (
            <p className="text-muted-foreground/80 mt-2 text-[0.78rem]">
              {sourceNote}
            </p>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={startEdit}
            >
              <Pencil className="size-3" />
              {rollup === "db" ? "Replace" : "Set key"}
            </Button>
            {rollup === "db" && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground gap-1.5"
                      disabled={clearing}
                    />
                  }
                >
                  <X className="size-3" />
                  Clear
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Clear {sourceLabel} credentials?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      The saved value will be deleted. If a value is present in{" "}
                      <code>.env.local</code>, it will be used as the fallback.
                      Otherwise the source becomes inactive.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        clearCred();
                      }}
                    >
                      Clear
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      {/* Saved-state read-out (when not editing) */}
      {!editing && (
        <div className="mt-3 space-y-1.5">
          {status.fields.map((field) => (
            <div
              key={field.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.85rem]"
            >
              <span className="text-muted-foreground">{field.label}</span>
              <span className="font-mono tabular-nums">
                {field.set ? field.masked : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mt-4 space-y-3">
          {status.fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label
                htmlFor={`${sourceId}-${field.id}`}
                className="text-[0.8rem]"
              >
                {field.label}
                {field.set && (
                  <span className="text-muted-foreground/70 ml-2 font-mono text-[0.7rem]">
                    current: {field.masked}
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id={`${sourceId}-${field.id}`}
                  type={
                    field.secret && !revealed[field.id] ? "password" : "text"
                  }
                  placeholder={
                    field.set
                      ? "Leave blank to keep current"
                      : "Paste value here"
                  }
                  autoComplete="off"
                  value={values[field.id] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.id]: e.target.value }))
                  }
                  className="pr-9 font-mono"
                />
                {field.secret && (
                  <button
                    type="button"
                    aria-label={revealed[field.id] ? "Hide" : "Show"}
                    onClick={() =>
                      setRevealed((r) => ({ ...r, [field.id]: !r[field.id] }))
                    }
                    className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-2 my-auto inline-flex size-7 items-center justify-center"
                  >
                    {revealed[field.id] ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={
                saving ||
                !Object.values(values).some((v) => v && v.trim().length > 0)
              }
              className="gap-1.5"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save credential
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
