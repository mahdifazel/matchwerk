import { GoogleGenAI, Type } from "@google/genai";
import { getPlatformCredential } from "@/lib/platform";
import {
  normalizeCvProfile,
  type AiProvider,
  type ParsedCvProfile,
  type RawJobScore,
} from "./types";

export const GEMINI_MODELS = {
  cvParse: "gemini-2.5-flash",
  scoring: "gemini-2.5-flash",
} as const;

const ENV_KEY = "GEMINI_API_KEY";

let cached: { key: string; client: GoogleGenAI } | null = null;

async function client(): Promise<GoogleGenAI> {
  const key = await getPlatformCredential(ENV_KEY);
  if (!key) throw new Error("Gemini API key is not configured.");
  if (!cached || cached.key !== key) cached = { key, client: new GoogleGenAI({ apiKey: key }) };
  return cached.client;
}

const CV_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    tools: { type: Type.ARRAY, items: { type: Type.STRING } },
    industries: { type: Type.ARRAY, items: { type: Type.STRING } },
    languages: { type: Type.ARRAY, items: { type: Type.STRING } },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    seniority: {
      type: Type.STRING,
      enum: ["JUNIOR", "MID", "SENIOR", "LEAD", "UNKNOWN"],
      format: "enum",
    },
    yearsExperience: { type: Type.INTEGER },
    suggestedJobTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "summary", "skills", "tools", "industries", "languages", "keywords",
    "seniority", "yearsExperience", "suggestedJobTitles",
  ],
};

const SCORES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scores: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          score: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
          missingSkills: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredLanguages: {
            type: Type.ARRAY,
            items: { type: Type.STRING, enum: ["de", "en"], format: "enum" },
          },
        },
        required: ["id", "score", "explanation", "missingSkills", "requiredLanguages"],
      },
    },
  },
  required: ["scores"],
};

function parseJson<T>(text: string | undefined, fallback: T): T {
  try {
    return JSON.parse(text ?? "") as T;
  } catch {
    return fallback;
  }
}

// Ride out Google's transient capacity rejections (the "high demand" 503s, plus
// 429s / UNAVAILABLE / RESOURCE_EXHAUSTED) with a short jittered backoff before
// runWithAi gives up on Gemini and falls back to Claude. Kept small so it stays
// well under the matcher's scoring deadline. Non-transient errors throw at once.
const MAX_ATTEMPTS = 3; // initial + 2 retries
const BASE_DELAY_MS = 400;
const TRANSIENT_RE =
  /\b(429|503)\b|unavailable|overloaded|high demand|resource[\s_]?exhausted|rate[\s-]?limit/i;

function isTransient(err: unknown): boolean {
  const code =
    (err as { status?: number; code?: number })?.status ??
    (err as { code?: number })?.code;
  if (code === 429 || code === 503) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_RE.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS - 1 || !isTransient(err)) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  label: "Gemini Flash (Google)",

  async isConfigured() {
    return Boolean(await getPlatformCredential(ENV_KEY));
  },

  async ping() {
    // Minimal generation (1 token) to validate key + connectivity.
    const ai = await client();
    await ai.models.generateContent({
      model: GEMINI_MODELS.scoring,
      contents: "ping",
      config: { maxOutputTokens: 1 },
    });
  },

  async parseCvProfile(rawText: string): Promise<ParsedCvProfile> {
    const ai = await client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODELS.cvParse,
        contents: `Extract a structured profile from this CV. Focus on what's relevant for matching roles.\n\n--- CV TEXT ---\n${rawText.slice(0, 24000)}`,
        config: { responseMimeType: "application/json", responseSchema: CV_SCHEMA },
      }),
    );
    return normalizeCvProfile(parseJson<Partial<ParsedCvProfile>>(res.text, {}));
  },

  async scoreBatch(systemPrompt: string, userPrompt: string): Promise<RawJobScore[]> {
    const ai = await client();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODELS.scoring,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: SCORES_SCHEMA,
        },
      }),
    );
    return parseJson<{ scores?: RawJobScore[] }>(res.text, {}).scores ?? [];
  },
};
