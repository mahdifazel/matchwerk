import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { adminAdjustTokens } from "@/lib/tokens";

const schema = z.object({
  // Positive grants, negative deducts. 0.5 increments allowed.
  delta: z.number().refine((n) => n !== 0 && Number.isFinite(n), "Enter a non-zero amount."),
  note: z.string().trim().max(280).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Regular admins may only adjust plain users' balances.
  if (admin.role !== "SUPER_ADMIN" && target.role !== "USER") {
    return NextResponse.json(
      { error: "Only a Super Admin can adjust admin balances." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const account = await adminAdjustTokens({
    userId: id,
    delta: parsed.data.delta,
    actorId: admin.id,
    note: parsed.data.note,
  });

  await logAdminAction(admin, parsed.data.delta > 0 ? "tokens.grant" : "tokens.deduct", {
    targetId: target.id,
    targetEmail: target.email,
    metadata: { delta: parsed.data.delta, note: parsed.data.note ?? null },
  });

  return NextResponse.json({ ok: true, ...account });
}
