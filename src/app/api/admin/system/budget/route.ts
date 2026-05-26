import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { getBudgetConfig, setBudgetConfig } from "@/lib/budget";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json({ config: await getBudgetConfig() });
}

const schema = z.object({
  tokensPerDay: z.number().min(0).max(100_000_000),
  aiRequestsPerDay: z.number().int().min(0).max(10_000_000),
  aiErrorsPerDay: z.number().int().min(0).max(10_000_000),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid thresholds." }, { status: 400 });
  }
  await setBudgetConfig(parsed.data);
  await logAdminAction(admin, "budget.update", { metadata: parsed.data });
  return NextResponse.json({ ok: true });
}
