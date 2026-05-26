import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  message: z.string().trim().min(1).max(500),
  level: z.enum(["info", "warning"]),
  active: z.boolean(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid announcement." },
      { status: 400 },
    );
  }
  const updated = await prisma.announcement
    .update({ where: { id }, data: parsed.data })
    .catch(() => null);
  if (!updated) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await logAdminAction(admin, "announcement.update", { metadata: { id } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  await prisma.announcement.delete({ where: { id } }).catch(() => null);
  await logAdminAction(admin, "announcement.delete", { metadata: { id } });
  return NextResponse.json({ ok: true });
}
