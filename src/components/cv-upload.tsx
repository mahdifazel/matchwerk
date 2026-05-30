"use client";

import { FileText, Loader2, Plus, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import type { ProfileDTO } from "@/lib/types";
import { formatTokens, notifyTokensUpdated } from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

const SENIORITY_LABEL: Record<string, string> = {
  JUNIOR: "Junior",
  MID: "Mid-level",
  SENIOR: "Senior",
  LEAD: "Lead",
  UNKNOWN: "Unknown",
};

type ListKey = "skills" | "tools" | "industries" | "languages" | "keywords";

function EditableChipList({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const next = draft.trim();
    if (!next) return;
    if (items.some((i) => i.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    onAdd(next);
    setDraft("");
  }

  return (
    <div className="border-border/60 bg-muted/30 dark:border-white/10 dark:bg-white/[0.03] flex flex-col rounded-xl border p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h4 className="eyebrow text-[0.7rem]">{label}</h4>
        <span className="text-muted-foreground bg-muted dark:bg-white/10 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-medium tabular-nums">
          {items.length}
        </span>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="border-border/70 bg-card text-foreground/90 dark:border-white/10 dark:bg-secondary dark:text-secondary-foreground dark:shadow-none inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-[0.8rem] font-medium shadow-[0_1px_2px_rgba(26,18,51,0.04)]"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onRemove(item)}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex size-5 items-center justify-center rounded-full transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground/70 text-xs italic">
          Nothing added yet.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={draft}
          placeholder={`Add ${label.toLowerCase()}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          className="bg-card dark:bg-background h-9"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={commit}
          disabled={!draft.trim()}
        >
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

type Draft = {
  summary: string;
  skills: string[];
  tools: string[];
  industries: string[];
  languages: string[];
  keywords: string[];
};

function profileToDraft(p: ProfileDTO): Draft {
  return {
    summary: p.summary,
    skills: [...p.skills],
    tools: [...p.tools],
    industries: [...p.industries],
    languages: [...(p.languages ?? [])],
    keywords: [...p.keywords],
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  if (a.summary !== b.summary) return false;
  const keys: ListKey[] = ["skills", "tools", "industries", "languages", "keywords"];
  for (const k of keys) {
    if (a[k].length !== b[k].length) return false;
    for (let i = 0; i < a[k].length; i++) {
      if (a[k][i] !== b[k][i]) return false;
    }
  }
  return true;
}

export function CvUpload() {
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => {
        const p: ProfileDTO | null = d.profile ?? null;
        setProfile(p);
        setDraft(p ? profileToDraft(p) : null);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => {
    if (!profile || !draft) return false;
    return !draftsEqual(draft, profileToDraft(profile));
  }, [profile, draft]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/cv", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not parse CV.");
        return;
      }
      setProfile(data.profile);
      setDraft(profileToDraft(data.profile));
      window.dispatchEvent(new Event("cv-updated"));
      notifyTokensUpdated();
      const suggested: string[] = data.suggestedJobTitles ?? [];
      const cleared: number = data.clearedJobs ?? 0;
      const charged: number = data.tokens?.charged ?? 0;
      const descriptionLines: string[] = [];
      if (charged > 0) {
        descriptionLines.push(`Spent ${formatTokens(charged)} tokens`);
      }
      if (suggested.length > 0) {
        descriptionLines.push(`Suggested titles: ${suggested.join(", ")}`);
      }
      if (cleared > 0) {
        descriptionLines.push(
          `Cleared ${cleared} previous match${cleared === 1 ? "" : "es"}. Hit Refresh on the board to score against the new CV.`,
        );
      }
      toast.success(
        "CV parsed — profile updated.",
        descriptionLines.length > 0
          ? { description: descriptionLines.join(" · ") }
          : undefined,
      );
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft || !profile) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cv", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save profile.");
        return;
      }
      setProfile(data.profile);
      setDraft(profileToDraft(data.profile));
      toast.success("Profile updated.");
    } catch {
      toast.error("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  function patchList(key: ListKey, next: string[]) {
    setDraft((prev) => (prev ? { ...prev, [key]: next } : prev));
  }

  if (loading) {
    return <Skeleton className="h-48 rounded-xl" />;
  }

  return (
    <Card className="rounded-2xl ring-1 ring-foreground/[0.04]">
      <CardHeader>
        <CardTitle className="font-display text-[1.5rem] leading-tight tracking-tight">
          CV Profile
        </CardTitle>
        <CardDescription className="text-[0.875rem]">
          Parsed once and remembered. Upload a new file any time to replace it,
          or edit any field below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
          className={cn(
            "border-border focus-visible:ring-ring hover:border-primary/60 hover:bg-muted/40 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
            dragOver && "border-primary bg-muted/50",
            uploading && "pointer-events-none opacity-60",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          ) : (
            <Upload className="text-muted-foreground size-5" />
          )}
          <p className="mt-2 text-sm font-medium">
            {uploading
              ? "Parsing your CV…"
              : profile
                ? "Drop a new CV to replace"
                : "Drop your CV here, or click to browse"}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            PDF, DOCX, or TXT — up to 8 MB
          </p>
        </div>

        {profile && draft ? (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground size-4" />
              <span className="font-medium">{profile.fileName}</span>
              <span className="text-muted-foreground text-xs">
                · parsed {new Date(profile.parsedAt).toLocaleDateString()}
              </span>
            </div>

            <div>
              <p className="eyebrow mb-1.5 text-[0.7rem]">Summary</p>
              <Textarea
                value={draft.summary}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, summary: e.target.value } : prev,
                  )
                }
                rows={5}
                className="bg-card dark:bg-background text-sm leading-relaxed"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="h-7 px-3 text-[0.78rem]">
                {SENIORITY_LABEL[profile.seniority] ?? profile.seniority}
              </Badge>
              <Badge variant="secondary" className="h-7 px-3 text-[0.78rem]">
                {profile.yearsExperience} yrs experience
              </Badge>
            </div>

            <div className="grid gap-4">
              <EditableChipList
                label="Skills"
                items={draft.skills}
                onAdd={(v) => patchList("skills", [...draft.skills, v])}
                onRemove={(v) =>
                  patchList(
                    "skills",
                    draft.skills.filter((i) => i !== v),
                  )
                }
              />
              <EditableChipList
                label="Tools"
                items={draft.tools}
                onAdd={(v) => patchList("tools", [...draft.tools, v])}
                onRemove={(v) =>
                  patchList(
                    "tools",
                    draft.tools.filter((i) => i !== v),
                  )
                }
              />
              <EditableChipList
                label="Industries"
                items={draft.industries}
                onAdd={(v) => patchList("industries", [...draft.industries, v])}
                onRemove={(v) =>
                  patchList(
                    "industries",
                    draft.industries.filter((i) => i !== v),
                  )
                }
              />
              <EditableChipList
                label="Languages"
                items={draft.languages}
                onAdd={(v) => patchList("languages", [...draft.languages, v])}
                onRemove={(v) =>
                  patchList(
                    "languages",
                    draft.languages.filter((i) => i !== v),
                  )
                }
              />
              <EditableChipList
                label="Keywords"
                items={draft.keywords}
                onAdd={(v) => patchList("keywords", [...draft.keywords, v])}
                onRemove={(v) =>
                  patchList(
                    "keywords",
                    draft.keywords.filter((i) => i !== v),
                  )
                }
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              {dirty && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(profileToDraft(profile))}
                  disabled={saving}
                >
                  Discard changes
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                className="gap-2"
                onClick={save}
                disabled={!dirty || saving}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save profile
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No CV uploaded yet. Job matching needs your profile to score
            listings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
