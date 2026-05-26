import { NextResponse } from "next/server";
import type { UserRole } from "@/generated/prisma/enums";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { collectUserData, jsonDownload } from "@/lib/gdpr";
import { prisma } from "@/lib/prisma";

function canMutate(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === "SUPER_ADMIN" || targetRole === "USER";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!canMutate(admin.role, target.role)) {
    return NextResponse.json(
      { error: "Only a Super Admin can export admin accounts." },
      { status: 403 },
    );
  }

  const data = await collectUserData(id);
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await logAdminAction(admin, "user.export", { targetId: id, targetEmail: target.email });

  const date = new Date().toISOString().slice(0, 10);
  return jsonDownload(data, `matchwerk-user-${id}-${date}.json`);
}
