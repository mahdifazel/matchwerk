import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { getAiConfig, getProviderStatuses, setAiConfig } from "@/lib/ai";
import { getCredentialState } from "@/lib/platform";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const [statuses, config] = await Promise.all([
    getProviderStatuses(),
    getAiConfig(),
  ]);
  const providers = await Promise.all(
    statuses.map(async (s) => ({ ...s, key: await getCredentialState(s.keyName) })),
  );
  return NextResponse.json({ providers, config });
}

const providerId = z.enum(["claude", "gemini", "groq"]);
const putSchema = z.object({
  active: providerId,
  fallback: z.array(providerId),
  enabled: z.object({
    claude: z.boolean(),
    gemini: z.boolean(),
    groq: z.boolean(),
  }),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid configuration." }, { status: 400 });
  }
  if (!parsed.data.enabled[parsed.data.active]) {
    return NextResponse.json(
      { error: "The active provider must be enabled." },
      { status: 400 },
    );
  }

  await setAiConfig(parsed.data);
  await logAdminAction(admin, "ai.config", {
    metadata: { active: parsed.data.active, enabled: parsed.data.enabled },
  });
  return NextResponse.json({ ok: true });
}
