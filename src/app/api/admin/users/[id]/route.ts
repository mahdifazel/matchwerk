import { NextResponse } from "next/server";
import { z } from "zod";
import type { UserRole } from "@/generated/prisma/enums";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

/** Super admins may act on anyone; regular admins only on plain USER accounts. */
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
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      disabledAt: true,
      tokenBalance: true,
      tokenDebt: true,
      tokensGrantedAt: true,
      createdAt: true,
      password: true,
      accounts: { select: { provider: true } },
      profile: { select: { fileName: true, parsedAt: true } },
      settings: { select: { jobTitles: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [ledger, jobsByStatus] = await Promise.all([
    prisma.tokenLedger.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        delta: true,
        balanceAfter: true,
        reason: true,
        metadata: true,
        stripeSessionId: true,
        createdAt: true,
      },
    }),
    prisma.job.groupBy({ by: ["status"], where: { userId: id }, _count: true }),
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      disabled: user.disabledAt != null,
      disabledAt: user.disabledAt,
      tokenBalance: user.tokenBalance,
      tokenDebt: user.tokenDebt,
      createdAt: user.createdAt,
      hasPassword: user.password != null,
      providers: user.accounts.map((a) => a.provider),
      cv: user.profile,
      jobTitles: user.settings?.jobTitles ?? [],
    },
    jobs: Object.fromEntries(jobsByStatus.map((g) => [g.status, g._count])),
    ledger,
    canMutate: canMutate(admin.role, user.role),
  });
}

const patchSchema = z.object({
  name: z.string().trim().max(100).optional(),
  disabled: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, disabledAt: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!canMutate(admin.role, target.role)) {
    return NextResponse.json(
      { error: "Only a Super Admin can modify admin accounts." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const data: { name?: string | null; disabledAt?: Date | null } = {};
  if (parsed.data.name !== undefined) {
    data.name = parsed.data.name.length > 0 ? parsed.data.name : null;
  }
  if (parsed.data.disabled !== undefined) {
    if (target.id === admin.id && parsed.data.disabled) {
      return NextResponse.json(
        { error: "You can't deactivate your own account." },
        { status: 400 },
      );
    }
    data.disabledAt = parsed.data.disabled ? new Date() : null;
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, disabledAt: true },
  });

  if (parsed.data.disabled !== undefined) {
    await logAdminAction(admin, parsed.data.disabled ? "user.deactivate" : "user.activate", {
      targetId: target.id,
      targetEmail: target.email,
    });
  }
  if (parsed.data.name !== undefined) {
    await logAdminAction(admin, "user.edit", {
      targetId: target.id,
      targetEmail: target.email,
      metadata: { name: data.name },
    });
  }

  return NextResponse.json({
    ok: true,
    user: { id: updated.id, name: updated.name, disabled: updated.disabledAt != null },
  });
}

// GDPR erasure — hard-deletes the user and all personal data (cascades to
// accounts/sessions/profile/settings/jobs/credentials/ledger).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json(
      { error: "You can't delete your own account here — use Account settings." },
      { status: 400 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!canMutate(admin.role, target.role)) {
    return NextResponse.json(
      { error: "Only a Super Admin can delete admin accounts." },
      { status: 403 },
    );
  }

  await prisma.user.delete({ where: { id } });
  await logAdminAction(admin, "user.erase", {
    targetId: target.id,
    targetEmail: target.email,
  });
  return NextResponse.json({ ok: true });
}
