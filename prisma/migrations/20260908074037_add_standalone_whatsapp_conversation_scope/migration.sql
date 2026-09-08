/*
  Warnings:

  - A unique constraint covering the columns `[standaloneScopeKey]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "whatsapp"."Conversation" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "shopId" TEXT,
ADD COLUMN     "standaloneScopeKey" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_standaloneScopeKey_key" ON "whatsapp"."Conversation"("standaloneScopeKey");

-- CreateIndex
CREATE INDEX "Conversation_shopId_customerId_type_outcome_idx" ON "whatsapp"."Conversation"("shopId", "customerId", "type", "outcome");

-- CreateIndex
CREATE INDEX "Conversation_customerId_lastMessageAt_idx" ON "whatsapp"."Conversation"("customerId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddConstraint
ALTER TABLE "whatsapp"."Conversation"
ADD CONSTRAINT "Conversation_standalone_scope_invariant"
CHECK (
  "standaloneScopeKey" IS NULL
  OR (
    "shopId" IS NOT NULL
    AND "customerId" IS NOT NULL
    AND "checkoutRecoveryId" IS NULL
  )
);
