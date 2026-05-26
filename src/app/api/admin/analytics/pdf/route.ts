import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getAdminUser } from "@/lib/admin";
import { getAnalytics } from "@/lib/analytics";

const REASON_LABEL: Record<string, string> = {
  signup_grant: "Signup grants",
  cv_parse: "CV parsing",
  research: "Job research",
  purchase: "Purchases",
  admin_grant: "Admin grants",
  admin_deduct: "Admin deductions",
  refund: "Refunds",
};

const fmtTokens = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return new Response("Admins only.", { status: 403 });

  const a = await getAnalytics();
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.07, 0.2);
  const muted = rgb(0.42, 0.37, 0.52);

  const left = 48;
  let y = 800;
  const line = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: typeof ink; gap?: number } = {},
  ) => {
    page.drawText(text, {
      x: left,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? ink,
    });
    y -= opts.gap ?? 16;
  };
  const row = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 10, font, color: muted });
    page.drawText(value, { x: 360, y, size: 10, font: bold, color: ink });
    y -= 15;
  };
  const heading = (t: string) => {
    y -= 6;
    line(t, { size: 11, font: bold, gap: 18 });
  };

  line("Matchwerk — Platform Report", { size: 20, font: bold, gap: 10 });
  line(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · last 30 days`, {
    size: 9,
    color: muted,
    gap: 24,
  });

  heading("Overview");
  row("Total users", String(a.kpis.totalUsers));
  row("Active users", String(a.kpis.activeUsers));
  row("New users (30d)", String(a.kpis.newUsers30d));
  row("Searches (30d)", String(a.kpis.searches30d));
  row("Tokens used (30d)", fmtTokens(a.kpis.tokensConsumed30d));
  row("Revenue (30d)", `€${a.kpis.revenue30d.toFixed(2)}`);
  row("Revenue (all-time)", `€${a.kpis.revenueAllTime.toFixed(2)}`);
  row("Tokens sold", fmtTokens(a.kpis.tokensSold));
  row("Jobs stored", String(a.kpis.jobsStored));

  heading("Token flow by reason");
  for (const r of a.tokenFlowByReason) {
    row(REASON_LABEL[r.reason] ?? r.reason, `${r.delta > 0 ? "+" : ""}${fmtTokens(r.delta)}`);
  }

  heading("Jobs by source");
  for (const s of a.jobsBySource) row(s.source, String(s.count));

  heading("Most active users (by AI usage)");
  if (a.topUsers.length === 0) line("None yet.", { size: 10, color: muted });
  for (const u of a.topUsers) row(u.name || u.email, fmtTokens(u.tokensConsumed));

  heading("AI providers");
  if (a.aiProviders.length === 0) line("No AI requests recorded yet.", { size: 10, color: muted });
  for (const p of a.aiProviders) {
    row(p.provider, `${p.ok} ok${p.errors > 0 ? ` / ${p.errors} failed` : ""}`);
  }

  const bytes = await doc.save();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="matchwerk-report-${date}.pdf"`,
    },
  });
}
