-- AlterTable
ALTER TABLE "whatsapp"."Conversation"
ADD COLUMN "pendingTurnStartedAt" TIMESTAMP(3),
ADD COLUMN "processingInboundVersion" INTEGER,
ADD COLUMN "processingStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Conversation_processingStartedAt_idx" ON "whatsapp"."Conversation"("processingStartedAt");
