import type { Prisma } from "@/generated/prisma/client";
import { getPlanById } from "@/lib/plans-repo";
import { prisma } from "@/lib/prisma";

/** Token prices and limits. Balances move in 0.5 increments (hence Float). */
export const TOKEN = {
  SIGNUP_GRANT: 300,
  CV_PARSE: 25,
  PER_JOB_DISPLAY: 0.5,
  PER_JOB_RATING: 1,
  MAX_SEARCH_JOBS: 150,
  /** Cap on jobs sent to AI scoring per refresh. The lexical pre-rank picks the
   *  top candidates from the (larger) deduped pool; only these cost rating
   *  tokens. Slightly above MAX_BOARD_JOBS for headroom against low scorers. */
  MAX_SCORE_CANDIDATES: 80,
  MAX_BOARD_JOBS: 70,
} as const;

export type TokenReason =
  | "signup_grant"
  | "cv_parse"
  | "research"
  | "purchase"
  | "admin_grant"
  | "admin_deduct"
  | "refund";

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

export type CreditResult = {
  /** True only on the call that actually credited; false if already credited. */
  credited: boolean;
  /** Tokens this plan grants (returned even when already credited, for messaging). */
  tokens: number;
  /** Resulting balance. */
  balance: number;
};

/**
 * Credits the tokens for a PAID Stripe Checkout session. Idempotent: keyed on the
 * unique `stripeSessionId` column, so the webhook and the success-redirect
 * confirmation can both call this and the tokens land exactly once. Pays down any
 * outstanding debt before growing the balance, like `grant`.
 *
 * The token amount is taken from our own `Plan` records (looked up by
 * `planId`), never from anything Stripe or the client reports.
 */
export async function creditCheckoutSession(params: {
  userId: string;
  planId: string;
  stripeSessionId: string;
}): Promise<CreditResult> {
  const plan = await getPlanById(params.planId);
  if (!plan) {
    throw new Error(`Unknown plan for checkout credit: ${params.planId}`);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const already = await tx.tokenLedger.findUnique({
        where: { stripeSessionId: params.stripeSessionId },
        select: { id: true },
      });
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { tokenBalance: true, tokenDebt: true },
      });
      if (!user) throw new Error("User not found for checkout credit.");
      if (already) {
        return { credited: false, tokens: plan.tokens, balance: user.tokenBalance };
      }

      const debtPaid = Math.min(user.tokenDebt, plan.tokens);
      const newDebt = user.tokenDebt - debtPaid;
      const newBalance = user.tokenBalance + (plan.tokens - debtPaid);

      await tx.user.update({
        where: { id: params.userId },
        data: { tokenBalance: newBalance, tokenDebt: newDebt },
      });
      await tx.tokenLedger.create({
        data: {
          userId: params.userId,
          delta: plan.tokens,
          balanceAfter: newBalance,
          reason: "purchase",
          stripeSessionId: params.stripeSessionId,
          metadata: {
            planId: plan.id,
            planName: plan.name,
            priceEur: plan.priceEur,
            tokens: plan.tokens,
            durationMonths: plan.durationMonths,
          },
        },
      });
      return { credited: true, tokens: plan.tokens, balance: newBalance };
    });
  } catch (e) {
    // A concurrent path inserted the unique stripeSessionId first — already paid.
    if (isUniqueViolation(e)) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { tokenBalance: true },
      });
      return { credited: false, tokens: plan.tokens, balance: user?.tokenBalance ?? 0 };
    }
    throw e;
  }
}

/**
 * Admin manual token adjustment. `delta > 0` grants (paying down debt first like
 * `grant`); `delta < 0` deducts (flooring the balance at 0 and recording any
 * shortfall as debt like `charge`). Writes one ledger row tagged with the actor.
 */
export async function adminAdjustTokens(params: {
  userId: string;
  delta: number;
  actorId: string;
  note?: string;
}): Promise<TokenAccount> {
  await getTokenAccount(params.userId); // ensure the signup grant is applied
  if (params.delta === 0) return getTokenAccount(params.userId);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: params.userId },
      select: { tokenBalance: true, tokenDebt: true },
    });
    if (!user) throw new Error("User not found for token adjustment.");

    let newBalance: number;
    let newDebt: number;
    if (params.delta > 0) {
      const debtPaid = Math.min(user.tokenDebt, params.delta);
      newDebt = user.tokenDebt - debtPaid;
      newBalance = user.tokenBalance + (params.delta - debtPaid);
    } else {
      const amount = -params.delta;
      const fromBalance = Math.min(user.tokenBalance, amount);
      newBalance = user.tokenBalance - fromBalance;
      newDebt = user.tokenDebt + (amount - fromBalance);
    }

    await tx.user.update({
      where: { id: params.userId },
      data: { tokenBalance: newBalance, tokenDebt: newDebt },
    });
    await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        delta: params.delta,
        balanceAfter: newBalance,
        reason: params.delta > 0 ? "admin_grant" : "admin_deduct",
        metadata: { note: params.note ?? null, actorId: params.actorId },
      },
    });
    return { balance: newBalance, debt: newDebt };
  });
}

export type RefundResult = {
  /** True only on the call that actually reversed tokens; false if already done. */
  reversed: boolean;
  /** Tokens removed. */
  tokens: number;
  balance: number;
};

/**
 * Reverses the tokens from a refunded purchase. Idempotent via a derived unique
 * key (`refund:<sessionId>`) so it can't double-deduct. Deducts from balance,
 * flooring at 0 and recording any shortfall (already-spent tokens) as debt.
 */
export async function reverseCheckoutTokens(params: {
  userId: string;
  stripeSessionId: string;
  tokens: number;
  metadata?: Prisma.InputJsonValue;
}): Promise<RefundResult> {
  const refundKey = `refund:${params.stripeSessionId}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const already = await tx.tokenLedger.findUnique({
        where: { stripeSessionId: refundKey },
        select: { id: true },
      });
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { tokenBalance: true, tokenDebt: true },
      });
      if (!user) throw new Error("User not found for refund.");
      if (already) {
        return { reversed: false, tokens: params.tokens, balance: user.tokenBalance };
      }

      const fromBalance = Math.min(user.tokenBalance, params.tokens);
      const newBalance = user.tokenBalance - fromBalance;
      const newDebt = user.tokenDebt + (params.tokens - fromBalance);

      await tx.user.update({
        where: { id: params.userId },
        data: { tokenBalance: newBalance, tokenDebt: newDebt },
      });
      await tx.tokenLedger.create({
        data: {
          userId: params.userId,
          delta: -params.tokens,
          balanceAfter: newBalance,
          reason: "refund",
          stripeSessionId: refundKey,
          metadata: params.metadata,
        },
      });
      return { reversed: true, tokens: params.tokens, balance: newBalance };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { tokenBalance: true },
      });
      return { reversed: false, tokens: params.tokens, balance: user?.tokenBalance ?? 0 };
    }
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}
