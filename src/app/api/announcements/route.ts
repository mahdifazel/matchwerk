import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";

/** Active announcements within their display window, for the in-app banner. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ announcements: [] });

  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, message: true, level: true },
  });
  return NextResponse.json({ announcements });
}
