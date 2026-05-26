import { prisma } from "@/lib/prisma";

// SERVER-ONLY. Assembles a user's personal data for a GDPR export. Sensitive
// fields are stripped: password hash, OAuth tokens, and credential secrets.

export async function collectUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      emailVerified: true,
      role: true,
      disabledAt: true,
      tokenBalance: true,
      tokenDebt: true,
      tokensGrantedAt: true,
      createdAt: true,
      updatedAt: true,
      accounts: { select: { provider: true, providerAccountId: true, type: true } },
      profile: true,
      settings: true,
      jobs: true,
      ledger: true,
      credentials: { select: { id: true, sourceId: true, updatedAt: true } },
    },
  });
  if (!user) return null;

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      role: user.role,
      disabledAt: user.disabledAt,
      tokenBalance: user.tokenBalance,
      tokenDebt: user.tokenDebt,
      tokensGrantedAt: user.tokensGrantedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    // OAuth links — provider identity only, never the tokens.
    signInMethods: user.accounts,
    profile: user.profile,
    settings: user.settings,
    jobs: user.jobs,
    tokenLedger: user.ledger,
    // Legacy per-user source credentials (normally none) — secrets omitted.
    sourceCredentials: user.credentials,
  };
}

/** A downloadable JSON Response for a collected payload. */
export function jsonDownload(data: unknown, filename: string): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
