-- CreateEnum
CREATE TYPE "JobSourceId" AS ENUM ('BA_JOBBOERSE', 'INDEED', 'LINKEDIN', 'STEPSTONE', 'XING', 'GLASSDOOR', 'MONSTER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'STARRED', 'APPLIED', 'DELETED');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('JUNIOR', 'MID', 'SENIOR', 'LEAD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "fileName" TEXT NOT NULL,
    "rawCvText" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "skills" TEXT[],
    "tools" TEXT[],
    "industries" TEXT[],
    "keywords" TEXT[],
    "seniority" "Seniority" NOT NULL DEFAULT 'UNKNOWN',
    "yearsExperience" INTEGER NOT NULL DEFAULT 0,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "jobTitles" TEXT[],
    "defaultLocations" TEXT[],
    "defaultSeniority" "Seniority"[],
    "defaultJobTypes" "JobType"[],
    "defaultSources" "JobSourceId"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "source" "JobSourceId" NOT NULL,
    "externalId" TEXT NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "jobType" "JobType" NOT NULL DEFAULT 'UNKNOWN',
    "seniority" "Seniority" NOT NULL DEFAULT 'UNKNOWN',
    "publishedAt" TIMESTAMP(3),
    "matchScore" INTEGER,
    "matchExplanation" TEXT,
    "missingSkills" TEXT[],
    "scoredAt" TIMESTAMP(3),
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "appliedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeHash_key" ON "Job"("dedupeHash");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_source_idx" ON "Job"("source");
