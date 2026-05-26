import { prisma } from "@/lib/prisma";

/**
 * Records one AI provider attempt. Fire-and-forget semantics: a logging failure
 * must never break the actual AI call, so all errors are swallowed.
 */
export async function logAiAttempt(entry: {
  provider: string;
  operation?: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}): Promise<void> {
  try {
    await prisma.requestLog.create({
      data: {
        kind: "ai",
        provider: entry.provider,
        operation: entry.operation ?? null,
        ok: entry.ok,
        durationMs: Math.round(entry.durationMs),
        error: entry.error?.slice(0, 500) ?? null,
      },
    });
  } catch {
    // Intentionally ignored.
  }
}
