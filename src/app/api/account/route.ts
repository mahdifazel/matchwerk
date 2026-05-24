import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";
import { getTokenAccount } from "@/lib/tokens";

const UNAUTHORIZED = NextResponse.json(
  { error: "Sign in to continue." },
  { status: 401 },
);

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      image: true,
      password: true,
      createdAt: true,
      accounts: { select: { provider: true } },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const tokens = await getTokenAccount(userId);

  return NextResponse.json({
    account: {
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.createdAt,
      // Never expose the hash — just whether one is set.
      hasPassword: user.password != null,
      providers: user.accounts.map((a) => a.provider),
      tokenBalance: tokens.balance,
      tokenDebt: tokens.debt,
    },
  });
}

const patchSchema = z.object({
  name: z.string().trim().max(100),
});

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Name must be 100 characters or fewer." },
      { status: 400 },
    );
  }

  // Empty string clears the display name back to null.
  const name = parsed.data.name.length > 0 ? parsed.data.name : null;
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name },
    select: { name: true },
  });
  return NextResponse.json({ ok: true, name: user.name });
}
