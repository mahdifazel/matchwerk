import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

const FORBIDDEN = NextResponse.json(
  { error: "Admin access required." },
  { status: 403 },
);

const patchSchema = z.object({
  action: z.enum(["markRead", "markReplied", "markNew"]),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return FORBIDDEN;

  const { id } = await params;
  const message = await prisma.contactMessage.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ message });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return FORBIDDEN;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      { status: 400 },
    );
  }

  const now = new Date();
  const data: {
    status?: "NEW" | "READ" | "REPLIED";
    readAt?: Date | null;
    repliedAt?: Date | null;
  } = {};
  switch (parsed.data.action) {
    case "markRead":
      data.status = "READ";
      // Only set readAt if it wasn't set already — preserve the first read.
      data.readAt = undefined;
      break;
    case "markReplied":
      data.status = "REPLIED";
      data.repliedAt = now;
      break;
    case "markNew":
      data.status = "NEW";
      data.readAt = null;
      data.repliedAt = null;
      break;
  }

  // If marking READ and readAt is still null, set it.
  if (parsed.data.action === "markRead") {
    const existing = await prisma.contactMessage.findUnique({
      where: { id },
      select: { readAt: true, email: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (existing.readAt == null) data.readAt = now;
    else delete data.readAt;
  }

  const updated = await prisma.contactMessage.update({
    where: { id },
    data,
  });

  await logAdminAction(
    { id: admin.id, email: admin.email },
    "contact_message_status",
    {
      targetId: updated.id,
      targetEmail: updated.email,
      metadata: { action: parsed.data.action, newStatus: updated.status },
    },
  );

  return NextResponse.json({ message: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return FORBIDDEN;

  const { id } = await params;
  // Read first so the audit trail captures the submitter's email even though
  // the row is about to be gone.
  const existing = await prisma.contactMessage.findUnique({
    where: { id },
    select: { id: true, email: true, subject: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.contactMessage.delete({ where: { id } });

  await logAdminAction(
    { id: admin.id, email: admin.email },
    "contact_message_delete",
    {
      targetId: existing.id,
      targetEmail: existing.email,
      metadata: { subject: existing.subject, status: existing.status },
    },
  );

  return NextResponse.json({ ok: true });
}
