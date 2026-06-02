import nodemailer from "nodemailer";
import type { ContactMessageCategory } from "@/generated/prisma/enums";
import { getAppSetting, getPlatformCredential } from "@/lib/platform";

// SERVER-ONLY. Email delivery with three transports, tried in order:
//   1. SMTP (admin-configured in System Settings) via nodemailer
//   2. Resend REST API (RESEND_API_KEY)
//   3. console log (dev fallback)

export type SmtpConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
};

const DEFAULT_SMTP: SmtpConfig = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  user: "",
  from: "",
};

const SETTING_KEY = "smtp";
/** Canonical name for the SMTP password secret (DB → env fallback). */
export const SMTP_PASSWORD_KEY = "SMTP_PASSWORD";

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const v = await getAppSetting<Partial<SmtpConfig>>(SETTING_KEY, DEFAULT_SMTP);
  return { ...DEFAULT_SMTP, ...v };
}

export type SendResult = { ok: boolean; via: "smtp" | "resend" | "console"; error?: string };

async function sendViaResend(opts: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Matchwerk <onboarding@resend.dev>",
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const error = `${res.status} ${await res.text()}`;
      console.error("[email] Resend send failed:", error);
      return { ok: false, via: "resend", error };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    return { ok: false, via: "resend", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const smtp = await getSmtpConfig();

  if (smtp.enabled && smtp.host) {
    try {
      const pass = await getPlatformCredential(SMTP_PASSWORD_KEY);
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass } : undefined,
      });
      await transport.sendMail({
        from: smtp.from || smtp.user,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      return { ok: true, via: "smtp" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("[email] SMTP send failed:", error);
      return { ok: false, via: "smtp", error };
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return sendViaResend({ apiKey: resendKey, ...opts });
  }

  console.log(`[email] no transport configured — would send "${opts.subject}" to ${opts.to}`);
  return { ok: true, via: "console" };
}

export async function sendPasswordResetEmail(to: string, link: string): Promise<void> {
  const result = await sendEmail({
    to,
    subject: "Reset your Matchwerk password",
    html: `
      <p>We received a request to reset your Matchwerk password.</p>
      <p><a href="${link}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request it, you can safely ignore this email.</p>
    `,
  });
  // Dev convenience: when nothing is configured, surface the link server-side.
  if (result.via === "console") {
    console.log(`[password-reset] reset link for ${to}: ${link}`);
  }
}

export async function sendTestEmail(to: string): Promise<SendResult> {
  return sendEmail({
    to,
    subject: "Matchwerk — SMTP test",
    html: "<p>This is a test email from Matchwerk. If you received it, your SMTP settings work. ✅</p>",
  });
}

/** Human-readable label for each ContactMessageCategory value. */
const CATEGORY_LABELS: Record<ContactMessageCategory, string> = {
  QUESTION: "Question",
  BUG: "Bug",
  FEATURE_REQUEST: "Feature request",
  OTHER: "Other",
};

/** Minimal HTML escaping for user-supplied text rendered into the email body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Notify the admin that a signed-in user submitted a /contact form. The
 * outgoing subject is prefixed `[Matchwerk · <Category>]` so the admin can
 * filter by category in their own email client. The body links back to
 * `/admin/messages/<id>` so they can mark-read / mark-replied in the UI.
 */
export async function sendContactNotification(opts: {
  to: string;
  from: { name: string; email: string };
  subject: string;
  category: ContactMessageCategory;
  body: string;
  adminUrl: string;
}): Promise<SendResult> {
  const label = CATEGORY_LABELS[opts.category] ?? "Question";
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px;">
      <p style="margin:0 0 12px;color:#6b5f86;font-size:12px;letter-spacing:.06em;text-transform:uppercase;">
        New ${escapeHtml(label.toLowerCase())} via Matchwerk contact form
      </p>
      <p style="margin:0 0 4px;font-size:16px;"><strong>${escapeHtml(opts.from.name || opts.from.email)}</strong></p>
      <p style="margin:0 0 16px;font-size:14px;color:#6b5f86;">${escapeHtml(opts.from.email)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#6b5f86;">Subject</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;">${escapeHtml(opts.subject)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#6b5f86;">Message</p>
      <div style="margin:0 0 24px;font-size:15px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.body)}</div>
      <p style="margin:0;">
        <a href="${escapeHtml(opts.adminUrl)}"
           style="display:inline-block;padding:10px 16px;background:#1A1233;color:#F5F1E8;text-decoration:none;border-radius:8px;font-size:14px;">
          Open in admin inbox
        </a>
      </p>
    </div>
  `;
  return sendEmail({
    to: opts.to,
    subject: `[Matchwerk · ${label}] ${opts.subject}`,
    html,
  });
}
