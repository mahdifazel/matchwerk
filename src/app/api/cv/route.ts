import { NextResponse } from "next/server";
import { extractCvText, parseCvProfile } from "@/lib/cv-parser";
import { prisma } from "@/lib/prisma";
import { getProfile, PROFILE_ID } from "@/lib/repo";

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
    const parsed = await parseCvProfile(rawText);

    const profile = await prisma.profile.upsert({
      where: { id: PROFILE_ID },
      create: {
        id: PROFILE_ID,
        fileName: file.name,
        rawCvText: rawText,
        ...parsed,
        parsedAt: new Date(),
      },
      update: {
        fileName: file.name,
        rawCvText: rawText,
        ...parsed,
        parsedAt: new Date(),
      },
    });

    return NextResponse.json({ profile });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to process CV.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
