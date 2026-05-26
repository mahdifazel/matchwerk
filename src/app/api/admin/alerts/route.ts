import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { evaluateBudgetAlerts } from "@/lib/budget";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json({ alerts: await evaluateBudgetAlerts() });
}
