import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { getRateLimits, setRateLimits } from "@/lib/limits";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json({ limits: await getRateLimits() });
}

const schema = z.object({
  researchPerHour: z.number().int().min(0).max(10000),
  cvPerDay: z.number().int().min(0).max(10000),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid limits." }, { status: 400 });
  }
  await setRateLimits(parsed.data);
  await logAdminAction(admin, "limits.update", { metadata: parsed.data });
  return NextResponse.json({ ok: true });
}
