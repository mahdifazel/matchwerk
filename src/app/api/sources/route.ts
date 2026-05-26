import { NextResponse } from "next/server";
import {
  getDisabledSourceIds,
  getSourceCredentialStatus,
  hasCredentialEditor,
} from "@/lib/credentials";
import { getSessionUserId } from "@/lib/repo";
import { ALL_SOURCES } from "@/lib/sources";

/** Runtime status of every source: implemented, configured, globally enabled. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const disabled = new Set(await getDisabledSourceIds());
  const sources = await Promise.all(
    ALL_SOURCES.map(async (s) => {
      const editor = hasCredentialEditor(s.id);
      const status = editor ? await getSourceCredentialStatus(s.id) : null;
      // A globally-disabled source reports as not connected so the client treats
      // it as unavailable (greyed in filters), matching the refresh behavior.
      const connected = s.connected && !disabled.has(s.id);
      return {
        id: s.id,
        label: s.label,
        tier: s.tier,
        connected,
        configured: await s.configured(),
        editable: editor,
        credentialSource: status?.source ?? (editor ? "none" : "env"),
      };
    }),
  );
  return NextResponse.json({ sources });
}
