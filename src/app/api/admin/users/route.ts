import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const role = sp.get("role"); // USER | ADMIN | SUPER_ADMIN | null
  const status = sp.get("status"); // active | disabled | null
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (role === "USER" || role === "ADMIN" || role === "SUPER_ADMIN") {
    where.role = role;
  }
  if (status === "active") where.disabledAt = null;
  if (status === "disabled") where.disabledAt = { not: null };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        disabledAt: true,
        tokenBalance: true,
        tokenDebt: true,
        createdAt: true,
        _count: { select: { jobs: true } },
      },
    }),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: u.role,
      disabled: u.disabledAt != null,
      tokenBalance: u.tokenBalance,
      tokenDebt: u.tokenDebt,
      jobCount: u._count.jobs,
      createdAt: u.createdAt,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
