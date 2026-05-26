-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ai',
    "provider" TEXT,
    "operation" TEXT,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_provider_idx" ON "RequestLog"("provider");
