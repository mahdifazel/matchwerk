import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";

const bulkSchema = z.object({
  action: z.enum(["delete", "unapply", "purge"]),
  ids: z.array(z.string()).min(1).max(500),
});

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk request." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "unapply") {
    // Move APPLIED jobs back to NEW. Only acts on the caller's currently-APPLIED
    // rows so a mistargeted bulk call can't reset star/new jobs.
    const result = await prisma.job.updateMany({
      where: { userId, id: { in: parsed.data.ids }, status: "APPLIED" },
      data: { status: "NEW", appliedAt: null },
    });
    return NextResponse.json({ count: result.count });
  }

  if (parsed.data.action === "purge") {
    // "purge" — hard-deletes the rows from the database. Unlike "delete" (which
    // sets DELETED so the job stays hidden but recoverable), this is permanent
    // and cannot be undone. Scoped to the caller's rows.
    const result = await prisma.job.deleteMany({
      where: { userId, id: { in: parsed.data.ids } },
    });
    return NextResponse.json({ count: result.count });
  }

  // "delete" — sets DELETED so the jobs stay excluded on refresh.
  const result = await prisma.job.updateMany({
    where: { userId, id: { in: parsed.data.ids } },
    data: { status: "DELETED" },
  });

  return NextResponse.json({ count: result.count });
}
