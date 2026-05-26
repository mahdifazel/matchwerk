"use client";

import { AlertTriangle, Megaphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Announcement = { id: string; message: string; level: "info" | "warning" };

const DISMISS_KEY = "mw-dismissed-announcements";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());

  useEffect(() => {
    fetch("/api/announcements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.announcements ?? []))
      .catch(() => {});
  }, []);

  function dismiss(id: string) {
    const next = [...new Set([...readDismissed(), id])];
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    setDismissed(next);
  }

  const visible = items.filter((a) => !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col">
      {visible.map((a) => {
        const warning = a.level === "warning";
        const Icon = warning ? AlertTriangle : Megaphone;
        return (
          <div
            key={a.id}
            className={cn(
              "flex items-center gap-3 border-b px-5 py-2.5 text-sm sm:px-8",
              warning
                ? "border-destructive/30 bg-destructive/10 text-foreground"
                : "border-accent/40 bg-accent/15 text-foreground",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", warning ? "text-destructive" : "text-foreground/70")}
            />
            <p className="flex-1 leading-snug">{a.message}</p>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              aria-label="Dismiss"
              className="hover:bg-foreground/10 -mr-1 rounded p-1 transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
