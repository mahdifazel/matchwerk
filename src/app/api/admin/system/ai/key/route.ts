import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import {
  clearPlatformCredential,
  getCredentialState,
  setPlatformCredential,
} from "@/lib/platform";

const schema = z.object({
  keyName: z.enum(["ANTHROPIC_API_KEY", "GEMINI_API_KEY"]),
  // Empty string clears the stored key (falls back to env if present).
  value: z.string(),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const value = parsed.data.value.trim();
  if (value) {
    await setPlatformCredential(parsed.data.keyName, value);
  } else {
    await clearPlatformCredential(parsed.data.keyName);
  }
  await logAdminAction(admin, value ? "ai.key.set" : "ai.key.clear", {
    metadata: { keyName: parsed.data.keyName },
  });

  return NextResponse.json({ ok: true, key: await getCredentialState(parsed.data.keyName) });
}
