import { NextResponse } from "next/server";
import { z } from "zod";
import { getSuperAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await getSuperAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Super Admins only." }, { status: 403 });
  }

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      disabledAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    admins: admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      image: a.image,
      role: a.role,
      disabled: a.disabledAt != null,
      createdAt: a.createdAt,
      isSelf: a.id === admin.id,
    })),
  });
}

const promoteSchema = z.object({ email: z.string().trim().email() });

export async function POST(request: Request) {
  const admin = await getSuperAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Super Admins only." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = promoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "No account with that email. Ask them to register first." },
      { status: 404 },
    );
  }
  if (user.role !== "USER") {
    return NextResponse.json(
      { error: "That account is already an admin." },
      { status: 409 },
    );
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  await logAdminAction(admin, "admin.grant", { targetId: user.id, targetEmail: user.email });

  return NextResponse.json({ ok: true });
}
