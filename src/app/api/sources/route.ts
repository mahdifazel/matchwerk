import { NextResponse } from "next/server";
import { getCredentialStatus, hasCredentialEditor } from "@/lib/credentials";
import { ALL_SOURCES } from "@/lib/sources";

/** Runtime status of every source: implemented, configured, and where the credential comes from. */
export async function GET() {
  const sources = await Promise.all(
    ALL_SOURCES.map(async (s) => {
      const editor = hasCredentialEditor(s.id);
      const status = editor ? await getCredentialStatus(s.id) : null;
      return {
        id: s.id,
        label: s.label,
        tier: s.tier,
        connected: s.connected,
        configured: await s.configured(),
        editable: editor,
        credentialSource: status?.source ?? (editor ? "none" : "env"),
      };
    }),
  );
  return NextResponse.json({ sources });
}
