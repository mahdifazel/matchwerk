"use client";

import { useCallback, useEffect, useState } from "react";
import type { SourceStatusDTO } from "@/lib/types";

/**
 * Fetches runtime source status (adapter implemented + credentials present).
 * Returns the map plus a refetch function so callers can refresh after
 * mutations (e.g. saving a credential in the editor).
 */
export function useSourceStatus(): {
  statuses: Map<string, SourceStatusDTO>;
  refetch: () => void;
} {
  const [statuses, setStatuses] = useState<SourceStatusDTO[]>([]);

  const refetch = useCallback(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setStatuses(d.sources ?? []))
      .catch(() => setStatuses([]));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { statuses: new Map(statuses.map((s) => [s.id, s])), refetch };
}
