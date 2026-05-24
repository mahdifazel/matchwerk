import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import authConfig from "@/auth.config";
import { claimOrphanDataForFirstUser } from "@/lib/claim";
import { prisma } from "@/lib/prisma";
import { getTokenAccount } from "@/lib/tokens";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

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
