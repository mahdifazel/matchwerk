import type { DefaultSession } from "next-auth";

// Surface the user id on the session so server code can scope queries by user.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
