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
import { cn } from "@/lib/utils";

const SENIORITY_LABEL: Record<string, string> = {
  JUNIOR: "Junior",
  MID: "Mid-level",
  SENIOR: "Senior",
  LEAD: "Lead",
  UNKNOWN: "Unknown",
};

type ListKey = "skills" | "tools" | "industries" | "keywords";

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
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge
            key={item}
            variant="secondary"
            className="gap-1 pl-2 pr-1 text-[11px]"
          >
            {item}
            <button
              type="button"
              aria-label={`Remove ${item}`}
              onClick={() => onRemove(item)}
              className="hover:text-foreground text-muted-foreground -mr-0.5 inline-flex size-3.5 items-center justify-center rounded-full transition-colors"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
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
          className="h-8 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
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
  keywords: string[];
};

function profileToDraft(p: ProfileDTO): Draft {
  return {
    summary: p.summary,
    skills: [...p.skills],
    tools: [...p.tools],
    industries: [...p.industries],
    keywords: [...p.keywords],
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  if (a.summary !== b.summary) return false;
  const keys: ListKey[] = ["skills", "tools", "industries", "keywords"];
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
      toast.success("CV parsed — profile updated.");
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
              <p className="text-muted-foreground mb-1.5 text-xs uppercase tracking-wide">
                Summary
              </p>
              <Textarea
                value={draft.summary}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, summary: e.target.value } : prev,
                  )
                }
                rows={5}
                className="text-sm leading-relaxed"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {SENIORITY_LABEL[profile.seniority] ?? profile.seniority}
              </Badge>
              <Badge variant="outline">
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
