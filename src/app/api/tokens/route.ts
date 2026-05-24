import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/repo";
import { getTokenAccount } from "@/lib/tokens";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  const { balance, debt } = await getTokenAccount(userId);
  return NextResponse.json({ balance, debt });
}
