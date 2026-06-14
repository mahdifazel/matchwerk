import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import type {
  ArchiveReason,
  InterviewStage,
  JobStatus,
} from "@/generated/prisma/enums";
import {
  JOB_STATUS_LABEL,
  PIPELINE_STATUSES,
  pipelineStageLabel,
} from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "@/lib/repo";

// Each badge in the table is a translucent pill over the white card:
// fill = color-500 @10%, border = color-500 @30%, text = color-700 — all
// flattened onto white here so the spreadsheet renders the exact same colors.
type Swatch = { fill: string; font: string; border: string };

const STATUS_STYLE: Record<string, Swatch> = {
  APPLIED: { fill: "E7F6FD", font: "0369A1", border: "B7E4F8" },
  INTERVIEWING: { fill: "F3EFFE", font: "6D28D9", border: "DCCEFC" },
  OFFER: { fill: "E7F8F2", font: "047857", border: "B7EAD9" },
  ARCHIVED: { fill: "F1F1F2", font: "52525B", border: "D4D4D7" },
};

const INTERVIEW_STYLE: Record<string, Swatch> = {
  RECRUITER_SCREEN: { fill: "E7F6FD", font: "0369A1", border: "B7E4F8" },
  HIRING_MANAGER: { fill: "EFF0FE", font: "4338CA", border: "D0D1FB" },
  TECHNICAL: { fill: "F3EFFE", font: "6D28D9", border: "DCCEFC" },
  TAKE_HOME: { fill: "FEF5E7", font: "B45309", border: "FCE2B6" },
  PANEL: { fill: "E8F8F6", font: "0F766E", border: "B9EAE4" },
  FINAL: { fill: "E7F8F2", font: "047857", border: "B7EAD9" },
  WAITING_DECISION: { fill: "F1F1F2", font: "52525B", border: "D4D4D7" },
};

const ARCHIVE_STYLE: Record<string, Swatch> = {
  REJECTED: { fill: "FEECEF", font: "BE123C", border: "FCC5CF" },
  WITHDRAWN: { fill: "FEF5E7", font: "B45309", border: "FCE2B6" },
  CLOSED: { fill: "F1F1F2", font: "52525B", border: "D4D4D7" },
};

const NEUTRAL: Swatch = { fill: "F1F1F2", font: "52525B", border: "D4D4D7" };

function stageStyle(
  status: JobStatus,
  interviewStage: InterviewStage | null,
  archiveReason: ArchiveReason | null,
): Swatch {
  switch (status) {
    case "APPLIED":
      return { fill: "FEF5E7", font: "B45309", border: "FCE2B6" }; // Pending (amber)
    case "OFFER":
      return { fill: "E7F8F2", font: "047857", border: "B7EAD9" }; // Thinking (emerald)
    case "INTERVIEWING":
      return (interviewStage && INTERVIEW_STYLE[interviewStage]) || NEUTRAL;
    case "ARCHIVED":
      return (archiveReason && ARCHIVE_STYLE[archiveReason]) || NEUTRAL;
    default:
      return NEUTRAL;
  }
}

// Flattened design tokens (light theme, over white).
const INK = "FF1A1233"; // --foreground
const ROLE = "FF48415C"; // foreground/80
const LINK = "FF2563EB"; // clear, conventional hyperlink blue
const MUTED_FG = "FF6B5F86"; // --muted-foreground (header text)
const HEADER_FILL = "FFF9F6F1"; // bg-muted/40 over white
const DIVIDER = "FFF2EDE4"; // border/45 row rule

const solid = (hex: string): ExcelJS.FillPattern => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: `FF${hex}` },
});

const bottomRule = (): Partial<ExcelJS.Borders> => ({
  bottom: { style: "thin", color: { argb: DIVIDER } },
});

const pillOutline = (hex: string): Partial<ExcelJS.Borders> => {
  const side = { style: "thin" as const, color: { argb: `FF${hex}` } };
  return { top: side, left: side, bottom: side, right: side };
};

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    where: { userId, status: { in: PIPELINE_STATUSES } },
    orderBy: [{ appliedAt: "desc" }, { fetchedAt: "desc" }],
    select: {
      company: true,
      title: true,
      url: true,
      note: true,
      status: true,
      interviewStage: true,
      archiveReason: true,
    },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Matchwerk";
  wb.created = new Date();
  const ws = wb.addWorksheet("Pipeline", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "COMPANY", key: "company", width: 28 },
    { header: "ROLE", key: "role", width: 40 },
    { header: "STATUS", key: "status", width: 16 },
    { header: "STAGE", key: "stage", width: 24 },
    { header: "LINK", key: "link", width: 14 },
    { header: "NOTE", key: "note", width: 56 },
  ];

  // Header — light muted fill + muted-foreground uppercase, like the table head.
  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = {
      bold: true,
      color: { argb: MUTED_FG },
      size: 10,
      name: "Calibri",
    };
    cell.fill = solid(HEADER_FILL.slice(2));
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = bottomRule();
  });

  for (const job of jobs) {
    const row = ws.addRow({
      company: job.company,
      role: job.title,
      status: JOB_STATUS_LABEL[job.status],
      stage: pipelineStageLabel(
        job.status,
        job.interviewStage,
        job.archiveReason,
      ),
      link: "Open",
      note: job.note,
    });
    row.height = 22;
    row.alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell) => {
      cell.border = bottomRule();
    });

    row.getCell("company").font = { bold: true, color: { argb: INK } };
    row.getCell("role").font = { color: { argb: ROLE } };
    row.getCell("note").font = { color: { argb: INK } };

    const statusSwatch = STATUS_STYLE[job.status] ?? NEUTRAL;
    const statusCell = row.getCell("status");
    statusCell.fill = solid(statusSwatch.fill);
    statusCell.font = { bold: true, color: { argb: `FF${statusSwatch.font}` } };
    statusCell.alignment = { vertical: "middle", horizontal: "center" };
    statusCell.border = pillOutline(statusSwatch.border);

    const st = stageStyle(job.status, job.interviewStage, job.archiveReason);
    const stageCell = row.getCell("stage");
    stageCell.fill = solid(st.fill);
    stageCell.font = { bold: true, color: { argb: `FF${st.font}` } };
    stageCell.alignment = { vertical: "middle", horizontal: "center" };
    stageCell.border = pillOutline(st.border);

    const linkCell = row.getCell("link");
    linkCell.value = { text: "Open", hyperlink: job.url };
    linkCell.font = { color: { argb: LINK }, underline: true };
    linkCell.alignment = { vertical: "middle", horizontal: "left" };
    linkCell.border = bottomRule();
  }

  ws.autoFilter = { from: "A1", to: "F1" };

  const buffer = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="matchwerk-pipeline-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
