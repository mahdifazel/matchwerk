"use client";

import { useEffect, useState } from "react";
import type { SourceStatusDTO } from "@/lib/types";

/** Fetches runtime source status (adapter implemented + API keys configured). */
export function useSourceStatus(): Map<string, SourceStatusDTO> {
  const [statuses, setStatuses] = useState<SourceStatusDTO[]>([]);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setStatuses(d.sources ?? []))
      .catch(() => setStatuses([]));
  }, []);

  return new Map(statuses.map((s) => [s.id, s]));
}
