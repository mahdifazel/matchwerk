import { prisma } from "@/lib/prisma";

/**
 * One-time migration of legacy single-tenant rows to the very first account.
 *
 * Before multi-tenancy, Profile/Settings/Job/SourceCredential rows had no owner
 * (userId = null). The first user to register or sign in claims them; every
 * subsequent user is a no-op. Guarded by the user count so only the first
 * account can ever claim the orphans.
 */
export async function claimOrphanDataForFirstUser(
  userId: string,
): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount !== 1) return;

  await prisma.$transaction([
    prisma.profile.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.settings.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.job.updateMany({ where: { userId: null }, data: { userId } }),
    prisma.sourceCredential.updateMany({
      where: { userId: null },
      data: { userId },
    }),
  ]);
}
