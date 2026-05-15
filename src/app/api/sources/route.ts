import { NextResponse } from "next/server";
import { ALL_SOURCES } from "@/lib/sources";

/** Runtime status of every source: implemented and whether its API keys are set. */
export async function GET() {
  const sources = ALL_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    tier: s.tier,
    connected: s.connected,
    configured: s.configured(),
  }));
  return NextResponse.json({ sources });
}
