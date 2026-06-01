import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ContactMessageCategory,
  ContactMessageStatus,
} from "@/generated/prisma/enums";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const STATUSES: ContactMessageStatus[] = ["NEW", "READ", "REPLIED"];
const CATEGORIES: ContactMessageCategory[] = [
  "QUESTION",
  "BUG",
  "FEATURE_REQUEST",
  "OTHER",
];

const FORBIDDEN = NextResponse.json(
  { error: "Admin access required." },
  { status: 403 },
);

export async function GET(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return FORBIDDEN;

  const { searchParams } = new URL(request.url);
  const statusRaw = searchParams.get("status");
  const categoryRaw = searchParams.get("category");
  const q = (searchParams.get("q") ?? "").trim();

  const where: Prisma.ContactMessageWhereInput = {};
  if (statusRaw && (STATUSES as string[]).includes(statusRaw)) {
    where.status = statusRaw as ContactMessageStatus;
  }
  if (categoryRaw && (CATEGORIES as string[]).includes(categoryRaw)) {
    where.category = categoryRaw as ContactMessageCategory;
  }
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const messages = await prisma.contactMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ messages });
}
