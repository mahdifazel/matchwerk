import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobSourceId } from "@/generated/prisma/enums";
import { getAdminUser, logAdminAction } from "@/lib/admin";
import { ALL_SOURCE_IDS } from "@/lib/constants";
import {
  clearSourceCredentials,
  setSourceCredentials,
  setSourceEnabled,
} from "@/lib/credentials";

const schema = z.object({
  enabled: z.boolean().optional(),
  credentials: z.record(z.string(), z.string()).optional(),
  clear: z.boolean().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id } = await params;
  if (!ALL_SOURCE_IDS.includes(id as JobSourceId)) {
    return NextResponse.json({ error: "Unknown source." }, { status: 404 });
  }
  const sourceId = id as JobSourceId;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { enabled, credentials, clear } = parsed.data;

  if (enabled !== undefined) {
    await setSourceEnabled(sourceId, enabled);
    await logAdminAction(admin, enabled ? "source.enable" : "source.disable", {
      metadata: { sourceId },
    });
  }
  if (clear) {
    await clearSourceCredentials(sourceId);
    await logAdminAction(admin, "source.key.clear", { metadata: { sourceId } });
  } else if (credentials) {
    await setSourceCredentials(sourceId, credentials);
    await logAdminAction(admin, "source.key.set", {
      metadata: { sourceId, fields: Object.keys(credentials) },
    });
  }

  return NextResponse.json({ ok: true });
}
