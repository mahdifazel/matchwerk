import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the test DB url BEFORE anything imports @/lib/prisma (the Prisma adapter
// reads DATABASE_URL at module load). `override` so a stray dev DATABASE_URL in
// the shell can't redirect the suite at the real database.
loadEnv({ path: ".env.test", override: true });

export default defineConfig({
  // Resolve the @/* and @test/* tsconfig path aliases (Vite-native, no plugin).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    // The billing tests share one Postgres and reset it between cases, so they
    // must not run in parallel across files.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      // Routes/guards branch on NODE_ENV; keep it out of "development" so Prisma
      // doesn't attach the noisy dev logger.
      NODE_ENV: "test",
    },
  },
});
