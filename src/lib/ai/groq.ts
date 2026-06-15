import { getPlatformCredential } from "@/lib/platform";
import {
  normalizeCvProfile,
  type AiProvider,
  type ParsedCvProfile,
  type RawJobScore,
} from "./types";

// Groq is OpenAI-compatible, so it's wired with plain fetch (no SDK dependency).
// It serves as a FREE fallback tier between Gemini and Claude — fast, reliable
// uptime, native JSON mode.
export const GROQ_MODELS = {
  cvParse: "llama-3.3-70b-versatile",
  scoring: "llama-3.3-70b-versatile",
} as const;

const ENV_KEY = "GROQ_API_KEY";
const BASE_URL = "https://api.groq.com/openai/v1";
const TIMEOUT_MS = 20_000;

type ChatMessage = { role: "system" | "user"; content: string };

async function getKey(): Promise<string> {
  const key = await getPlatformCredential(ENV_KEY);
  if (!key) throw new Error("Groq API key is not configured.");
  return key;
}

/**
 * One JSON-mode chat completion. Bounded by an AbortController so a slow/hung
 * call can't blow the refresh budget. Throws with the HTTP status in the message
 * on non-2xx, so runWithAi logs the attempt and falls through to the next provider.
 */
async function chat(model: string, messages: ChatMessage[]): Promise<string> {
  const key = await getKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Groq returned ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(text: string | undefined, fallback: T): T {
  try {
    return JSON.parse(text ?? "") as T;
  } catch {
    return fallback;
  }
}

// json_object mode requires the literal word "json" in the prompt, and there's no
// schema enforcement, so the expected shape is spelled out explicitly.
const CV_INSTRUCTION = `Extract a structured profile from the candidate's CV and respond with ONLY a JSON object (no prose, no markdown) of this exact shape:
{
  "summary": string,            // 2-3 sentence professional summary, third person
  "skills": string[],           // design/professional skills
  "tools": string[],            // software/tools the candidate knows
  "industries": string[],       // industries/domains worked in
  "languages": string[],        // languages copied as written in the CV, e.g. "German (native)", "English (fluent)"; [] if none listed
  "keywords": string[],         // additional searchable keywords
  "seniority": "JUNIOR" | "MID" | "SENIOR" | "LEAD" | "UNKNOWN",
  "yearsExperience": number,    // estimated total years of professional experience
  "suggestedJobTitles": string[] // exactly 3 concrete searchable job titles, best fit first
}`;

const SCORE_INSTRUCTION = `Respond with ONLY a JSON object (no prose, no markdown) of this exact shape:
{ "scores": [ {
  "id": string,                 // the job id being scored
  "score": number,              // match score 0-100
  "explanation": string,        // one concise sentence on the fit
  "missingSkills": string[],    // skills the role needs that the CV lacks; never skills the candidate already has; [] if none
  "requiredLanguages": string[] // subset of ["de","en"] the job explicitly REQUIRES; [] when none stated (means English suffices)
} ] }`;

export const groqProvider: AiProvider = {
  id: "groq",
  label: "Groq (Llama 3.3)",

  async isConfigured() {
    return Boolean(await getPlatformCredential(ENV_KEY));
  },

  async ping() {
    // Generation-free liveness + key validity check.
    const key = await getKey();
    const res = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  },

  async parseCvProfile(rawText: string): Promise<ParsedCvProfile> {
    const content = await chat(GROQ_MODELS.cvParse, [
      { role: "system", content: CV_INSTRUCTION },
      { role: "user", content: `--- CV TEXT ---\n${rawText.slice(0, 24000)}` },
    ]);
    return normalizeCvProfile(parseJson<Partial<ParsedCvProfile>>(content, {}));
  },

  async scoreBatch(systemPrompt: string, userPrompt: string): Promise<RawJobScore[]> {
    const content = await chat(GROQ_MODELS.scoring, [
      { role: "system", content: `${systemPrompt}\n\n${SCORE_INSTRUCTION}` },
      { role: "user", content: userPrompt },
    ]);
    return parseJson<{ scores?: RawJobScore[] }>(content, {}).scores ?? [];
  },
};
