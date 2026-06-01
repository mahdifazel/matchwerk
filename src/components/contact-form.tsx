"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { id: "QUESTION", label: "Question" },
  { id: "BUG", label: "Bug" },
  { id: "FEATURE_REQUEST", label: "Feature request" },
  { id: "OTHER", label: "Other" },
] as const;

type Category = (typeof CATEGORIES)[number]["id"];

const SUBJECT_MAX = 120;
const BODY_MAX = 2000;

export function ContactForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<Category>("QUESTION");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !body.trim()) {
      setError("Please give the message a subject and body.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, category, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not send. Please try again.");
        return;
      }
      toast.success("Message sent — we'll get back to you within a few days.");
      // Reset to defaults for a fresh follow-up if needed.
      setSubject("");
      setCategory("QUESTION");
      setBody("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const bodyOverLimit = body.length > BODY_MAX;
  const subjectOverLimit = subject.length > SUBJECT_MAX;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Identity card — read-only confirmation of what we'll attach. */}
      <div className="border-border/60 bg-muted/40 rounded-xl border p-4">
        <p className="eyebrow text-muted-foreground mb-2 text-[0.7rem]">
          You&apos;re writing as
        </p>
        <p className="text-sm font-medium">{name || email}</p>
        <p className="text-muted-foreground text-xs">{email}</p>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label className="block">Category</Label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={active}
                className={cn(
                  "h-9 rounded-lg border px-3 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-foreground/30 hover:bg-muted/50",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subject */}
      <div className="space-y-1.5">
        <div className="flex items-end justify-between">
          <Label htmlFor="subject">Subject</Label>
          <span
            className={cn(
              "text-[0.7rem] tabular-nums",
              subjectOverLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {subject.length}/{SUBJECT_MAX}
          </span>
        </div>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX + 40}
          placeholder="A short summary"
          required
          className="h-10"
        />
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <div className="flex items-end justify-between">
          <Label htmlFor="body">Message</Label>
          <span
            className={cn(
              "text-[0.7rem] tabular-nums",
              bodyOverLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {body.length}/{BODY_MAX}
          </span>
        </div>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX + 200}
          rows={8}
          placeholder="Tell us what you ran into, what you'd like to see, or what's on your mind."
          required
          className="leading-relaxed"
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-destructive text-sm"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <p className="text-muted-foreground hidden text-xs sm:block">
          Up to 5 messages per day
        </p>
        <Button
          type="submit"
          disabled={
            loading ||
            !subject.trim() ||
            !body.trim() ||
            subjectOverLimit ||
            bodyOverLimit
          }
          className="h-10 gap-2 px-5"
        >
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {loading ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
