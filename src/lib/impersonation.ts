import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// SERVER-ONLY. A signed, httpOnly cookie that records an admin impersonating a
// user. Tamper-proof (HMAC over AUTH_SECRET) — but note the real protection is
// in repo.ts, which only honors it when the genuine JWT session belongs to an
// admin matching `adminId`. The cookie alone grants nothing.

const COOKIE = "mw_impersonate";

export type Impersonation = { adminId: string; targetId: string };

function secret(): string {
  return process.env.AUTH_SECRET ?? "insecure-dev-secret";
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

function encode(p: Impersonation): string {
  const b64 = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${b64}.${sign(b64)}`;
}

function decode(value: string): Impersonation | null {
  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;
  const expected = sign(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8"));
    if (typeof p?.adminId === "string" && typeof p?.targetId === "string") {
      return { adminId: p.adminId, targetId: p.targetId };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function readImpersonation(): Promise<Impersonation | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value ? decode(value) : null;
}

export async function setImpersonation(adminId: string, targetId: string): Promise<void> {
  (await cookies()).set(COOKIE, encode({ adminId, targetId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 2, // 2 hours
  });
}

export async function clearImpersonation(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
