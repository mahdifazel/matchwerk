import type { Plan } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

// SERVER-ONLY. DB access for token purchase plans (admin-editable).

export type AdminPlan = Plan & { sortOrder: number; active: boolean };

type PlanRow = {
  id: string;
  name: string;
  tagline: string;
  priceEur: number;
  tokens: number;
  durationMonths: number;
  recommended: boolean;
  sortOrder: number;
  active: boolean;
};

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    priceEur: row.priceEur,
    tokens: row.tokens,
    durationMonths: row.durationMonths,
    recommended: row.recommended,
  };
}

/** Active plans for the public pricing page, in display order. */
export async function getActivePlans(): Promise<Plan[]> {
  const rows = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toPlan);
}

/** A single plan by id, or null. Used by checkout + token crediting. */
export async function getPlanById(id: string): Promise<Plan | null> {
  const row = await prisma.plan.findUnique({ where: { id } });
  return row ? toPlan(row) : null;
}

/** All plans (incl. inactive) for the admin editor. */
export async function listAllPlans(): Promise<AdminPlan[]> {
  const rows = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((r) => ({ ...toPlan(r), sortOrder: r.sortOrder, active: r.active }));
}

export type PlanInput = {
  name: string;
  tagline: string;
  priceEur: number;
  tokens: number;
  durationMonths: number;
  recommended: boolean;
  sortOrder: number;
  active: boolean;
};

export async function createPlan(id: string, data: PlanInput): Promise<void> {
  await prisma.plan.create({ data: { id, ...data } });
}

export async function updatePlan(id: string, data: PlanInput): Promise<void> {
  await prisma.plan.update({ where: { id }, data });
}

export async function deletePlan(id: string): Promise<void> {
  await prisma.plan.delete({ where: { id } });
}

export async function planExists(id: string): Promise<boolean> {
  return (await prisma.plan.count({ where: { id } })) > 0;
}
