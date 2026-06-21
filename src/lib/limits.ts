import { getAppSetting, setAppSetting } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { getTokenAccount, TOKEN } from "@/lib/tokens";

// SERVER-ONLY. Balance gates + admin-configurable rate limits for the two
// expensive AI actions (CV parse, job research). Counts recent actions from the
// TokenLedger (reason rows are timestamped) — no extra table needed.

export type RateLimits = {
  /** Max Research runs per rolling hour (0 = unlimited). */
  researchPerHour: number;
  /** Max CV uploads per rolling day (0 = unlimited). */
  cvPerDay: number;
};

const DEFAULTS: RateLimits = { researchPerHour: 10, cvPerDay: 5 };
const SETTING_KEY = "rate_limits";

export async function getRateLimits(): Promise<RateLimits> {
  const v = await getAppSetting<Partial<RateLimits>>(SETTING_KEY, DEFAULTS);
  return {
    researchPerHour: v.researchPerHour ?? DEFAULTS.researchPerHour,
    cvPerDay: v.cvPerDay ?? DEFAULTS.cvPerDay,
  };
}

export async function setRateLimits(v: RateLimits): Promise<void> {
  await setAppSetting<RateLimits>(SETTING_KEY, v);
}

export type ScoringLimits = {
  /**
   * Max fresh jobs sent to AI scoring per Research run — the main cost/coverage
   * knob. The lexical pre-rank keeps the strongest matches, so lowering this
   * drops only the weakest tail. Bounded by SCORING_BOUNDS below.
   */
  maxScoreCandidates: number;
};

/** Inclusive bounds for `maxScoreCandidates` (also enforced in the admin route). */
export const SCORING_BOUNDS = { min: 10, max: TOKEN.MAX_SEARCH_JOBS } as const;

const SCORING_DEFAULTS: ScoringLimits = {
  maxScoreCandidates: TOKEN.MAX_SCORE_CANDIDATES,
};
const SCORING_KEY = "scoring_limits";

export async function getScoringLimits(): Promise<ScoringLimits> {
  const v = await getAppSetting<Partial<ScoringLimits>>(
    SCORING_KEY,
    SCORING_DEFAULTS,
  );
  const raw = v.maxScoreCandidates ?? SCORING_DEFAULTS.maxScoreCandidates;
  // Clamp defensively so a hand-edited setting can never push scoring above the
  // search cap or below a usable floor.
  return {
    maxScoreCandidates: Math.min(
      SCORING_BOUNDS.max,
      Math.max(SCORING_BOUNDS.min, Math.round(raw)),
    ),
  };
}

export async function setScoringLimits(v: ScoringLimits): Promise<void> {
  await setAppSetting<ScoringLimits>(SCORING_KEY, v);
}

export type GateResult =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

function countSince(userId: string, reason: string, since: Date): Promise<number> {
  return prisma.tokenLedger.count({
    where: { userId, reason, createdAt: { gte: since } },
  });
}

/**
 * CV upload gate: requires a balance of at least CV_PARSE (25) tokens, then the
 * per-day rate limit.
 */
export async function checkCvUpload(userId: string): Promise<GateResult> {
  const { balance } = await getTokenAccount(userId);
  if (balance < TOKEN.CV_PARSE) {
    return {
      allowed: false,
      status: 402,
      error: `You need at least ${TOKEN.CV_PARSE} tokens to parse a CV. Top up to continue.`,
    };
  }
  const { cvPerDay } = await getRateLimits();
  if (cvPerDay > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if ((await countSince(userId, "cv_parse", since)) >= cvPerDay) {
      return {
        allowed: false,
        status: 429,
        error: `CV upload limit reached (${cvPerDay}/day). Please try again later.`,
      };
    }
  }
  return { allowed: true };
}

/** Max contact messages a user can submit per rolling 24h (hard-coded). */
export const CONTACT_MESSAGES_PER_DAY = 5;

/**
 * Contact-form gate: a flat 5/day cap counted directly from the
 * `ContactMessage` table — no token cost or balance check applies (sending
 * feedback shouldn't cost the user anything). Spam-protection only.
 */
export async function checkContactMessage(userId: string): Promise<GateResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.contactMessage.count({
    where: { userId, createdAt: { gte: since } },
  });
  if (recent >= CONTACT_MESSAGES_PER_DAY) {
    return {
      allowed: false,
      status: 429,
      error: `You can send up to ${CONTACT_MESSAGES_PER_DAY} messages per day. Try again tomorrow.`,
    };
  }
  return { allowed: true };
}

/**
 * Research gate: requires a positive balance (blocked at exactly 0), then the
 * per-hour rate limit.
 */
export async function checkResearch(userId: string): Promise<GateResult> {
  const { balance } = await getTokenAccount(userId);
  if (balance <= 0) {
    return {
      allowed: false,
      status: 402,
      error: "You're out of tokens. Top up to research jobs.",
    };
  }
  const { researchPerHour } = await getRateLimits();
  if (researchPerHour > 0) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    if ((await countSince(userId, "research", since)) >= researchPerHour) {
      return {
        allowed: false,
        status: 429,
        error: `Search limit reached (${researchPerHour}/hour). Please try again later.`,
      };
    }
  }
  return { allowed: true };
}
