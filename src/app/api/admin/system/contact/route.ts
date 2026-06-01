import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { getAppSetting, setAppSetting } from "@/lib/platform";

const SETTING_KEY = "contact_to";
const ENV_FALLBACK = "CONTACT_TO";

function describe(value: string) {
  // Same "origin" semantics as the other admin/system routes: where is the
  // value actually coming from right now?
  if (value) return { origin: "db" as const, value };
  const env = process.env[ENV_FALLBACK];
  if (env) return { origin: "env" as const, value: env };
  return { origin: "none" as const, value: "" };
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const stored = await getAppSetting<string>(SETTING_KEY, "");
  return NextResponse.json(describe(stored));
}

const schema = z.object({
  // Empty string is allowed — that's the "clear it / fall back to env" action.
  value: z.string().trim().max(254),
});

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid value." }, { status: 400 });
  }
  if (parsed.data.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.value)) {
    return NextResponse.json(
      { error: "Looks like that's not a valid email." },
      { status: 400 },
    );
  }
  await setAppSetting<string>(SETTING_KEY, parsed.data.value);
  await logAdminAction(admin, "contact_to.update", {
    metadata: { hadValue: Boolean(parsed.data.value) },
  });
  return NextResponse.json(describe(parsed.data.value));
}
