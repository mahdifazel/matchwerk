import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Platform analytics aggregation, shared by the JSON dashboard
// endpoint and the PDF report.

const USAGE_REASONS = ["cv_parse", "research"];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

export async function getAnalytics() {
  const now = new Date();
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 29);
  since30.setUTCHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeUsers,
    jobsStored,
    ledger30,
    purchases,
    flowByReason,
    jobsBySourceRaw,
    topUsersRaw,
    providerRaw,
    recentErrors,
    signups30,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { disabledAt: null } }),
    prisma.job.count(),
    prisma.tokenLedger.findMany({
      where: { createdAt: { gte: since30 } },
      select: { delta: true, reason: true, metadata: true, createdAt: true },
    }),
    prisma.tokenLedger.findMany({
      where: { reason: "purchase" },
      select: { delta: true, metadata: true },
    }),
    prisma.tokenLedger.groupBy({ by: ["reason"], _sum: { delta: true } }),
    prisma.job.groupBy({ by: ["source"], _count: true }),
    prisma.tokenLedger.groupBy({
      by: ["userId"],
      where: { reason: { in: USAGE_REASONS } },
      _sum: { delta: true },
      orderBy: { _sum: { delta: "asc" } },
      take: 5,
    }),
    prisma.requestLog.groupBy({ by: ["provider", "ok"], _count: { _all: true } }),
    prisma.requestLog.findMany({
      where: { ok: false },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, provider: true, operation: true, error: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: since30 } },
      select: { createdAt: true },
    }),
  ]);

  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(dayKey(d));
  }
  const daily = new Map(
    days.map((date) => [date, { date, searches: 0, tokensConsumed: 0, revenue: 0, signups: 0 }]),
  );
  let tokensConsumed30d = 0;
  let searches30d = 0;
  let revenue30d = 0;
  for (const row of ledger30) {
    const bucket = daily.get(dayKey(row.createdAt));
    if (!bucket) continue;
    if (row.reason === "research") {
      bucket.searches += 1;
      searches30d += 1;
    }
    if (USAGE_REASONS.includes(row.reason)) {
      const used = Math.abs(row.delta);
      bucket.tokensConsumed += used;
      tokensConsumed30d += used;
    }
    if (row.reason === "purchase") {
      const price = (row.metadata as { priceEur?: number } | null)?.priceEur ?? 0;
      bucket.revenue += price;
      revenue30d += price;
    }
  }
  for (const u of signups30) {
    const bucket = daily.get(dayKey(u.createdAt));
    if (bucket) bucket.signups += 1;
  }

  let revenueAllTime = 0;
  let tokensSold = 0;
  for (const p of purchases) {
    tokensSold += p.delta;
    revenueAllTime += (p.metadata as { priceEur?: number } | null)?.priceEur ?? 0;
  }

  const topUserIds = topUsersRaw.map((t) => t.userId);
  const topUserRows = await prisma.user.findMany({
    where: { id: { in: topUserIds } },
    select: { id: true, email: true, name: true },
  });
  const topUserMap = new Map(topUserRows.map((u) => [u.id, u]));
  const topUsers = topUsersRaw.map((t) => ({
    id: t.userId,
    email: topUserMap.get(t.userId)?.email ?? "—",
    name: topUserMap.get(t.userId)?.name ?? null,
    tokensConsumed: Math.abs(t._sum.delta ?? 0),
  }));

  const providerAgg = new Map<string, { ok: number; errors: number }>();
  for (const r of providerRaw) {
    const key = r.provider ?? "unknown";
    const entry = providerAgg.get(key) ?? { ok: 0, errors: 0 };
    if (r.ok) entry.ok += r._count._all;
    else entry.errors += r._count._all;
    providerAgg.set(key, entry);
  }
  const aiProviders = [...providerAgg.entries()].map(([provider, v]) => ({
    provider,
    ok: v.ok,
    errors: v.errors,
    total: v.ok + v.errors,
  }));

  return {
    kpis: {
      totalUsers,
      activeUsers,
      newUsers30d: signups30.length,
      jobsStored,
      revenueAllTime,
      revenue30d,
      tokensSold,
      tokensConsumed30d,
      searches30d,
    },
    daily: days.map((d) => daily.get(d)!),
    tokenFlowByReason: flowByReason
      .map((r) => ({ reason: r.reason, delta: r._sum.delta ?? 0 }))
      .sort((a, b) => a.delta - b.delta),
    jobsBySource: jobsBySourceRaw
      .map((j) => ({ source: j.source, count: j._count }))
      .sort((a, b) => b.count - a.count),
    topUsers,
    aiProviders: aiProviders.sort((a, b) => b.total - a.total),
    recentErrors,
  };
}
