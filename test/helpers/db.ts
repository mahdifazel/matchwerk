import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Wipe the tables the payment tests touch. TRUNCATE … CASCADE also clears the
 * User-dependent tables (Account, Session, Profile, Settings, Job, TokenLedger).
 * Call in `beforeEach` so every test starts from a clean slate.
 */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "TokenLedger", "WebhookEvent", "Plan", "User" RESTART IDENTITY CASCADE`,
  );
}

let seq = 0;

/**
 * Create a user. Defaults to `tokensGrantedAt = now()` so `getTokenAccount`
 * won't add the 150-token signup grant unless a test explicitly opts in by
 * passing `{ tokensGrantedAt: null }`.
 */
export async function seedUser(
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  return prisma.user.create({
    data: {
      email: `user-${Date.now()}-${seq++}@test.dev`,
      tokenBalance: 0,
      tokenDebt: 0,
      tokensGrantedAt: new Date(),
      ...overrides,
    },
  });
}

/** Create a token plan (the source of truth for purchase credit amounts). */
export async function seedPlan(
  overrides: Partial<Prisma.PlanUncheckedCreateInput> = {},
) {
  return prisma.plan.create({
    data: {
      id: "test-plan",
      name: "Test Plan",
      priceEur: 9.99,
      tokens: 500,
      durationMonths: 1,
      ...overrides,
    },
  });
}

/** Count ledger rows for a user, optionally filtered by reason. */
export function ledgerCount(userId: string, reason?: string) {
  return prisma.tokenLedger.count({
    where: { userId, ...(reason ? { reason } : {}) },
  });
}
