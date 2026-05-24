import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Next.js 16 "Proxy" (formerly Middleware). Runs on the edge, so it uses only
// the edge-safe config (no Prisma/bcrypt). The `authorized` callback in
// auth.config.ts decides what to allow.
export default NextAuth(authConfig).auth;

export const config = {
  // Protect every page route. Exclude all API routes (they self-guard with a
  // JSON 401 via getSessionUserId), Next internals, and static files (anything
  // with a file extension).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.).*)",
  ],
};
