-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "priceEur" DOUBLE PRECISION NOT NULL,
    "tokens" INTEGER NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- Seed the three plans previously hardcoded in src/lib/plans.ts.
INSERT INTO "Plan" ("id", "name", "tagline", "priceEur", "tokens", "durationMonths", "recommended", "sortOrder", "active", "updatedAt") VALUES
  ('starter', 'Starter', 'A month of focused searching.', 9.99, 1000, 1, false, 0, true, CURRENT_TIMESTAMP),
  ('plus', 'Plus', 'The balanced pick for an active hunt.', 19.99, 3000, 2, true, 1, true, CURRENT_TIMESTAMP),
  ('pro', 'Pro', 'Most tokens, longest runway.', 25.00, 5000, 3, false, 2, true, CURRENT_TIMESTAMP);
