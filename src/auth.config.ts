import type { NextAuthConfig } from "next-auth";

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
        nextUrl.pathname.startsWith("/register");

      if (isAuthPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      return isLoggedIn;
    },
    // `token.sub` is the user id (set automatically by NextAuth for both the
    // Credentials and Google providers). Surface it on the session.
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
