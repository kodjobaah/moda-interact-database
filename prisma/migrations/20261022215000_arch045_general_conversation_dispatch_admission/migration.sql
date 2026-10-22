-- ARCH-045-DATABASE-004: Admit controlled outbound messages from both recovery
-- and non-recovery conversations. This removes only the recovery association
-- predicate; it does not change how conversations are created.
--
-- Preserve all ARCH-040 immutable-message and control-mode/revision checks.
-- No trigger recreation or schema changes are required: the installed trigger
-- references this function by identity. Background owns shop/recipient STOP
-- serialization; this database guard does not replace that send-time check.
--
-- This migration is forward-only. Do not modify the original ARCH-040 migration.
CREATE OR REPLACE FUNCTION "whatsapp".arch040_message_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."providerDispatchKey" IS NOT NULL AND
     ROW(NEW."providerDispatchKey",NEW."providerDispatchAdmittedAt",NEW."providerDispatchControlRevision") IS DISTINCT FROM
     ROW(OLD."providerDispatchKey",OLD."providerDispatchAdmittedAt",OLD."providerDispatchControlRevision") THEN
    RAISE EXCEPTION 'ARCH040 admitted message identity cannot change' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."providerDispatchKey" IS NOT NULL AND
     ROW(NEW."conversationId",NEW."senderType",NEW."direction",NEW."content") IS DISTINCT FROM
     ROW(OLD."conversationId",OLD."senderType",OLD."direction",OLD."content") THEN
    RAISE EXCEPTION 'ARCH040 admitted message content and sender immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."providerDispatchKey" IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD."providerDispatchKey" IS NULL) AND
     (NEW."providerDispatchControlRevision" < 0 OR NOT EXISTS (
       SELECT 1 FROM "whatsapp"."Conversation" c WHERE c."id"=NEW."conversationId"
         AND c."controlRevision"=NEW."providerDispatchControlRevision"
         AND c."controlMode"=(CASE WHEN NEW."senderType"='HUMAN' THEN 'HUMAN'::"whatsapp"."ConversationControlMode" ELSE 'AI'::"whatsapp"."ConversationControlMode" END)
     )) THEN
    RAISE EXCEPTION 'ARCH040 outbound admission must match current recovery control' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
