import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/generated/prisma/enums";

// Edge-safe Auth.js config. This is the slice that the middleware loads, so it
// MUST NOT import Prisma, bcrypt, or any Node-only dependency. Providers and the
// Prisma adapter are added in `src/auth.ts` (Node runtime) only.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    // Runs in middleware on every matched page route. Gate the app behind a
    // session; bounce already-authenticated users away from the auth pages.
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthPage =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/register") ||
        nextUrl.pathname.startsWith("/forgot-password") ||
        nextUrl.pathname.startsWith("/reset-password");

      if (isAuthPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    // `token.sub` is the user id (set automatically by NextAuth for both the
    // Credentials and Google providers). Surface id + role on the session.
    // `token.role` is resolved (with DB lookup) in the jwt callback in auth.ts.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = (token as { role?: UserRole }).role ?? "USER";
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
