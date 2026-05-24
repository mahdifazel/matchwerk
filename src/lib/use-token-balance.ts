"use client";

import { useCallback, useEffect, useState } from "react";

/** Window event fired after any action that changes the token balance. */
export const TOKENS_UPDATED_EVENT = "tokens-updated";

/** Dispatch from client code after a charging action (refresh, CV upload). */
export function notifyTokensUpdated() {
  window.dispatchEvent(new Event(TOKENS_UPDATED_EVENT));
}

/**
 * Reads the signed-in user's token balance, refetching whenever a
 * `tokens-updated` event fires. Returns null while loading or unauthenticated.
 */
export function useTokenBalance(): {
  balance: number | null;
  debt: number | null;
  refetch: () => void;
} {
  const [balance, setBalance] = useState<number | null>(null);
  const [debt, setDebt] = useState<number | null>(null);

  const refetch = useCallback(() => {
    fetch("/api/tokens")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setBalance(d?.balance ?? null);
        setDebt(d?.debt ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetch();
    window.addEventListener(TOKENS_UPDATED_EVENT, refetch);
    return () => window.removeEventListener(TOKENS_UPDATED_EVENT, refetch);
  }, [refetch]);

  return { balance, debt, refetch };
}

/** Formats a balance for display: integers as-is, otherwise one decimal. */
export function formatTokens(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
