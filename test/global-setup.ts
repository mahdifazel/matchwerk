import { execSync } from "node:child_process";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

/**
 * Runs once before the whole suite: ensure the test database exists and has the
 * latest schema. Creating it here means a fresh checkout only needs `npm run
 * db:up` (the Docker Postgres) and then `npm test` just works.
 */
export default async function setup() {
  loadEnv({ path: ".env.test", override: true });

  const testUrl = process.env.DATABASE_URL;
  if (!testUrl) {
    throw new Error("DATABASE_URL is not set — is .env.test present?");
  }

  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  // Safety rail: never let the suite operate on a non-test database (it
  // TRUNCATEs between cases).
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL must point at a *_test database (got "${dbName}").`,
    );
  }

  // Connect to the maintenance DB on the same server to CREATE DATABASE.
  const admin = new URL(testUrl);
  admin.pathname = "/jobhunter";
  admin.search = "";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    // 42P04 = duplicate_database — already created on a previous run.
    if (!(err && typeof err === "object" && "code" in err && err.code === "42P04")) {
      throw err;
    }
  } finally {
    await client.end();
  }

  // Apply migrations to the test DB. prisma.config.ts loads `.env` via
  // dotenv/config, which does NOT override an env var we set here, so the test
  // URL wins for this child process.
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
