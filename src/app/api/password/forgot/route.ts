import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPasswordResetEmail } from "@/lib/email";
import { createResetToken } from "@/lib/password-reset";

const schema = z.object({ email: z.string().trim().email() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  // Always respond generically — never reveal whether an account exists.
  if (parsed.success) {
    const raw = await createResetToken(parsed.data.email);
    if (raw) {
      const origin = request.headers.get("origin") ?? new URL(request.url).origin;
      const link = `${origin}/reset-password?token=${raw}`;
      await sendPasswordResetEmail(parsed.data.email.trim().toLowerCase(), link);
    }
  }
  return NextResponse.json({ ok: true });
}
