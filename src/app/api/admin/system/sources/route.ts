import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  getDisabledSourceIds,
  getSourceCredentialStatus,
  hasCredentialEditor,
} from "@/lib/credentials";
import { ALL_SOURCES } from "@/lib/sources";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const disabled = new Set(await getDisabledSourceIds());
  const sources = await Promise.all(
    ALL_SOURCES.map(async (s) => {
      const editor = hasCredentialEditor(s.id);
      const status = editor ? await getSourceCredentialStatus(s.id) : null;
      return {
        id: s.id,
        label: s.label,
        tier: s.tier,
        connected: s.connected,
        editable: editor,
        configured: await s.configured(),
        enabled: !disabled.has(s.id),
        fields:
          status?.fields.map((f) => ({
            id: f.id,
            label: f.label,
            secret: f.secret,
            set: f.set,
            masked: f.masked,
            origin: f.origin,
          })) ?? [],
      };
    }),
  );
  return NextResponse.json({ sources });
}
