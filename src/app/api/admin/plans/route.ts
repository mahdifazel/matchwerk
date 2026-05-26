import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { createPlan, listAllPlans, planExists } from "@/lib/plans-repo";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json({ plans: await listAllPlans() });
}

const fields = {
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160),
  priceEur: z.number().min(0).max(100000),
  tokens: z.number().int().min(0).max(10_000_000),
  durationMonths: z.number().int().min(0).max(120),
  recommended: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
};

const createSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and dashes."),
  ...fields,
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid plan." },
      { status: 400 },
    );
  }
  const { id, ...data } = parsed.data;
  if (await planExists(id)) {
    return NextResponse.json({ error: "A plan with that id already exists." }, { status: 409 });
  }
  await createPlan(id, data);
  await logAdminAction(admin, "plan.create", { metadata: { id, ...data } });
  return NextResponse.json({ ok: true });
}
