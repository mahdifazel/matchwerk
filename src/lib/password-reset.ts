import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Password reset tokens, stored HASHED in the existing Auth.js
// `VerificationToken` table (identifier namespaced with `password-reset:`), so
// no new table/migration is needed. The raw token only ever lives in the email
// link; the DB holds its SHA-256 hash.

const PREFIX = "password-reset:";
const TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Creates a single-use reset token for the email if an account exists, returning
 * the raw token for the email link (or null if no account). Any prior reset
 * tokens for the email are invalidated first.
 */
export async function createResetToken(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  if (!user) return null;

  const identifier = PREFIX + normalized;
  const raw = randomBytes(32).toString("hex");
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({
    data: { identifier, token: hashToken(raw), expires: new Date(Date.now() + TTL_MS) },
  });
  return raw;
}

export type ResetResult = { ok: true } | { ok: false; error: string };

/** Verifies a raw reset token and sets the new password. Single-use. */
export async function consumeResetToken(
  rawToken: string,
  newPassword: string,
): Promise<ResetResult> {
  const record = await prisma.verificationToken.findFirst({
    where: { token: hashToken(rawToken) },
  });
  if (!record || !record.identifier.startsWith(PREFIX)) {
    return { ok: false, error: "This reset link is invalid or has already been used." };
  }
  if (record.expires < new Date()) {
    await prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } });
    return { ok: false, error: "This reset link has expired. Request a new one." };
  }

  const email = record.identifier.slice(PREFIX.length);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { email }, data: { password: passwordHash } });
  // Single-use: clear every reset token for this identifier.
  await prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } });
  return { ok: true };
}
