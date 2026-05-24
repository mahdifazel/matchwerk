import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Token prices and limits. Balances move in 0.5 increments (hence Float). */
export const TOKEN = {
  SIGNUP_GRANT: 150,
  CV_PARSE: 25,
  PER_JOB_DISPLAY: 0.5,
  PER_JOB_RATING: 1,
  MAX_SEARCH_JOBS: 150,
  MAX_BOARD_JOBS: 70,
} as const;

export type TokenReason = "signup_grant" | "cv_parse" | "research";

export type TokenAccount = { balance: number; debt: number };

export type ChargeResult = TokenAccount & {
  /** Amount requested (always the full price, even if it dipped into debt). */
  charged: number;
  /** Portion of `charged` that exceeded the balance and became debt. */
  debtAdded: number;
};

/**
 * Returns the user's token account, applying the one-time signup grant first if
 * it hasn't been granted yet. Lazy so accounts created before billing existed
 * still receive their 150 on first access.
 */
export async function getTokenAccount(userId: string): Promise<TokenAccount> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenBalance: true, tokenDebt: true, tokensGrantedAt: true },
  });
  if (!user) return { balance: 0, debt: 0 };
  if (user.tokensGrantedAt) {
    return { balance: user.tokenBalance, debt: user.tokenDebt };
  }
  return applySignupGrant(userId);
}

async function applySignupGrant(userId: string): Promise<TokenAccount> {
  return prisma.$transaction(async (tx) => {
    // Atomic claim: only the first caller flips tokensGrantedAt from null.
    const claimed = await tx.user.updateMany({
      where: { id: userId, tokensGrantedAt: null },
      data: {
        tokensGrantedAt: new Date(),
        tokenBalance: { increment: TOKEN.SIGNUP_GRANT },
      },
    });
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { tokenBalance: true, tokenDebt: true },
    });
    if (!user) return { balance: 0, debt: 0 };
    if (claimed.count > 0) {
      await tx.tokenLedger.create({
        data: {
          userId,
          delta: TOKEN.SIGNUP_GRANT,
          balanceAfter: user.tokenBalance,
          reason: "signup_grant",
        },
      });
    }
    return { balance: user.tokenBalance, debt: user.tokenDebt };
  });
}

/**
 * Deducts `amount` tokens. The run always proceeds: the balance floors at 0 and
 * any overspend is recorded as debt (so the UI never shows a negative balance).
 * Records one ledger row per charge.
 */
export async function charge(
  userId: string,
  amount: number,
  reason: TokenReason,
  metadata?: Prisma.InputJsonValue,
): Promise<ChargeResult> {
  // Make sure the signup grant is in place before the first charge.
  await getTokenAccount(userId);

  if (amount <= 0) {
    const acct = await getTokenAccount(userId);
    return { ...acct, charged: 0, debtAdded: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { tokenBalance: true, tokenDebt: true },
    });
    if (!user) throw new Error("User not found for token charge.");

    const fromBalance = Math.min(user.tokenBalance, amount);
    const debtAdded = amount - fromBalance;
    const newBalance = user.tokenBalance - fromBalance; // == max(0, balance - amount)
    const newDebt = user.tokenDebt + debtAdded;

    await tx.user.update({
      where: { id: userId },
      data: { tokenBalance: newBalance, tokenDebt: newDebt },
    });
    await tx.tokenLedger.create({
      data: {
        userId,
        delta: -amount,
        balanceAfter: newBalance,
        reason,
        metadata,
      },
    });
    return { balance: newBalance, debt: newDebt, charged: amount, debtAdded };
  });
}

/** Adds tokens to the account, paying down outstanding debt first. */
export async function grant(
  userId: string,
  amount: number,
  reason: TokenReason,
): Promise<TokenAccount> {
  await getTokenAccount(userId);
  if (amount <= 0) return getTokenAccount(userId);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { tokenBalance: true, tokenDebt: true },
    });
    if (!user) throw new Error("User not found for token grant.");

    const debtPaid = Math.min(user.tokenDebt, amount);
    const newDebt = user.tokenDebt - debtPaid;
    const newBalance = user.tokenBalance + (amount - debtPaid);

    await tx.user.update({
      where: { id: userId },
      data: { tokenBalance: newBalance, tokenDebt: newDebt },
    });
    await tx.tokenLedger.create({
      data: { userId, delta: amount, balanceAfter: newBalance, reason },
    });
    return { balance: newBalance, debt: newDebt };
  });
}
