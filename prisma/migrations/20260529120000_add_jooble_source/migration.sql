-- Add JOOBLE as a new value of the JobSourceId enum so the new Jooble adapter
-- (src/lib/sources/jooble.ts) can persist its rows. Postgres 12+ allows
-- ALTER TYPE … ADD VALUE outside a transaction, which is what Prisma's
-- migrate runner does for raw SQL files.
ALTER TYPE "JobSourceId" ADD VALUE 'JOOBLE';
