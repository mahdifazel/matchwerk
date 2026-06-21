import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { getScoringLimits, setScoringLimits, SCORING_BOUNDS } from "@/lib/limits";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json({ scoring: await getScoringLimits() });
}

const schema = z.object({
  maxScoreCandidates: z
    .number()
    .int()
    .min(SCORING_BOUNDS.min)
    .max(SCORING_BOUNDS.max),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid scoring settings." }, { status: 400 });
  }
  await setScoringLimits(parsed.data);
  await logAdminAction(admin, "scoring.update", { metadata: parsed.data });
  return NextResponse.json({ ok: true });
}
