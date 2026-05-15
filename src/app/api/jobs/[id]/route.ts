import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  action: z.enum(["star", "unstar", "apply", "delete"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid action." },
      { status: 400 },
    );
  }

  const existing = await prisma.job.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const data: { status: JobStatus; appliedAt?: Date | null } = (() => {
    switch (parsed.data.action) {
      case "star":
        return { status: "STARRED" };
      case "unstar":
        return { status: "NEW" };
      case "apply":
        return { status: "APPLIED", appliedAt: new Date() };
      case "delete":
        return { status: "DELETED" };
    }
  })();

  const job = await prisma.job.update({ where: { id }, data });
  return NextResponse.json({ job });
}
