-- ARCH-019: additive tenant-scoped browse and deterministic transcript indexes.
-- Ordinary index builds block writes on their table; schedule deployment accordingly.
CREATE INDEX "CheckoutRecovery_shopId_detectedAt_id_idx"
    ON "commerce"."CheckoutRecovery"("shopId", "detectedAt", "id");

CREATE INDEX "CheckoutRecovery_shopId_status_detectedAt_id_idx"
    ON "commerce"."CheckoutRecovery"("shopId", "status", "detectedAt", "id");

CREATE INDEX "CheckoutRecovery_shopId_customerId_detectedAt_id_idx"
    ON "commerce"."CheckoutRecovery"("shopId", "customerId", "detectedAt", "id");

CREATE INDEX "ConversationMessage_conversationId_createdAt_id_idx"
    ON "whatsapp"."ConversationMessage"("conversationId", "createdAt", "id");
