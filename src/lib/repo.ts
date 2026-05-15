import {
  ALL_JOB_TYPES,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DEFAULT_JOB_TITLES,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";

const SINGLETON = "singleton";

/** The Settings singleton, created with defaults on first access. */
export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: {
      id: SINGLETON,
      jobTitles: DEFAULT_JOB_TITLES,
      defaultLocations: ALL_LOCATION_IDS,
      defaultSeniority: ALL_SENIORITY,
      defaultJobTypes: ALL_JOB_TYPES,
      defaultSources: ALL_SOURCE_IDS,
    },
  });
}

/** The parsed CV Profile singleton, or null if no CV has been uploaded yet. */
export async function getProfile() {
  return prisma.profile.findUnique({ where: { id: SINGLETON } });
}

export const PROFILE_ID = SINGLETON;
export const SETTINGS_ID = SINGLETON;
