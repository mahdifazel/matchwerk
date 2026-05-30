import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCvText, parseCvProfile } from "@/lib/cv-parser";
import { checkCvUpload } from "@/lib/limits";
import { prisma } from "@/lib/prisma";
import { getProfile, getSessionUserId, getSettings } from "@/lib/repo";
import { charge, TOKEN } from "@/lib/tokens";

// CV upload parses the file and runs an AI extraction — can take tens of
// seconds. 60s is safe on all Vercel plans (only the POST is heavy).
export const maxDuration = 60;

const stringList = z.array(z.string().trim().min(1)).max(200);

const UNAUTHORIZED = NextResponse.json(
  { error: "Sign in to continue." },
  { status: 401 },
);

const patchSchema = z
  .object({
    summary: z.string().trim().max(4000).optional(),
    skills: stringList.optional(),
    tools: stringList.optional(),
    industries: stringList.optional(),
    languages: stringList.optional(),
    keywords: stringList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update.");

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;
  const profile = await getProfile(userId);
  return NextResponse.json({ profile });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;

  // Balance gate (≥ 25 tokens) + per-day rate limit, before any expensive work.
  const gate = await checkCvUpload(userId);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large (max 8 MB)." },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rawText = await extractCvText(buffer, file.name);
    const { suggestedJobTitles, ...profileFields } = await parseCvProfile(rawText);

    const profile = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        fileName: file.name,
        rawCvText: rawText,
        ...profileFields,
        parsedAt: new Date(),
      },
      update: {
        fileName: file.name,
        rawCvText: rawText,
        ...profileFields,
        parsedAt: new Date(),
      },
    });

    // Auto-personalize Settings: the 3 model-suggested titles overwrite
    // whatever was there. The user can still edit them in Settings.
    if (suggestedJobTitles.length > 0) {
      await getSettings(userId); // ensure the row exists before update
      await prisma.settings.update({
        where: { userId },
        data: { jobTitles: suggestedJobTitles },
      });
    }

    // A new CV may represent a completely different profession. Drop every
    // NEW job so the board doesn't show stale matches from the previous
    // profile. STARRED and APPLIED rows are preserved — the user might have
    // already acted on those and shouldn't lose that history.
    const cleared = await prisma.job.deleteMany({
      where: { userId, status: "NEW" },
    });

    // Charge for the AI parse (once per upload — inline PATCH edits are free).
    const tokens = await charge(userId, TOKEN.CV_PARSE, "cv_parse");

    return NextResponse.json({
      profile,
      suggestedJobTitles,
      clearedJobs: cleared.count,
      tokens: { balance: tokens.balance, charged: tokens.charged },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to process CV.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;

  const existing = await getProfile(userId);
  if (!existing) {
    return NextResponse.json(
      { error: "Upload a CV before editing the profile." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      { status: 400 },
    );
  }

  const profile = await prisma.profile.update({
    where: { userId },
    data: parsed.data,
  });
  return NextResponse.json({ profile });
}
