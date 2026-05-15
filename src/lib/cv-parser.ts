import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { Seniority } from "@/generated/prisma/enums";
import { getAnthropic, MODELS } from "./anthropic";

export type ParsedCvProfile = {
  summary: string;
  skills: string[];
  tools: string[];
  industries: string[];
  keywords: string[];
  seniority: Seniority;
  yearsExperience: number;
};

/** Extract plain text from an uploaded CV (PDF or DOCX). */
export async function extractCvText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }
  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buffer.toString("utf-8").trim();
  }
  throw new Error("Unsupported file type. Upload a PDF, DOCX, or TXT file.");
}

const CV_TOOL = {
  name: "save_cv_profile",
  description:
    "Save the structured profile extracted from the candidate's CV.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 sentence professional summary of the candidate, written in third person.",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        description:
          "Design and professional skills (e.g. 'design systems', 'user research', 'prototyping').",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Software/tools the candidate knows (e.g. 'Figma', 'Jira').",
      },
      industries: {
        type: "array",
        items: { type: "string" },
        description: "Industries/domains the candidate has worked in.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Additional searchable keywords describing the candidate's experience.",
      },
      seniority: {
        type: "string",
        enum: ["JUNIOR", "MID", "SENIOR", "LEAD", "UNKNOWN"],
        description: "Overall career seniority level.",
      },
      yearsExperience: {
        type: "integer",
        description: "Total years of professional experience (best estimate).",
      },
    },
    required: [
      "summary",
      "skills",
      "tools",
      "industries",
      "keywords",
      "seniority",
      "yearsExperience",
    ],
  },
};

/** One Claude call: raw CV text -> structured profile. */
export async function parseCvProfile(
  rawText: string,
): Promise<ParsedCvProfile> {
  if (rawText.length < 30) {
    throw new Error(
      "Could not read enough text from this CV. Try a different file.",
    );
  }
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODELS.cvParse,
    max_tokens: 2048,
    tools: [CV_TOOL],
    tool_choice: { type: "tool", name: "save_cv_profile" },
    messages: [
      {
        role: "user",
        content: `Extract a structured profile from this CV. Focus on what's relevant for matching Product Design / UX roles.\n\n--- CV TEXT ---\n${rawText.slice(0, 24000)}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("CV parsing failed: model did not return structured data.");
  }
  const input = block.input as Partial<ParsedCvProfile>;
  return {
    summary: input.summary ?? "",
    skills: input.skills ?? [],
    tools: input.tools ?? [],
    industries: input.industries ?? [],
    keywords: input.keywords ?? [],
    seniority: input.seniority ?? "UNKNOWN",
    yearsExperience: input.yearsExperience ?? 0,
  };
}
