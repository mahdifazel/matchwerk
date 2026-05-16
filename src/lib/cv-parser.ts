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
  /** Exactly 3 role titles tailored to the candidate — used to pre-fill Settings.jobTitles. */
  suggestedJobTitles: string[];
};

// PDF extraction can leak C0 control bytes — most importantly null (0x00),
// which Postgres `text` rejects with "invalid byte sequence for encoding
// UTF8: 0x00". Strip 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F; keep \t, \n, \r.
function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
}

/** Extract plain text from an uploaded CV (PDF or DOCX). */
export async function extractCvText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return sanitize(text);
  }
  if (lower.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return sanitize(value);
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return sanitize(buffer.toString("utf-8"));
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
      suggestedJobTitles: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description:
          "Exactly 3 job titles this candidate should search for, ordered by best fit. Use concrete, searchable titles employers actually post (e.g. 'Senior Product Designer', 'UX Designer', 'Product Designer'), not category labels. Reflect the candidate's actual seniority and specialization, not generic catch-alls.",
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
      "suggestedJobTitles",
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
  const titles = (input.suggestedJobTitles ?? [])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return {
    summary: input.summary ?? "",
    skills: input.skills ?? [],
    tools: input.tools ?? [],
    industries: input.industries ?? [],
    keywords: input.keywords ?? [],
    seniority: input.seniority ?? "UNKNOWN",
    yearsExperience: input.yearsExperience ?? 0,
    suggestedJobTitles: titles,
  };
}
