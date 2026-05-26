import { NextResponse } from "next/server";
import type { UserRole } from "@/generated/prisma/enums";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { setImpersonation } from "@/lib/impersonation";
import { prisma } from "@/lib/prisma";

function canMutate(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === "SUPER_ADMIN" || targetRole === "USER";
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "You can't impersonate yourself." }, { status: 400 });
  }
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!canMutate(admin.role, target.role)) {
    return NextResponse.json(
      { error: "Only a Super Admin can impersonate admin accounts." },
      { status: 403 },
    );
  }

  await setImpersonation(admin.id, target.id);
  await logAdminAction(admin, "impersonate.start", {
    targetId: target.id,
    targetEmail: target.email,
  });
  return NextResponse.json({ ok: true });
}
