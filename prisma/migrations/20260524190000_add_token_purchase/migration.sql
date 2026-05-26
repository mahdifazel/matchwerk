-- AlterTable
ALTER TABLE "TokenLedger" ADD COLUMN     "stripeSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TokenLedger_stripeSessionId_key" ON "TokenLedger"("stripeSessionId");
