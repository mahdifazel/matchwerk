"use client";

import { UserPlus } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/generated/prisma/enums";

type Admin = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  disabled: boolean;
  isSelf: boolean;
};

export function RolesManager() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/admins")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setAdmins(d.admins ?? []))
      .catch(() => toast.error("Could not load admins."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function promote() {
    if (!email.trim()) return;
    setBusy(true);
    const res = await fetch("/api/admin/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not add admin.");
      return;
    }
    setEmail("");
    toast.success("Admin added.");
    load();
  }

  async function revoke(admin: Admin) {
    const res = await fetch(`/api/admin/admins/${admin.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(d?.error ?? "Could not revoke admin.");
      return;
    }
    toast.success(`Revoked admin from ${admin.email}.`);
    load();
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Role Management"
        description="Grant or revoke admin access. Admins can do everything except manage other admins. That's reserved for Super Admins."
      />

      <div className="border-border/60 bg-card rounded-2xl border p-4">
        <Label>Add an admin by email</Label>
        <p className="text-muted-foreground mb-3 mt-1 text-xs">
          The person must already have a registered account.
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className="h-9 max-w-sm"
            onKeyDown={(e) => e.key === "Enter" && promote()}
          />
          <Button size="sm" onClick={promote} disabled={busy}>
            <UserPlus />
            Add admin
          </Button>
        </div>
      </div>

      <div className="border-border/60 bg-card overflow-hidden rounded-2xl border">
        {loading ? (
          <div className="divide-border/60 divide-y">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-border/60 divide-y">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{a.name || a.email}</span>
                  <span className="text-muted-foreground block truncate text-xs">{a.email}</span>
                </div>
                <div className="flex items-center gap-3">
                  {a.role === "SUPER_ADMIN" ? (
                    <Badge>Super Admin</Badge>
                  ) : (
                    <Badge variant="secondary">Admin</Badge>
                  )}
                  {a.role === "ADMIN" && !a.isSelf && (
                    <Button variant="destructive" size="sm" onClick={() => revoke(a)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium">{children}</div>;
}
