import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { claimOrphanDataForFirstUser } from "@/lib/claim";
import { prisma } from "@/lib/prisma";
import { getTokenAccount } from "@/lib/tokens";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid registration." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name ?? null,
      email,
      password: passwordHash,
    },
  });

  // First account inherits any pre-existing single-tenant data.
  await claimOrphanDataForFirstUser(user.id);
  // Apply the 150-token signup grant.
  await getTokenAccount(user.id);

  return NextResponse.json({ ok: true });
}
