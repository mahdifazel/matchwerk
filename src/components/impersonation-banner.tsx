"use client";

import { UserCog } from "lucide-react";
import { useEffect, useState } from "react";

type Status = { active: boolean; targetEmail?: string };

export function ImpersonationBanner() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/impersonate")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status?.active) return null;

  async function exit() {
    await fetch("/api/impersonate", { method: "DELETE" }).catch(() => {});
    window.location.href = "/admin/users";
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/50 bg-amber-500/15 px-5 py-2.5 text-sm sm:px-8">
      <UserCog className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
      <p className="flex-1 leading-snug">
        Viewing as <strong>{status.targetEmail}</strong>. You&apos;re
        impersonating this user.
      </p>
      <button
        type="button"
        onClick={exit}
        className="border-foreground/20 hover:bg-foreground/10 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
      >
        Exit
      </button>
    </div>
  );
}
