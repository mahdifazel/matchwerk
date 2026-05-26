import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ announcements });
}

const announcementSchema = z.object({
  message: z.string().trim().min(1).max(500),
  level: z.enum(["info", "warning"]),
  active: z.boolean(),
});

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = announcementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid announcement." },
      { status: 400 },
    );
  }
  const created = await prisma.announcement.create({ data: parsed.data });
  await logAdminAction(admin, "announcement.create", { metadata: { id: created.id } });
  return NextResponse.json({ ok: true });
}
