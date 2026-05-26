"use client";

import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatusBadge, TableCard } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { UserRole } from "@/generated/prisma/enums";
import { formatTokens } from "@/lib/use-token-balance";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  disabled: boolean;
  tokenBalance: number;
  tokenDebt: number;
  jobCount: number;
  createdAt: string;
};

const ROLE_FILTERS = [
  { id: "", label: "All" },
  { id: "USER", label: "Users" },
  { id: "ADMIN", label: "Admins" },
] as const;

const STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "active", label: "Active" },
  { id: "disabled", label: "Deactivated" },
] as const;

const COLS = "sm:grid-cols-[1.6fr_0.7fr_0.7fr_0.8fr_0.5fr]";

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      params.set("page", String(page));
      fetch(`/api/admin/users?${params}`)
        .then((r) => r.json())
        .then((d) => {
          setRows(d.users ?? []);
          setTotal(d.total ?? 0);
          setPageSize(d.pageSize ?? 25);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, role, status, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function exportCsv() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    window.open(`/api/admin/users/export?${params}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="User Management"
        description={`${total.toLocaleString()} account${total === 1 ? "" : "s"}. Search, filter, and open a user to manage tokens, status, and history.`}
      >
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </AdminPageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email…"
            className="h-9 pl-9"
          />
        </div>
        <FilterGroup
          options={ROLE_FILTERS}
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
        />
        <FilterGroup
          options={STATUS_FILTERS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </div>

      <TableCard>
        <div
          className={cn(
            "text-muted-foreground bg-muted/40 hidden gap-3 px-4 py-2.5 text-xs font-medium sm:grid",
            COLS,
          )}
        >
          <span>User</span>
          <span>Role</span>
          <span>Status</span>
          <span className="text-right">Balance</span>
          <span className="text-right">Jobs</span>
        </div>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">No users match.</p>
        ) : (
          rows.map((u) => (
            <Link
              key={u.id}
              href={`/admin/users/${u.id}`}
              className={cn(
                "hover:bg-muted/40 grid grid-cols-1 gap-1 px-4 py-3 text-sm transition-colors sm:items-center sm:gap-3",
                COLS,
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{u.name || "—"}</span>
                <span className="text-muted-foreground block truncate text-xs">{u.email}</span>
              </span>
              <span>
                <RoleBadge role={u.role} />
              </span>
              <span>
                {u.disabled ? (
                  <StatusBadge tone="error">Deactivated</StatusBadge>
                ) : (
                  <StatusBadge tone="ok">Active</StatusBadge>
                )}
              </span>
              <span className="tabular-nums sm:text-right">
                {formatTokens(u.tokenBalance)}
                {u.tokenDebt > 0 && (
                  <span className="text-destructive ml-1 text-xs">(−{formatTokens(u.tokenDebt)})</span>
                )}
              </span>
              <span className="text-muted-foreground tabular-nums sm:text-right">{u.jobCount}</span>
            </Link>
          ))
        )}
      </TableCard>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft />
            Prev
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterGroup<T extends { id: string; label: string }>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="border-border/60 bg-card inline-flex items-center rounded-lg border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  if (role === "SUPER_ADMIN") return <Badge>Super Admin</Badge>;
  if (role === "ADMIN") return <Badge variant="secondary">Admin</Badge>;
  return <span className="text-muted-foreground text-xs">User</span>;
}
