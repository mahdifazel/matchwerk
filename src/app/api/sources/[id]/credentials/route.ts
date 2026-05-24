import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobSourceId } from "@/generated/prisma/enums";
import { ALL_SOURCE_IDS } from "@/lib/constants";
import {
  clearCredential,
  getCredentialStatus,
  hasCredentialEditor,
  setCredential,
  SOURCE_CREDENTIAL_SCHEMA,
} from "@/lib/credentials";
import { getSessionUserId } from "@/lib/repo";

function parseSourceId(raw: string): JobSourceId | null {
  if ((ALL_SOURCE_IDS as readonly string[]).includes(raw)) {
    return raw as JobSourceId;
  }
  return null;
}

function unauthorized() {
  return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
}

function notEditableResponse() {
  return NextResponse.json(
    { error: "This source has no editable credential." },
    { status: 404 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  const sourceId = parseSourceId(id);
  if (!sourceId) {
    return NextResponse.json({ error: "Unknown source." }, { status: 404 });
  }
  if (!hasCredentialEditor(sourceId)) return notEditableResponse();
  const status = await getCredentialStatus(userId, sourceId);
  return NextResponse.json({ status });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  const sourceId = parseSourceId(id);
  if (!sourceId) {
    return NextResponse.json({ error: "Unknown source." }, { status: 404 });
  }
  const schema = SOURCE_CREDENTIAL_SCHEMA[sourceId];
  if (!schema) return notEditableResponse();

  const body = await request.json().catch(() => null);
  // Each field is an optional string (empty string treated as "leave unset"
  // by setCredential). At least one field must be non-empty.
  const shape: Record<string, z.ZodString> = {};
  for (const f of schema.fields) shape[f.id] = z.string();
  const bodySchema = z.object(shape).partial();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid credential payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const values = parsed.data as Record<string, string>;
  if (!Object.values(values).some((v) => v && v.trim().length > 0)) {
    return NextResponse.json(
      { error: "Provide at least one credential field." },
      { status: 400 },
    );
  }

  const { updatedAt } = await setCredential(userId, sourceId, values);
  const status = await getCredentialStatus(userId, sourceId);
  return NextResponse.json({ ok: true, updatedAt, status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  const sourceId = parseSourceId(id);
  if (!sourceId) {
    return NextResponse.json({ error: "Unknown source." }, { status: 404 });
  }
  if (!hasCredentialEditor(sourceId)) return notEditableResponse();

  await clearCredential(userId, sourceId);
  const status = await getCredentialStatus(userId, sourceId);
  return NextResponse.json({ ok: true, status });
}
