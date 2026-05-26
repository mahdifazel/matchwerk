import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { deletePlan, planExists, updatePlan } from "@/lib/plans-repo";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160),
  priceEur: z.number().min(0).max(100000),
  tokens: z.number().int().min(0).max(10_000_000),
  durationMonths: z.number().int().min(0).max(120),
  recommended: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  if (!(await planExists(id))) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid plan." },
      { status: 400 },
    );
  }
  await updatePlan(id, parsed.data);
  await logAdminAction(admin, "plan.update", { metadata: { id, ...parsed.data } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  if (!(await planExists(id))) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }
  await deletePlan(id);
  await logAdminAction(admin, "plan.delete", { targetId: id, metadata: { id } });
  return NextResponse.json({ ok: true });
}
