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
  ALL_LANGUAGE_IDS,
  ALL_SENIORITY,
  ALL_SOURCE_IDS,
  DATE_POSTED_OPTIONS,
  TAB_STATUSES,
  type DatePostedId,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";
import { TOKEN } from "@/lib/tokens";

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
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const tab = searchParams.get("tab") ?? "inbox";
  const status: JobStatus = TAB_STATUSES[tab] ?? "NEW";

  const sources = csv(searchParams.get("sources")) as JobSourceId[];
  const seniority = csv(searchParams.get("seniority")) as Seniority[];
  const jobTypes = csv(searchParams.get("jobTypes")) as JobType[];
  const locations = csv(searchParams.get("locations"));
  const languages = csv(searchParams.get("languages")) as ("de" | "en")[];

  const where: Prisma.JobWhereInput = { userId, status };

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

  // Language filter: maps the user's selected German/English chips onto
  // `Job.requiredLanguages`, which the scorer emits per the product rule
  // (empty array = English suffices, because no German requirement was found).
  //   - German only  →  jobs whose requiredLanguages includes "de"
  //   - English only →  jobs whose requiredLanguages does NOT include "de"
  //   - Both         →  no filter (defensive rule, same as everything else)
  if (languages.length > 0 && languages.length < ALL_LANGUAGE_IDS.length) {
    if (languages.includes("de")) {
      where.requiredLanguages = { has: "de" };
    } else if (languages.includes("en")) {
      where.NOT = {
        ...(typeof where.NOT === "object" && where.NOT !== null && !Array.isArray(where.NOT)
          ? where.NOT
          : {}),
        requiredLanguages: { has: "de" },
      };
    }
  }

  // Minimum match-score threshold (0–90, steps of 10). The slider value sets
  // the floor; jobs without a score are ALWAYS excluded. Prisma `gte` is null-
  // safe at the SQL layer (`matchScore >= 0` is unknown for nulls and so the
  // row is dropped), so anchoring the floor at 0 when no threshold is set
  // gives us the "must have a score" rule for free.
  const minScoreRaw = Number(searchParams.get("minScore"));
  const minScore =
    Number.isFinite(minScoreRaw) && minScoreRaw > 0
      ? Math.min(90, Math.max(0, Math.round(minScoreRaw)))
      : 0;
  where.matchScore = { gte: minScore };

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

  // The inbox shows only the top-scored jobs; lower-ranked ones stay stored
  // (and billed) but hidden. Starred/Applied are user-curated, so uncapped.
  const take = tab === "inbox" ? TOKEN.MAX_BOARD_JOBS : undefined;

  const jobs = await prisma.job.findMany({ where, orderBy, take });
  return NextResponse.json({ jobs });
}
