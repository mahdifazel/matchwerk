import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactNotification } from "@/lib/email";
import { checkContactMessage } from "@/lib/limits";
import { getAppSetting } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/repo";

// Auth-gated contact form submission. Body validation is intentionally strict
// (subject + category + body, hard-capped) so the admin inbox stays scannable.

const CATEGORIES = ["QUESTION", "BUG", "FEATURE_REQUEST", "OTHER"] as const;

const schema = z.object({
  subject: z.string().trim().min(1).max(120),
  category: z.enum(CATEGORIES),
  body: z.string().trim().min(1).max(2000),
});

/** AppSetting key + env fallback for the admin destination email. */
const CONTACT_TO_KEY = "contact_to";
const CONTACT_TO_ENV = "CONTACT_TO";

async function resolveContactTo(): Promise<string | null> {
  // DB setting takes precedence so admins can change it without a redeploy.
  const fromDb = await getAppSetting<string>(CONTACT_TO_KEY, "");
  if (fromDb) return fromDb;
  return process.env[CONTACT_TO_ENV] ?? null;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }

  const gate = await checkContactMessage(user.id);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      { status: 400 },
    );
  }

  const message = await prisma.contactMessage.create({
    data: {
      userId: user.id,
      // Snapshot identity at send time so the admin inbox stays accurate
      // even if the user later renames or deletes their account.
      name: user.name ?? user.email,
      email: user.email,
      subject: parsed.data.subject,
      category: parsed.data.category,
      body: parsed.data.body,
    },
    select: { id: true },
  });

  // Notify the admin — best-effort, the message is already saved so a failed
  // email doesn't fail the request. The admin can still see it in the inbox.
  const to = await resolveContactTo();
  if (to) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      "http://localhost:3000";
    const adminUrl = `${baseUrl.replace(/\/$/, "")}/admin/messages/${message.id}`;
    await sendContactNotification({
      to,
      from: { name: user.name ?? "", email: user.email },
      subject: parsed.data.subject,
      category: parsed.data.category,
      body: parsed.data.body,
      adminUrl,
    });
  } else {
    console.warn(
      `[contact] no contact destination configured — message ${message.id} saved without email`,
    );
  }

  return NextResponse.json({ ok: true });
}
