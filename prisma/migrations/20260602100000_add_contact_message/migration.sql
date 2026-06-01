-- Contact-us feature: lets signed-in users submit messages to the admin
-- inbox at /admin/messages. The two enums + one table are fully additive;
-- nothing existing changes.

-- ContactMessage triage stage (admin inbox status).
CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'READ', 'REPLIED');

-- ContactMessage triage bucket (what kind of message).
CREATE TYPE "ContactMessageCategory" AS ENUM ('QUESTION', 'BUG', 'FEATURE_REQUEST', 'OTHER');

CREATE TABLE "ContactMessage" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  -- Snapshot the submitter's identity at send time. The FK below cascades on
  -- user delete, but until that happens these columns let the admin see a
  -- stable "from" line even if the user's profile later changes.
  "name"      TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "category"  "ContactMessageCategory" NOT NULL DEFAULT 'QUESTION',
  "body"      TEXT NOT NULL,
  "status"    "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"    TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),

  CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContactMessage"
  ADD CONSTRAINT "ContactMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");
CREATE INDEX "ContactMessage_userId_createdAt_idx" ON "ContactMessage"("userId", "createdAt");
