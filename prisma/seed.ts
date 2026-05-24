import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Multi-tenant app: there is no global singleton to seed. Each user's Settings
// row is created on first access (see getSettings(userId) in src/lib/repo.ts),
// and their Profile is created when they upload a CV. Nothing to seed.
async function main() {
  console.log(
    "Nothing to seed — Settings/Profile are created per-user on first use.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
