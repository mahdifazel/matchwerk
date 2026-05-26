import { getAppSetting, setAppSetting } from "@/lib/platform";
import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Daily budget/cost guardrails. Real € provider billing isn't
// available, so thresholds are on the in-app cost signals: tokens consumed,
// AI request volume, and AI failures (all measured since UTC midnight).

export type BudgetConfig = {
  /** Alert when tokens consumed (CV parse + research) today exceeds this. */
  tokensPerDay: number;
  /** Alert when total AI requests today exceeds this. */
  aiRequestsPerDay: number;
  /** Alert when failed AI requests today exceeds this. */
  aiErrorsPerDay: number;
};

// All 0 = disabled by default; the admin opts in by setting thresholds.
const DEFAULTS: BudgetConfig = { tokensPerDay: 0, aiRequestsPerDay: 0, aiErrorsPerDay: 0 };
const SETTING_KEY = "budget_alerts";

export async function getBudgetConfig(): Promise<BudgetConfig> {
  const v = await getAppSetting<Partial<BudgetConfig>>(SETTING_KEY, DEFAULTS);
  return {
    tokensPerDay: v.tokensPerDay ?? 0,
    aiRequestsPerDay: v.aiRequestsPerDay ?? 0,
    aiErrorsPerDay: v.aiErrorsPerDay ?? 0,
  };
}

export async function setBudgetConfig(v: BudgetConfig): Promise<void> {
  await setAppSetting<BudgetConfig>(SETTING_KEY, v);
}

export type BudgetAlert = {
  key: "tokens" | "requests" | "errors";
  label: string;
  value: number;
  threshold: number;
};

/** Thresholds exceeded today (empty when none configured or none crossed). */
export async function evaluateBudgetAlerts(): Promise<BudgetAlert[]> {
  const cfg = await getBudgetConfig();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const [usageRows, requestsToday, errorsToday] = await Promise.all([
    cfg.tokensPerDay > 0
      ? prisma.tokenLedger.findMany({
          where: { reason: { in: ["cv_parse", "research"] }, createdAt: { gte: start } },
          select: { delta: true },
        })
      : Promise.resolve([]),
    cfg.aiRequestsPerDay > 0
      ? prisma.requestLog.count({ where: { createdAt: { gte: start } } })
      : Promise.resolve(0),
    cfg.aiErrorsPerDay > 0
      ? prisma.requestLog.count({ where: { ok: false, createdAt: { gte: start } } })
      : Promise.resolve(0),
  ]);

  const alerts: BudgetAlert[] = [];
  if (cfg.tokensPerDay > 0) {
    const used = usageRows.reduce((s, r) => s + Math.abs(r.delta), 0);
    if (used > cfg.tokensPerDay) {
      alerts.push({ key: "tokens", label: "Tokens consumed today", value: used, threshold: cfg.tokensPerDay });
    }
  }
  if (cfg.aiRequestsPerDay > 0 && requestsToday > cfg.aiRequestsPerDay) {
    alerts.push({ key: "requests", label: "AI requests today", value: requestsToday, threshold: cfg.aiRequestsPerDay });
  }
  if (cfg.aiErrorsPerDay > 0 && errorsToday > cfg.aiErrorsPerDay) {
    alerts.push({ key: "errors", label: "AI failures today", value: errorsToday, threshold: cfg.aiErrorsPerDay });
  }
  return alerts;
}
