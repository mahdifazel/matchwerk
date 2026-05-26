import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { SMTP_PASSWORD_KEY, getSmtpConfig } from "@/lib/email";
import {
  clearPlatformCredential,
  getCredentialState,
  setAppSetting,
  setPlatformCredential,
} from "@/lib/platform";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const config = await getSmtpConfig();
  const password = await getCredentialState(SMTP_PASSWORD_KEY);
  return NextResponse.json({ config, password });
}

const schema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(255),
  from: z.string().trim().max(255),
  // Optional: only updates the stored secret when present. "" clears it.
  password: z.string().optional(),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid SMTP settings." },
      { status: 400 },
    );
  }
  const { password, ...config } = parsed.data;
  await setAppSetting("smtp", config);
  if (password !== undefined) {
    if (password.trim()) await setPlatformCredential(SMTP_PASSWORD_KEY, password.trim());
    else await clearPlatformCredential(SMTP_PASSWORD_KEY);
  }
  await logAdminAction(admin, "email.config", { metadata: { host: config.host, enabled: config.enabled } });
  return NextResponse.json({ ok: true });
}
