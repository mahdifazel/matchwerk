import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import authConfig from "@/auth.config";
import type { UserRole } from "@/generated/prisma/enums";
import { claimOrphanDataForFirstUser } from "@/lib/claim";
import { prisma } from "@/lib/prisma";
import { getTokenAccount } from "@/lib/tokens";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

/** Emails that should always be SUPER_ADMIN (bootstraps the first admin). */
function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolves a user's role at sign-in. If their email is in SUPER_ADMIN_EMAILS we
 * promote them in the DB (idempotent) so the bootstrap works even for accounts
 * created before the env var was set. Otherwise we read the stored role.
 */
async function resolveRole(userId: string, email?: string | null): Promise<UserRole> {
  if (email && superAdminEmails().includes(email.toLowerCase())) {
    await prisma.user.updateMany({
      where: { id: userId, role: { not: "SUPER_ADMIN" } },
      data: { role: "SUPER_ADMIN" },
    });
    return "SUPER_ADMIN";
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role ?? "USER";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });
        // No row, or an OAuth-only account with no password set.
        if (!user?.password) return null;
        // Deactivated accounts cannot sign in.
        if (user.disabledAt) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.password);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Runs in the Node runtime, so it can hit the DB. On sign-in (`user` set) we
    // resolve and bake the role into the token; the edge session callback then
    // surfaces it. Server-side admin guards still re-check the DB for authority,
    // so a stale token only affects client-side UI, never access control.
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.role = await resolveRole(user.id, user.email);
      }
      return token;
    },
  },
  events: {
    // Fires when the Prisma adapter creates a user — i.e. first Google sign-in.
    // Credentials registration claims orphans directly in /api/register.
    async createUser({ user }) {
      if (user.id) {
        await claimOrphanDataForFirstUser(user.id);
        await getTokenAccount(user.id); // apply the 150-token signup grant
      }
    },
  },
});
