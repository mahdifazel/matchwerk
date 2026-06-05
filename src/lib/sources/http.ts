/**
 * Per-request timeout for source HTTP calls. A slow or hanging upstream must
 * never consume the whole refresh budget — without this, one stalled API can
 * push `POST /api/jobs/refresh` past Vercel's function cap and 504 the run.
 */
export const SOURCE_FETCH_TIMEOUT_MS = 12_000;

/** `fetch` that aborts after `timeoutMs` (defaults to SOURCE_FETCH_TIMEOUT_MS). */
export function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = SOURCE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
