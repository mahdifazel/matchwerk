import Anthropic from "@anthropic-ai/sdk";
import { getPlatformCredential } from "@/lib/platform";
import {
  normalizeCvProfile,
  type AiProvider,
  type ParsedCvProfile,
  type RawJobScore,
} from "./types";

export const CLAUDE_MODELS = {
  /** One-time CV parsing — favor quality. */
  cvParse: "claude-sonnet-4-6",
  /** Batched job scoring — favor cost/speed. */
  scoring: "claude-haiku-4-5-20251001",
} as const;

const ENV_KEY = "ANTHROPIC_API_KEY";

let cached: { key: string; client: Anthropic } | null = null;

async function client(): Promise<Anthropic> {
  const key = await getPlatformCredential(ENV_KEY);
  if (!key) throw new Error("Anthropic API key is not configured.");
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

const CV_TOOL = {
  name: "save_cv_profile",
  description: "Save the structured profile extracted from the candidate's CV.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2-3 sentence professional summary, third person." },
      skills: { type: "array", items: { type: "string" }, description: "Design and professional skills." },
      tools: { type: "array", items: { type: "string" }, description: "Software/tools the candidate knows." },
      industries: { type: "array", items: { type: "string" }, description: "Industries/domains worked in." },
      languages: {
        type: "array",
        items: { type: "string" },
        description:
          "Languages the candidate speaks, copied as written in the CV (e.g. \"German (native)\", \"English (fluent)\", \"Spanish (basic)\"). Empty if the CV does not list any.",
      },
      keywords: { type: "array", items: { type: "string" }, description: "Additional searchable keywords." },
      seniority: {
        type: "string",
        enum: ["JUNIOR", "MID", "SENIOR", "LEAD", "UNKNOWN"],
        description: "Overall career seniority level.",
      },
      yearsExperience: { type: "integer", description: "Total years of professional experience (estimate)." },
      suggestedJobTitles: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
        description:
          "Exactly 3 concrete, searchable job titles this candidate should search for, ordered by best fit.",
      },
    },
    required: [
      "summary", "skills", "tools", "industries", "languages", "keywords",
      "seniority", "yearsExperience", "suggestedJobTitles",
    ],
  },
};

const SCORE_TOOL = {
  name: "save_scores",
  description: "Save match scores for the batch of jobs.",
  input_schema: {
    type: "object" as const,
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The job id being scored." },
            score: { type: "integer", description: "Match score 0-100." },
            explanation: { type: "string", description: "One concise sentence on the fit." },
            missingSkills: {
              type: "array",
              items: { type: "string" },
              description: "Skills the role needs that the CV doesn't show. Do NOT include skills the candidate already has. Empty if none.",
            },
            requiredLanguages: {
              type: "array",
              items: { type: "string", enum: ["de", "en"] },
              description:
                "Languages the job explicitly REQUIRES of the candidate. Use 'de' only when German is required (phrases like 'Deutschkenntnisse erforderlich', 'fließend Deutsch', 'verhandlungssicheres Deutsch', 'muttersprachlich Deutsch', 'C1/C2 Deutsch', 'German fluency', 'German-speaking required'). Use 'en' only when English is explicitly required. Return [] when no language requirement is stated — per the product rule, an empty array means English is sufficient.",
            },
          },
          required: ["id", "score", "explanation", "missingSkills", "requiredLanguages"],
        },
      },
    },
    required: ["scores"],
  },
};

export const claudeProvider: AiProvider = {
  id: "claude",
  label: "Claude (Anthropic)",

  async isConfigured() {
    return Boolean(await getPlatformCredential(ENV_KEY));
  },

  async ping() {
    // Cheap, generation-free liveness + key validity check.
    const anthropic = await client();
    await anthropic.models.list({ limit: 1 });
  },

  async parseCvProfile(rawText: string): Promise<ParsedCvProfile> {
    const anthropic = await client();
    const response = await anthropic.messages.create({
      model: CLAUDE_MODELS.cvParse,
      max_tokens: 2048,
      tools: [CV_TOOL],
      tool_choice: { type: "tool", name: "save_cv_profile" },
      messages: [
        {
          role: "user",
          content: `Extract a structured profile from this CV. Focus on what's relevant for matching roles.\n\n--- CV TEXT ---\n${rawText.slice(0, 24000)}`,
        },
      ],
    });
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("CV parsing failed: model did not return structured data.");
    }
    return normalizeCvProfile(block.input as Partial<ParsedCvProfile>);
  },

  async scoreBatch(systemPrompt: string, userPrompt: string): Promise<RawJobScore[]> {
    const anthropic = await client();
    // Bound each batch so a slow/hung scoring call can't blow the refresh
    // function cap. The SDK's default (10-min timeout, 2 retries) would let one
    // stuck batch run far past the request budget; unscored jobs are simply
    // dropped and re-fetched next refresh, so failing fast is the right move.
    const response = await anthropic.messages.create(
      {
        model: CLAUDE_MODELS.scoring,
        max_tokens: 2048,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools: [SCORE_TOOL],
        tool_choice: { type: "tool", name: "save_scores" },
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: 20_000, maxRetries: 1 },
    );
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return [];
    const input = block.input as { scores?: RawJobScore[] };
    return input.scores ?? [];
  },
};
