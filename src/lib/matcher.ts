import type { Profile } from "@/generated/prisma/client";
import type { JobType, Seniority } from "@/generated/prisma/enums";
import { getAnthropic, MODELS } from "./anthropic";

export type JobToScore = {
  id: string;
  title: string;
  company: string;
  location: string;
};

export type ScoringPreferences = {
  /** Seniority levels the user opted into in Settings. */
  preferredSeniority: Seniority[];
  /** Job types the user opted into in Settings. */
  preferredJobTypes: JobType[];
  /** Location IDs the user opted into in Settings (e.g. "berlin", "remote"). */
  preferredLocations: string[];
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

function buildSystemPrompt(
  profile: Profile,
  jobTitles: string[],
  prefs: ScoringPreferences,
): string {
  // Derive the candidate's professional identity from the CV + their chosen
  // titles. Never hardcode a profession here — the matcher must follow the
  // current profile so swapping a CV for a different role retargets scoring.
  const primaryRole = jobTitles[0] ?? "the role above";
  const lines: string[] = [
    `You are a job-matching engine for a ${primaryRole} searching in Germany.`,
    "The candidate's profession is whatever their CV profile says it is — do not assume any specific industry or role beyond what's described below.",
    "Score how well each job fits the candidate on a 0-100 scale, where 100 is a perfect fit.",
    "Weigh: title/role alignment with the target titles, seniority fit, skill and tool overlap, industry relevance, and explicit user preferences below.",
    "Penalize jobs that are in an unrelated profession from the candidate's CV, even if some surface keywords match.",
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
  ];
  if (
    prefs.preferredSeniority.length > 0 ||
    prefs.preferredJobTypes.length > 0 ||
    prefs.preferredLocations.length > 0
  ) {
    lines.push("", "=== USER PREFERENCES (from Settings) ===");
    if (prefs.preferredSeniority.length > 0) {
      lines.push(`Open to seniority: ${prefs.preferredSeniority.join(", ")}`);
    }
    if (prefs.preferredJobTypes.length > 0) {
      lines.push(`Open to job types: ${prefs.preferredJobTypes.join(", ")}`);
    }
    if (prefs.preferredLocations.length > 0) {
      lines.push(`Preferred locations: ${prefs.preferredLocations.join(", ")}`);
    }
    lines.push(
      "Penalize jobs that contradict these preferences; reward jobs that fit them.",
    );
  }
  return lines.join("\n");
}

async function scoreBatch(
  profile: Profile,
  jobTitles: string[],
  prefs: ScoringPreferences,
  batch: JobToScore[],
): Promise<Map<string, JobScore>> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: MODELS.scoring,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(profile, jobTitles, prefs),
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

/** Score every job against the CV profile and the user's settings preferences. */
export async function scoreJobs(
  profile: Profile,
  jobTitles: string[],
  prefs: ScoringPreferences,
  jobs: JobToScore[],
): Promise<Map<string, JobScore>> {
  const scores = new Map<string, JobScore>();
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchScores = await scoreBatch(profile, jobTitles, prefs, batch);
    for (const [id, score] of batchScores) scores.set(id, score);
  }
  return scores;
}
