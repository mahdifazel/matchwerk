import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { getAnalytics } from "@/lib/analytics";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  return NextResponse.json(await getAnalytics());
}
