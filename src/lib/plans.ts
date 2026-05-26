/**
 * Token top-up plan TYPE + display helpers. CLIENT-SAFE (no DB, no secrets).
 *
 * The plan DATA is now stored in the `Plan` table and is admin-editable — read
 * it server-side via `src/lib/plans-repo.ts` (`getActivePlans` / `getPlanById`).
 * The pricing page fetches active plans and passes them to the client table.
 */

export type Plan = {
  id: string;
  name: string;
  /** Price in euros. */
  priceEur: number;
  /** Tokens credited on purchase. */
  tokens: number;
  /** How long the tokens stay valid, in months. */
  durationMonths: number;
  /** One-line positioning shown under the name. */
  tagline: string;
  /** The single emphasized plan — visually highlighted and badged "Recommended". */
  recommended?: boolean;
};

/**
 * Balance below which the header pill and the board switch to their "top up"
 * state. ~30 leaves a user short of a CV parse (25) or a meaningful search.
 */
export const LOW_TOKEN_THRESHOLD = 30;

/** "€9.99" / "€25.00" — always two decimals. */
export function formatEur(value: number): string {
  return `€${value.toFixed(2)}`;
}

/** "valid 1 month" / "valid 2 months" */
export function formatValidity(months: number): string {
  return `valid ${months} month${months === 1 ? "" : "s"}`;
}
