import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import type {
  JobSourceId,
  JobStatus,
  JobType,
  Seniority,
} from "@/generated/prisma/enums";
import {
  ALL_JOB_TYPES,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DATE_POSTED_OPTIONS,
  TAB_STATUSES,
  type DatePostedId,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";

const LOCATION_MATCHES: Record<string, string[]> = {
  berlin: ["Berlin"],
  munich: ["München", "Munich", "Muenchen"],
  hamburg: ["Hamburg"],
  remote: ["Remote", "Homeoffice", "Home Office"],
};

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const tab = searchParams.get("tab") ?? "new";
  const status: JobStatus = TAB_STATUSES[tab] ?? "NEW";

  const sources = csv(searchParams.get("sources")) as JobSourceId[];
  const seniority = csv(searchParams.get("seniority")) as Seniority[];
  const jobTypes = csv(searchParams.get("jobTypes")) as JobType[];
  const locations = csv(searchParams.get("locations"));

  const where: Prisma.JobWhereInput = { status };

  // A filter only narrows results when the user has deselected something.
  // When everything is selected (the default), don't filter at all — otherwise
  // jobs we couldn't classify (seniority/jobType = UNKNOWN) would be hidden.
  // When narrowed, UNKNOWN jobs still pass so real listings aren't lost.
  if (sources.length > 0 && sources.length < ALL_SOURCE_IDS.length) {
    where.source = { in: sources };
  }
  if (seniority.length > 0 && seniority.length < ALL_SENIORITY.length) {
    where.seniority = { in: [...seniority, "UNKNOWN"] };
  }
  if (jobTypes.length > 0 && jobTypes.length < ALL_JOB_TYPES.length) {
    where.jobType = { in: [...jobTypes, "UNKNOWN"] };
  }

  if (locations.length > 0 && !locations.includes("all")) {
    const ors: Prisma.JobWhereInput[] = [];
    for (const loc of locations) {
      for (const needle of LOCATION_MATCHES[loc] ?? []) {
        ors.push({ location: { contains: needle, mode: "insensitive" } });
      }
    }
    if (ors.length > 0) where.OR = ors;
  }

  const datePostedRaw = searchParams.get("datePosted") as DatePostedId | null;
  const datePostedOpt = DATE_POSTED_OPTIONS.find((d) => d.id === datePostedRaw);
  if (datePostedOpt?.days != null) {
    const cutoff = new Date(Date.now() - datePostedOpt.days * 24 * 60 * 60 * 1000);
    // Fall back to fetchedAt when the source didn't supply a publishedAt — many
    // aggregators leave it null and we'd otherwise filter out fresh listings.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { publishedAt: { gte: cutoff } },
          { publishedAt: null, fetchedAt: { gte: cutoff } },
        ],
      },
    ];
  }

  const orderBy: Prisma.JobOrderByWithRelationInput[] =
    status === "APPLIED"
      ? [{ appliedAt: "desc" }]
      : [{ matchScore: "desc" }, { fetchedAt: "desc" }];

  const jobs = await prisma.job.findMany({ where, orderBy });
  return NextResponse.json({ jobs });
}
