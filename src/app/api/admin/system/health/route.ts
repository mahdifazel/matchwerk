import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { checkAllApis } from "@/lib/health";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const results = await checkAllApis();
  return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
