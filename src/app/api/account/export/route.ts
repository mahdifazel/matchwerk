import { NextResponse } from "next/server";
import { collectUserData, jsonDownload } from "@/lib/gdpr";
import { getSessionUserId } from "@/lib/repo";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const data = await collectUserData(userId);
  if (!data) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const date = new Date().toISOString().slice(0, 10);
  return jsonDownload(data, `matchwerk-my-data-${date}.json`);
}
