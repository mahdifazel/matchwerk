import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";

const patchSchema = z.object({
  action: z.enum([
    "star",
    "apply",
    "interview",
    "offer",
    "archive",
    "inbox",
    "delete",
    "setInterviewStage",
    "setArchiveReason",
    "setNote",
  ]),
  note: z.string().max(2000).optional(),
  interviewStage: z
    .enum([
      "RECRUITER_SCREEN",
      "HIRING_MANAGER",
      "TECHNICAL",
      "TAKE_HOME",
      "PANEL",
      "FINAL",
      "WAITING_DECISION",
    ])
    .optional(),
  archiveReason: z.enum(["REJECTED", "WITHDRAWN", "CLOSED"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  // Scope to the caller so a user can only act on their own jobs.
  const existing = await prisma.job.findFirst({ where: { id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const { action, interviewStage, archiveReason, note } = parsed.data;

  // Permissive stage transitions: the board UI only offers the moves allowed
  // from a job's current stage; the server just records the target status.
  // `appliedAt` is stamped only when entering APPLIED and cleared on the return
  // to the Inbox; later stages preserve it. `interviewStage`/`archiveReason`
  // are owned by their stage — set on entry, cleared whenever the job leaves.
  let data: Prisma.JobUpdateInput;
  switch (action) {
    case "star":
      data = { status: "STARRED", interviewStage: null, archiveReason: null };
      break;
    case "apply":
      data = {
        status: "APPLIED",
        appliedAt: new Date(),
        interviewStage: null,
        archiveReason: null,
      };
      break;
    case "interview":
      // Default to the first stage so an Interviewing card always reads cleanly.
      data = {
        status: "INTERVIEWING",
        interviewStage: interviewStage ?? "RECRUITER_SCREEN",
        archiveReason: null,
      };
      break;
    case "offer":
      data = { status: "OFFER", interviewStage: null, archiveReason: null };
      break;
    case "archive":
      if (!archiveReason) {
        return NextResponse.json(
          { error: "An archive reason is required." },
          { status: 400 },
        );
      }
      data = { status: "ARCHIVED", archiveReason, interviewStage: null };
      break;
    case "inbox":
      data = {
        status: "NEW",
        appliedAt: null,
        interviewStage: null,
        archiveReason: null,
      };
      break;
    case "delete":
      data = { status: "DELETED", interviewStage: null, archiveReason: null };
      break;
    case "setInterviewStage":
      // In-place sub-stage update; only valid while the job is Interviewing.
      if (!interviewStage) {
        return NextResponse.json(
          { error: "An interview stage is required." },
          { status: 400 },
        );
      }
      if (existing.status !== "INTERVIEWING") {
        return NextResponse.json(
          { error: "Job is not in the Interviewing stage." },
          { status: 409 },
        );
      }
      data = { interviewStage };
      break;
    case "setArchiveReason":
      if (!archiveReason) {
        return NextResponse.json(
          { error: "An archive reason is required." },
          { status: 400 },
        );
      }
      if (existing.status !== "ARCHIVED") {
        return NextResponse.json(
          { error: "Job is not in the Archived stage." },
          { status: 409 },
        );
      }
      data = { archiveReason };
      break;
    case "setNote":
      // Inline note edit from the Pipeline table; auto-saved as the user types.
      data = { note: note ?? "" };
      break;
  }

  const job = await prisma.job.update({ where: { id }, data });
  return NextResponse.json({ job });
}
