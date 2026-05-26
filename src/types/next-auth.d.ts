import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/generated/prisma/enums";

// Surface the user id + role on the session so server code can scope queries by
// user and the client can render role-aware UI (e.g. the Admin link).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
  }
}
