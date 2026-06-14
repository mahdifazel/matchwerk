-- CreateEnum
CREATE TYPE "InterviewStage" AS ENUM ('RECRUITER_SCREEN', 'HIRING_MANAGER', 'TECHNICAL', 'TAKE_HOME', 'PANEL', 'FINAL', 'WAITING_DECISION');

-- CreateEnum
CREATE TYPE "ArchiveReason" AS ENUM ('REJECTED', 'WITHDRAWN', 'CLOSED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "archiveReason" "ArchiveReason",
ADD COLUMN     "interviewStage" "InterviewStage";
