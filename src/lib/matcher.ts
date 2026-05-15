import type { Profile } from "@/generated/prisma/client";
import { getAnthropic, MODELS } from "./anthropic";

export type JobToScore = {
  id: string;
  title: string;
  company: string;
  location: string;
};

export type JobScore = {
  score: number;
  explanation: string;
  missingSkills: string[];
};

const BATCH_SIZE = 10;

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
            score: {
              type: "integer",
              description: "Match score 0-100 (how well this job fits the candidate).",
            },
            explanation: {
              type: "string",
              description:
                "One concise sentence explaining why this job matches (or doesn't).",
            },
            missingSkills: {
              type: "array",
              items: { type: "string" },
              description:
                "Skills/requirements the role likely needs that the CV doesn't show. Empty if none.",
            },
          },
          required: ["id", "score", "explanation", "missingSkills"],
        },
      },
    },
    required: ["scores"],
  },
};

function buildSystemPrompt(profile: Profile, jobTitles: string[]): string {
  return [
    "You are a job-matching engine for a Product Designer searching in Germany.",
    "Score how well each job fits the candidate on a 0-100 scale, where 100 is a perfect fit.",
    "Weigh: title/role alignment with the target titles, seniority fit, skill and tool overlap, and industry relevance.",
    "Be discerning — most jobs should land in the 40-85 range; reserve 90+ for genuinely strong fits.",
    "",
    "=== TARGET JOB TITLES ===",
    jobTitles.join(", "),
    "",
    "=== CANDIDATE PROFILE ===",
    `Summary: ${profile.summary}`,
    `Seniority: ${profile.seniority}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Skills: ${profile.skills.join(", ")}`,
    `Tools: ${profile.tools.join(", ")}`,
    `Industries: ${profile.industries.join(", ")}`,
    `Keywords: ${profile.keywords.join(", ")}`,
  ].join("\n");
}

async function scoreBatch(
  profile: Profile,
  jobTitles: string[],
  batch: JobToScore[],
): Promise<Map<string, JobScore>> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODELS.scoring,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(profile, jobTitles),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "save_scores" },
    messages: [
      {
        role: "user",
        content: `Score these jobs:\n\n${batch
          .map(
            (j) =>
              `id: ${j.id}\ntitle: ${j.title}\ncompany: ${j.company}\nlocation: ${j.location}`,
          )
          .join("\n\n")}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  const result = new Map<string, JobScore>();
  if (!block || block.type !== "tool_use") return result;

  const input = block.input as {
    scores?: Array<{
      id: string;
      score: number;
      explanation: string;
      missingSkills: string[];
    }>;
  };
  for (const s of input.scores ?? []) {
    result.set(s.id, {
      score: Math.max(0, Math.min(100, Math.round(s.score))),
      explanation: s.explanation ?? "",
      missingSkills: s.missingSkills ?? [],
    });
  }
  return result;
}

/** Score every job against the CV profile. Batches requests to keep calls small. */
export async function scoreJobs(
  profile: Profile,
  jobTitles: string[],
  jobs: JobToScore[],
): Promise<Map<string, JobScore>> {
  const scores = new Map<string, JobScore>();
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchScores = await scoreBatch(profile, jobTitles, batch);
    for (const [id, score] of batchScores) scores.set(id, score);
  }
  return scores;
}
