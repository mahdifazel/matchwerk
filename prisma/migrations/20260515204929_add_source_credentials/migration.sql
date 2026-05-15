-- CreateTable
CREATE TABLE "SourceCredential" (
    "sourceId" "JobSourceId" NOT NULL,
    "secrets" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCredential_pkey" PRIMARY KEY ("sourceId")
);
