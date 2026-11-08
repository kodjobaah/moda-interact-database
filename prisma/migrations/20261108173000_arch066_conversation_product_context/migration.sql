-- Disposable reference cache only. No backfill or change to Conversation ownership.
CREATE TABLE "whatsapp"."CommerceConversationProductContext" (
  "conversationId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "sourceInboundVersion" INTEGER NOT NULL,
  "references" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommerceConversationProductContext_pkey" PRIMARY KEY ("conversationId")
);
CREATE INDEX "CommerceConversationProductContext_shopId_expiresAt_idx" ON "whatsapp"."CommerceConversationProductContext"("shopId", "expiresAt");
ALTER TABLE "whatsapp"."CommerceConversationProductContext" ADD CONSTRAINT "CommerceConversationProductContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp"."CommerceConversationProductContext" ADD CONSTRAINT "CommerceConversationProductContext_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp"."CommerceConversationProductContext"
  ADD CONSTRAINT "CommerceConversationProductContext_schemaVersion_check" CHECK ("schemaVersion" = 1),
  ADD CONSTRAINT "CommerceConversationProductContext_revision_check" CHECK ("revision" >= 1),
  ADD CONSTRAINT "CommerceConversationProductContext_sourceInboundVersion_check" CHECK ("sourceInboundVersion" >= 0),
  ADD CONSTRAINT "CommerceConversationProductContext_references_bytes_check" CHECK (pg_column_size("references") <= 32768);
