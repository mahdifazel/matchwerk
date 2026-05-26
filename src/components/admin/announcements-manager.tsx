"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Level = "info" | "warning";
type Announcement = {
  id: string;
  message: string;
  level: Level;
  active: boolean;
  createdAt: string;
};

export function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/announcements")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(d.announcements ?? []))
      .catch(() => toast.error("Could not load announcements."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Announcements"
        description="Post a banner shown to all signed-in users. Active ones appear at the top of the app and can be dismissed per user."
      />

      <CreateForm onCreated={load} />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No announcements yet.</p>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Row key={a.id} item={a} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function LevelToggle({ value, onChange }: { value: Level; onChange: (l: Level) => void }) {
  return (
    <div className="border-border/60 bg-card inline-flex rounded-lg border p-0.5">
      {(["info", "warning"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            value === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<Level>("info");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!message.trim()) return;
    setBusy(true);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), level, active: true }),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not create.");
      return;
    }
    setMessage("");
    setLevel("info");
    toast.success("Announcement posted.");
    onCreated();
  }

  return (
    <div className="border-border/60 bg-card space-y-3 rounded-2xl border p-4">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write an announcement…"
        rows={2}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LevelToggle value={level} onChange={setLevel} />
        <Button size="sm" onClick={create} disabled={busy || !message.trim()} className="gap-1.5">
          <Plus className="size-4" /> Post
        </Button>
      </div>
    </div>
  );
}

function Row({ item, onChanged }: { item: Announcement; onChanged: () => void }) {
  const [message, setMessage] = useState(item.message);
  const [level, setLevel] = useState<Level>(item.level);
  const [active, setActive] = useState(item.active);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/admin/announcements/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim(), level, active }),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not save.");
      return;
    }
    toast.success("Saved.");
    onChanged();
  }

  async function remove() {
    if (!confirm("Delete this announcement?")) return;
    const res = await fetch(`/api/admin/announcements/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete.");
      return;
    }
    toast.success("Deleted.");
    onChanged();
  }

  return (
    <div className="border-border/60 bg-card space-y-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {active ? <StatusBadge tone="ok">Active</StatusBadge> : <StatusBadge tone="muted">Hidden</StatusBadge>}
          {item.level === "warning" ? (
            <StatusBadge tone="warn">Warning</StatusBadge>
          ) : (
            <StatusBadge tone="accent">Info</StatusBadge>
          )}
        </div>
        <Button variant="destructive" size="sm" onClick={remove}>
          <Trash2 />
        </Button>
      </div>
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LevelToggle value={level} onChange={setLevel} />
          <Button
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            onClick={() => setActive((v) => !v)}
          >
            {active ? "Active" : "Hidden"}
          </Button>
        </div>
        <Button size="sm" onClick={save} disabled={busy}>Save</Button>
      </div>
    </div>
  );
}
