import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  ALL_JOB_TYPES,
  ALL_LOCATION_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DEFAULT_JOB_TITLES,
} from "../src/lib/constants";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      jobTitles: DEFAULT_JOB_TITLES,
      defaultLocations: ALL_LOCATION_IDS,
      defaultSeniority: ALL_SENIORITY,
      defaultJobTypes: ALL_JOB_TYPES,
      defaultSources: ALL_SOURCE_IDS,
    },
  });
  console.log("Seeded Settings singleton.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
