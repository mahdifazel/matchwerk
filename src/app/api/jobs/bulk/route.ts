import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bulkSchema = z.object({
  action: z.enum(["delete", "unapply"]),
  ids: z.array(z.string()).min(1).max(500),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk request." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "unapply") {
    // Move APPLIED jobs back to NEW. Only acts on currently-APPLIED rows so a
    // mistargeted bulk call can't reset star/new jobs.
    const result = await prisma.job.updateMany({
      where: { id: { in: parsed.data.ids }, status: "APPLIED" },
      data: { status: "NEW", appliedAt: null },
    });
    return NextResponse.json({ count: result.count });
  }

  // "delete" — sets DELETED so the jobs stay excluded on refresh.
  const result = await prisma.job.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { status: "DELETED" },
  });

  return NextResponse.json({ count: result.count });
}
