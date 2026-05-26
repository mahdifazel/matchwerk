import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { sendTestEmail } from "@/lib/email";

const schema = z.object({ to: z.string().trim().email() });

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid recipient email." }, { status: 400 });
  }

  const result = await sendTestEmail(parsed.data.to);
  await logAdminAction(admin, "email.test", { metadata: { to: parsed.data.to, via: result.via, ok: result.ok } });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Send failed (${result.via}): ${result.error ?? "unknown error"}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, via: result.via });
}
