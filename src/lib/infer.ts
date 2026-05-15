import type { JobType, Seniority } from "@/generated/prisma/enums";

/** Best-effort seniority guess from a job title / text. */
export function inferSeniority(text: string): Seniority {
  const t = text.toLowerCase();
  if (/\b(lead|principal|head of|staff|director)\b/.test(t)) return "LEAD";
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return "SENIOR";
  if (/\b(junior|jr\.?|entry|graduate|werkstudent|praktik)\b/.test(t))
    return "JUNIOR";
  if (/\b(mid|intermediate)\b/.test(t)) return "MID";
  return "UNKNOWN";
}

/** Best-effort job-type guess from title / text. */
export function inferJobType(text: string): JobType {
  const t = text.toLowerCase();
  if (/\b(intern|internship|praktikum|praktikant|werkstudent)\b/.test(t))
    return "INTERNSHIP";
  if (/\b(freelance|freiberuf|contractor)\b/.test(t)) return "FREELANCE";
  if (/\b(contract|befristet|interim)\b/.test(t)) return "CONTRACT";
  if (/\b(part[- ]?time|teilzeit)\b/.test(t)) return "PART_TIME";
  return "FULL_TIME";
}
