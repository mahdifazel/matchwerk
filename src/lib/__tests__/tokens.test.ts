import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  adminAdjustTokens,
  charge,
  creditCheckoutSession,
  getTokenAccount,
  grant,
  reverseCheckoutTokens,
  TOKEN,
} from "@/lib/tokens";

import { ledgerCount, resetDb, seedPlan, seedUser } from "@test/helpers/db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("getTokenAccount — signup grant", () => {
  it("applies the 150-token grant exactly once", async () => {
    const user = await seedUser({ tokensGrantedAt: null, tokenBalance: 0 });

    const first = await getTokenAccount(user.id);
    expect(first.balance).toBe(TOKEN.SIGNUP_GRANT);
    expect(await ledgerCount(user.id, "signup_grant")).toBe(1);

    const second = await getTokenAccount(user.id);
    expect(second.balance).toBe(TOKEN.SIGNUP_GRANT);
    expect(await ledgerCount(user.id, "signup_grant")).toBe(1);
  });

  it("returns {0,0} for an unknown user", async () => {
    expect(await getTokenAccount("does-not-exist")).toEqual({ balance: 0, debt: 0 });
  });
});

describe("creditCheckoutSession — purchase crediting", () => {
  it("credits once and is a no-op on a repeat with the same session id", async () => {
    const user = await seedUser({ tokenBalance: 10 });
    await seedPlan({ id: "plus", tokens: 500, priceEur: 19.99 });
    const sessionId = "cs_test_123";

    const first = await creditCheckoutSession({
      userId: user.id,
      planId: "plus",
      stripeSessionId: sessionId,
    });
    expect(first.credited).toBe(true);
    expect(first.tokens).toBe(500);
    expect(first.balance).toBe(510);

    const repeat = await creditCheckoutSession({
      userId: user.id,
      planId: "plus",
      stripeSessionId: sessionId,
    });
    expect(repeat.credited).toBe(false);
    expect(repeat.balance).toBe(510);

    expect(await ledgerCount(user.id, "purchase")).toBe(1);
    expect((await getTokenAccount(user.id)).balance).toBe(510);
  });

  it("credits the plan's token amount (server source of truth)", async () => {
    const user = await seedUser({ tokenBalance: 0 });
    await seedPlan({ id: "pro", tokens: 1200 });

    const res = await creditCheckoutSession({
      userId: user.id,
      planId: "pro",
      stripeSessionId: "cs_pro",
    });
    expect(res.tokens).toBe(1200);
    expect((await getTokenAccount(user.id)).balance).toBe(1200);
  });

  it("pays down debt before growing the balance", async () => {
    const user = await seedUser({ tokenBalance: 0, tokenDebt: 100 });
    await seedPlan({ id: "plus", tokens: 500 });

    await creditCheckoutSession({ userId: user.id, planId: "plus", stripeSessionId: "cs_debt" });

    const acct = await getTokenAccount(user.id);
    expect(acct.debt).toBe(0);
    expect(acct.balance).toBe(400);
  });

  it("throws on an unknown plan", async () => {
    const user = await seedUser();
    await expect(
      creditCheckoutSession({ userId: user.id, planId: "ghost", stripeSessionId: "cs_ghost" }),
    ).rejects.toThrow();
  });
});

describe("reverseCheckoutTokens — refund", () => {
  it("reverses once; a repeat is a no-op", async () => {
    const user = await seedUser({ tokenBalance: 500 });
    const sessionId = "cs_ref_1";

    const first = await reverseCheckoutTokens({
      userId: user.id,
      stripeSessionId: sessionId,
      tokens: 500,
    });
    expect(first.reversed).toBe(true);
    expect(first.balance).toBe(0);

    const repeat = await reverseCheckoutTokens({
      userId: user.id,
      stripeSessionId: sessionId,
      tokens: 500,
    });
    expect(repeat.reversed).toBe(false);
    expect(await ledgerCount(user.id, "refund")).toBe(1);
  });

  it("records already-spent tokens as debt when balance < tokens", async () => {
    const user = await seedUser({ tokenBalance: 200 });

    await reverseCheckoutTokens({ userId: user.id, stripeSessionId: "cs_ref_2", tokens: 500 });

    const acct = await getTokenAccount(user.id);
    expect(acct.balance).toBe(0);
    expect(acct.debt).toBe(300);
  });
});

describe("charge", () => {
  it("floors balance at 0 and records overspend as debt", async () => {
    const user = await seedUser({ tokenBalance: 50 });

    const res = await charge(user.id, 100, "research");
    expect(res.charged).toBe(100);
    expect(res.debtAdded).toBe(50);
    expect(res.balance).toBe(0);
    expect(res.debt).toBe(50);
  });

  it("is a no-op (no ledger row) when amount <= 0", async () => {
    const user = await seedUser({ tokenBalance: 50 });
    const before = await ledgerCount(user.id);

    const res = await charge(user.id, 0, "research");
    expect(res.charged).toBe(0);
    expect(await ledgerCount(user.id)).toBe(before);
  });
});

describe("grant", () => {
  it("pays down debt before adding to balance", async () => {
    const user = await seedUser({ tokenBalance: 0, tokenDebt: 30 });

    const res = await grant(user.id, 100, "admin_grant");
    expect(res.debt).toBe(0);
    expect(res.balance).toBe(70);
  });
});

describe("adminAdjustTokens", () => {
  it("positive delta grants (debt first) and tags the ledger admin_grant", async () => {
    const user = await seedUser({ tokenBalance: 0, tokenDebt: 20 });

    const res = await adminAdjustTokens({
      userId: user.id,
      delta: 50,
      actorId: "admin-1",
      note: "comp",
    });
    expect(res.debt).toBe(0);
    expect(res.balance).toBe(30);
    expect(await ledgerCount(user.id, "admin_grant")).toBe(1);
  });

  it("negative delta deducts, flooring at 0 into debt, tagged admin_deduct", async () => {
    const user = await seedUser({ tokenBalance: 10 });

    const res = await adminAdjustTokens({ userId: user.id, delta: -40, actorId: "admin-1" });
    expect(res.balance).toBe(0);
    expect(res.debt).toBe(30);
    expect(await ledgerCount(user.id, "admin_deduct")).toBe(1);
  });
});
