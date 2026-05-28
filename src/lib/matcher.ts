import type { Profile } from "@/generated/prisma/client";
import type { JobType, Seniority } from "@/generated/prisma/enums";
import { runWithAi } from "@/lib/ai";

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
  const systemPrompt = buildSystemPrompt(profile, jobTitles, prefs);
  const userPrompt = `Score these jobs:\n\n${batch
    .map(
      (j) =>
        `id: ${j.id}\ntitle: ${j.title}\ncompany: ${j.company}\nlocation: ${j.location}`,
    )
    .join("\n\n")}`;

  const raw = await runWithAi(
    (provider) => provider.scoreBatch(systemPrompt, userPrompt),
    "scoring",
  );

  const result = new Map<string, JobScore>();
  for (const s of raw) {
    if (!s || typeof s.id !== "string") continue;
    result.set(s.id, {
      score: Math.max(0, Math.min(100, Math.round(s.score))),
      explanation: typeof s.explanation === "string" ? s.explanation : "",
      missingSkills: Array.isArray(s.missingSkills) ? s.missingSkills : [],
    });
  }
  return result;
}

/**
 * Max scoring batches in flight at once. Tuned for two constraints:
 *  - Anthropic's "concurrent connections" rate limit (firing all ~15 batches
 *    at once tripped it: HTTP 429 rate_limit_error on the over-spill).
 *  - Vercel's 60s function cap (the previous fully-sequential loop blew it).
 * 4 in flight finishes a 150-job refresh in ~4 waves × ~7s ≈ 28s, well inside
 * the cap and below most provider tiers' connection ceilings.
 */
const SCORING_CONCURRENCY = 4;

/**
 * Score every job against the CV profile and the user's settings preferences.
 * Batches run with bounded concurrency; `Promise.allSettled` keeps a single
 * batch's transient error from sinking the whole run — surviving batches'
 * scores are still applied; unscored jobs persist with `matchScore: null`.
 */
export async function scoreJobs(
  profile: Profile,
  jobTitles: string[],
  prefs: ScoringPreferences,
  jobs: JobToScore[],
): Promise<Map<string, JobScore>> {
  const batches: JobToScore[][] = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  const scores = new Map<string, JobScore>();
  for (let i = 0; i < batches.length; i += SCORING_CONCURRENCY) {
    const wave = batches.slice(i, i + SCORING_CONCURRENCY);
    const settled = await Promise.allSettled(
      wave.map((b) => scoreBatch(profile, jobTitles, prefs, b)),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        for (const [id, score] of r.value) scores.set(id, score);
      } else {
        console.error("[matcher] scoring batch failed:", r.reason);
      }
    }
  }
  return scores;
}
