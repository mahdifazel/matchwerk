import { auth } from "@/auth";
import {
  ALL_JOB_TYPES,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DEFAULT_JOB_TITLES,
} from "@/lib/constants";
import { readImpersonation } from "@/lib/impersonation";
import { prisma } from "@/lib/prisma";

/**
 * If a valid impersonation is active for `realId` (an admin acting as another
 * user), returns the target's id; otherwise null. The cookie alone is not
 * enough: the genuine JWT session must belong to an admin matching `adminId`.
 */
async function impersonatedTargetId(realId: string): Promise<string | null> {
  const imp = await readImpersonation();
  if (!imp || imp.adminId !== realId) return null;
  const realUser = await prisma.user.findUnique({
    where: { id: realId },
    select: { role: true, disabledAt: true },
  });
  if (!realUser || realUser.disabledAt) return null;
  if (realUser.role !== "ADMIN" && realUser.role !== "SUPER_ADMIN") return null;
  const target = await prisma.user.findUnique({
    where: { id: imp.targetId },
    select: { id: true },
  });
  return target ? target.id : null;
}

/**
 * The id of the signed-in user, or null. API route handlers use this to scope
 * every query; pages are gated by middleware. Returns null when unauthenticated
 * OR when the account has been deactivated, so a disabled user is treated as
 * unauthenticated everywhere (one indexed PK lookup per call).
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  // Impersonation: act as the target user (admin is the real actor).
  const target = await impersonatedTargetId(id);
  if (target) return target;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { disabledAt: true },
  });
  if (!user || user.disabledAt) return null;
  return id;
}

/**
 * The signed-in user's id, role, and key fields — for admin guards that need to
 * authorize by role. Returns null when unauthenticated or deactivated.
 */
export async function getSessionUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  // While impersonating, resolve to the target user — so admin guards treat the
  // actor as that user (you must exit impersonation to use admin areas).
  const target = await impersonatedTargetId(id);
  const effectiveId = target ?? id;
  const user = await prisma.user.findUnique({
    where: { id: effectiveId },
    select: { id: true, email: true, name: true, role: true, disabledAt: true },
  });
  if (!user) return null;
  if (!target && user.disabledAt) return null;
  return user;
}

/** The user's Settings, created with defaults on first access. */
export async function getSettings(userId: string) {
  return prisma.settings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      jobTitles: DEFAULT_JOB_TITLES,
      defaultLocations: ALL_LOCATION_IDS,
      defaultSeniority: ALL_SENIORITY,
      defaultJobTypes: ALL_JOB_TYPES,
      defaultSources: ALL_SOURCE_IDS,
    },
  });
}

/** The user's parsed CV Profile, or null if no CV has been uploaded yet. */
export async function getProfile(userId: string) {
  return prisma.profile.findUnique({ where: { userId } });
}
