import type { Prisma } from "@/generated/prisma/client";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

/** Escape a CSV cell (RFC 4180: wrap in quotes, double embedded quotes). */
function cell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return new Response("Admins only.", { status: 403 });

  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const role = sp.get("role");
  const status = sp.get("status");

  const where: Prisma.UserWhereInput = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (role === "USER" || role === "ADMIN" || role === "SUPER_ADMIN") where.role = role;
  if (status === "active") where.disabledAt = null;
  if (status === "disabled") where.disabledAt = { not: null };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000,
    select: {
      email: true,
      name: true,
      role: true,
      disabledAt: true,
      tokenBalance: true,
      tokenDebt: true,
      createdAt: true,
      _count: { select: { jobs: true } },
    },
  });

  const header = [
    "email", "name", "role", "status",
    "tokenBalance", "tokenDebt", "jobs", "createdAt",
  ];
  const lines = [header.join(",")];
  for (const u of users) {
    lines.push(
      [
        cell(u.email),
        cell(u.name ?? ""),
        cell(u.role),
        cell(u.disabledAt ? "deactivated" : "active"),
        cell(u.tokenBalance),
        cell(u.tokenDebt),
        cell(u._count.jobs),
        cell(u.createdAt.toISOString()),
      ].join(","),
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="matchwerk-users-${date}.csv"`,
    },
  });
}
