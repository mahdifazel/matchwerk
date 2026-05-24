import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";

const schema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
    .max(200),
});

/**
 * Set or change the account password. If the user already has one (email/
 * password account), the current password is required and verified. Google-only
 * users have no password yet and can set one here to enable email sign-in too.
 */
export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid password." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  if (user.password) {
    if (!parsed.data.currentPassword) {
      return NextResponse.json(
        { error: "Enter your current password." },
        { status: 400 },
      );
    }
    const ok = await bcrypt.compare(parsed.data.currentPassword, user.password);
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 },
      );
    }
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { password: passwordHash },
  });
  return NextResponse.json({ ok: true });
}
