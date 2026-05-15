import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobSourceId } from "@/generated/prisma/enums";
import { ALL_SOURCE_IDS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getSettings, SETTINGS_ID } from "@/lib/repo";

const seniority = z.enum(["JUNIOR", "MID", "SENIOR", "LEAD", "UNKNOWN"]);
const jobType = z.enum([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "FREELANCE",
  "INTERNSHIP",
  "UNKNOWN",
]);
const sourceId = z.enum(
  ALL_SOURCE_IDS as [JobSourceId, ...JobSourceId[]],
);

const updateSchema = z.object({
  jobTitles: z.array(z.string().trim().min(1)).min(1).max(20),
  defaultLocations: z.array(z.string()),
  defaultSeniority: z.array(seniority),
  defaultJobTypes: z.array(jobType),
  defaultSources: z.array(sourceId),
});

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  await getSettings();
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const settings = await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: parsed.data,
  });
  return NextResponse.json({ settings });
}
