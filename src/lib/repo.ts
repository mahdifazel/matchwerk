import { auth } from "@/auth";
import {
  ALL_JOB_TYPES,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DEFAULT_JOB_TITLES,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";

/**
 * The id of the signed-in user, or null. API route handlers use this to scope
 * every query; pages are gated by middleware. Returns null when unauthenticated
 * so callers can respond with a 401.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
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
