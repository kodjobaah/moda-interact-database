DROP INDEX "whatsapp"."Conversation_checkoutRecoveryId_type_key";
CREATE UNIQUE INDEX "Conversation_checkoutRecoveryId_key" ON "whatsapp"."Conversation"("checkoutRecoveryId");