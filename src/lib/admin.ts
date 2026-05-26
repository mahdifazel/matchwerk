import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/repo";

export type AdminUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export function isAdmin(role?: UserRole | null): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export function isSuperAdmin(role?: UserRole | null): boolean {
  return role === "SUPER_ADMIN";
}

// ── Page guards (server components) — redirect home if not allowed ──────────

export async function requireAdminPage(): Promise<AdminUser> {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.role)) redirect("/");
  return user;
}

export async function requireSuperAdminPage(): Promise<AdminUser> {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user.role)) redirect("/");
  return user;
}

// ── API guards — return the admin or null (caller responds 401/403) ─────────

export async function getAdminUser(): Promise<AdminUser | null> {
  const user = await getSessionUser();
  return user && isAdmin(user.role) ? user : null;
}

export async function getSuperAdminUser(): Promise<AdminUser | null> {
  const user = await getSessionUser();
  return user && isSuperAdmin(user.role) ? user : null;
}

// ── Audit trail ─────────────────────────────────────────────────────────────

export async function logAdminAction(
  actor: { id: string; email: string | null },
  action: string,
  opts?: {
    targetId?: string | null;
    targetEmail?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email ?? "—",
      action,
      targetId: opts?.targetId ?? null,
      targetEmail: opts?.targetEmail ?? null,
      metadata: opts?.metadata,
    },
  });
}
