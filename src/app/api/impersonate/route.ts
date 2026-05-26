import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logAdminAction } from "@/lib/admin";
import { clearImpersonation, readImpersonation } from "@/lib/impersonation";
import { prisma } from "@/lib/prisma";

/** Status for the impersonation banner. */
export async function GET() {
  const imp = await readImpersonation();
  if (!imp) return NextResponse.json({ active: false });

  // Only report active if the genuine session belongs to the recorded admin.
  const session = await auth();
  if (session?.user?.id !== imp.adminId) {
    return NextResponse.json({ active: false });
  }

  const target = await prisma.user.findUnique({
    where: { id: imp.targetId },
    select: { email: true, name: true },
  });
  return NextResponse.json({
    active: true,
    targetEmail: target?.email ?? "user",
    targetName: target?.name ?? null,
  });
}

/** Stop impersonating — clears the cookie. */
export async function DELETE() {
  const imp = await readImpersonation();
  await clearImpersonation();
  if (imp) {
    const admin = await prisma.user.findUnique({
      where: { id: imp.adminId },
      select: { id: true, email: true },
    });
    if (admin) {
      await logAdminAction(admin, "impersonate.stop", { targetId: imp.targetId });
    }
  }
  return NextResponse.json({ ok: true });
}
