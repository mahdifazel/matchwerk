import { NextResponse } from "next/server";
import { getSuperAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

/** Revoke admin access — demotes an ADMIN back to a regular USER. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Super Admins only." }, { status: 403 });
  }

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json(
      { error: "You can't change your own role." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "The Super Admin role can't be revoked here." },
      { status: 403 },
    );
  }
  if (target.role !== "ADMIN") {
    return NextResponse.json({ error: "That account isn't an admin." }, { status: 400 });
  }

  await prisma.user.update({ where: { id }, data: { role: "USER" } });
  await logAdminAction(admin, "admin.revoke", { targetId: target.id, targetEmail: target.email });

  return NextResponse.json({ ok: true });
}
