import { NextResponse } from "next/server";
import { z } from "zod";
import type { JobSourceId } from "@/generated/prisma/enums";
import { ALL_SOURCE_IDS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getSessionUserId, getSettings } from "@/lib/repo";

const UNAUTHORIZED = NextResponse.json(
  { error: "Sign in to continue." },
  { status: 401 },
);

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
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;
  const settings = await getSettings(userId);
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) return UNAUTHORIZED;

  await getSettings(userId); // ensure the row exists before update
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const settings = await prisma.settings.update({
    where: { userId },
    data: parsed.data,
  });
  return NextResponse.json({ settings });
}
