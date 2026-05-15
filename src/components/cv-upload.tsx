"use client";

import { FileText, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProfileDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

const SENIORITY_LABEL: Record<string, string> = {
  JUNIOR: "Junior",
  MID: "Mid-level",
  SENIOR: "Senior",
  LEAD: "Lead",
  UNKNOWN: "Unknown",
};

function ChipList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs uppercase tracking-wide">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant="secondary" className="text-[11px]">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function CvUpload() {
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => setProfile(d.profile ?? null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

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
      toast.success("CV parsed — profile updated.");
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
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
          Parsed once and remembered. Upload a new file any time to replace it.
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

        {profile ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground size-4" />
              <span className="font-medium">{profile.fileName}</span>
              <span className="text-muted-foreground text-xs">
                · parsed {new Date(profile.parsedAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {profile.summary}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {SENIORITY_LABEL[profile.seniority] ?? profile.seniority}
              </Badge>
              <Badge variant="outline">
                {profile.yearsExperience} yrs experience
              </Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipList label="Skills" items={profile.skills} />
              <ChipList label="Tools" items={profile.tools} />
              <ChipList label="Industries" items={profile.industries} />
              <ChipList label="Keywords" items={profile.keywords} />
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
