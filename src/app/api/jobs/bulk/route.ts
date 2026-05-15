import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bulkSchema = z.object({
  action: z.enum(["delete"]),
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

  // Only "delete" for now — sets DELETED so the jobs stay excluded on refresh.
  const result = await prisma.job.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { status: "DELETED" },
  });

  return NextResponse.json({ count: result.count });
}
