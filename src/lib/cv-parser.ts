import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { runWithAi } from "@/lib/ai";
import type { ParsedCvProfile } from "@/lib/ai/types";

export type { ParsedCvProfile };

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

/**
 * Raw CV text -> structured profile, via the active AI provider (with fallback
 * to the next configured provider on error). The provider implementations live
 * in `src/lib/ai/*`.
 */
export async function parseCvProfile(rawText: string): Promise<ParsedCvProfile> {
  if (rawText.length < 30) {
    throw new Error(
      "Could not read enough text from this CV. Try a different file.",
    );
  }
  return runWithAi((provider) => provider.parseCvProfile(rawText), "cv_parse");
}
