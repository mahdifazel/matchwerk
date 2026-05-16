import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCvText, parseCvProfile } from "@/lib/cv-parser";
import { prisma } from "@/lib/prisma";
import { getProfile, getSettings, PROFILE_ID, SETTINGS_ID } from "@/lib/repo";

const stringList = z.array(z.string().trim().min(1)).max(200);

const patchSchema = z
  .object({
    summary: z.string().trim().max(4000).optional(),
    skills: stringList.optional(),
    tools: stringList.optional(),
    industries: stringList.optional(),
    keywords: stringList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update.");

export async function GET() {
  const profile = await getProfile();
  return NextResponse.json({ profile });
}

export async function POST(request: Request) {
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
      where: { id: PROFILE_ID },
      create: {
        id: PROFILE_ID,
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
      await getSettings(); // ensure the singleton exists before update
      await prisma.settings.update({
        where: { id: SETTINGS_ID },
        data: { jobTitles: suggestedJobTitles },
      });
    }

    // A new CV may represent a completely different profession. Drop every
    // NEW job so the board doesn't show stale matches from the previous
    // profile. STARRED and APPLIED rows are preserved — the user might have
    // already acted on those and shouldn't lose that history.
    const cleared = await prisma.job.deleteMany({ where: { status: "NEW" } });

    return NextResponse.json({
      profile,
      suggestedJobTitles,
      clearedJobs: cleared.count,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to process CV.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const existing = await getProfile();
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
    where: { id: PROFILE_ID },
    data: parsed.data,
  });
  return NextResponse.json({ profile });
}
