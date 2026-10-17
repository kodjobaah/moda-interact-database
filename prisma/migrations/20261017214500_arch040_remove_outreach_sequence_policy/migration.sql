-- ARCH-040-DATABASE-005: move mutable outreach-sequence/trigger eligibility
-- policy to the Background application layer. Preserve structural database
-- protections: positive sequence (ARCH-016), uniqueness per recovery,
-- tenant/recovery linkage, claim immutability, and provider-send fencing.
--
-- Forward-only correction. It is safe if the earlier proposed ARCH-040
-- trigger-compatibility migration was already applied: drop both names even
-- when the older constraint was recreated with updated trigger values.
ALTER TABLE "commerce"."RecoveryOutreachAttempt"
  DROP CONSTRAINT IF EXISTS "ck_arch016_outreach_trigger_sequence",
  DROP CONSTRAINT IF EXISTS "RecoveryOutreachAttempt_sequence_trigger_check";

-- Remove the hard-coded sequence-2 policy from the command guard as well.
-- A command must still link an existing attempt belonging to the SAME
-- recovery, and linked outbound-message identity must still be consistent.
-- The application remains responsible for deciding whether this attempt
-- is an eligible follow-up and what sequence maximum is configured.
CREATE OR REPLACE FUNCTION "whatsapp".arch040_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recovery_id TEXT;
DECLARE linked_dispatch_key TEXT;
BEGIN
  SELECT c."checkoutRecoveryId" INTO recovery_id FROM "whatsapp"."Conversation" c
    JOIN "commerce"."CheckoutRecovery" r ON r."id"=c."checkoutRecoveryId"
    WHERE c."id"=NEW."conversationId" AND r."shopId"=NEW."shopId"
      AND (c."shopId" IS NULL OR c."shopId"=NEW."shopId");
  IF recovery_id IS NULL THEN
    RAISE EXCEPTION 'ARCH040 command requires recovery owned by shop' USING ERRCODE='23514';
  END IF;
  IF NEW."recoveryOutreachAttemptId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "commerce"."RecoveryOutreachAttempt" a
    WHERE a."id"=NEW."recoveryOutreachAttemptId" AND a."checkoutRecoveryId"=recovery_id
      AND (NEW."outboundMessageId" IS NULL OR a."outboundMessageId" IS NULL
           OR NEW."outboundMessageId"=a."outboundMessageId")
  ) THEN
    RAISE EXCEPTION 'ARCH040 follow-up must refer to same recovery' USING ERRCODE='23514';
  END IF;
  IF NEW."outboundMessageId" IS NOT NULL THEN
    SELECT m."providerDispatchKey" INTO linked_dispatch_key FROM "whatsapp"."ConversationMessage" m
      WHERE m."id"=NEW."outboundMessageId" AND m."conversationId"=NEW."conversationId"
        AND m."direction"='OUTBOUND' AND m."senderType"='HUMAN';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ARCH040 command outbound message is not HUMAN in conversation' USING ERRCODE='23514';
    END IF;
    IF NEW."providerDispatchKey" IS NOT NULL AND
      linked_dispatch_key IS DISTINCT FROM NEW."providerDispatchKey" THEN
      RAISE EXCEPTION 'ARCH040 command and message provider dispatch mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."outboundMessageId" IS NOT NULL AND NEW."outboundMessageId" IS DISTINCT FROM OLD."outboundMessageId" THEN
      RAISE EXCEPTION 'ARCH040 outbound message identity is set-once' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW."id",NEW."shopId",NEW."conversationId",NEW."idempotencyKey",NEW."payloadSha256",
       NEW."expectedControlRevision",NEW."kind",NEW."recipientSnapshot",NEW."textBody",NEW."templateName",
       NEW."templateLanguageCode",NEW."templateParameters",NEW."recoveryOutreachAttemptId",NEW."acceptedAt",NEW."createdAt")
       IS DISTINCT FROM ROW(OLD."id",OLD."shopId",OLD."conversationId",OLD."idempotencyKey",OLD."payloadSha256",
       OLD."expectedControlRevision",OLD."kind",OLD."recipientSnapshot",OLD."textBody",OLD."templateName",
       OLD."templateLanguageCode",OLD."templateParameters",OLD."recoveryOutreachAttemptId",OLD."acceptedAt",OLD."createdAt") THEN
      RAISE EXCEPTION 'ARCH040 accepted command identity/payload immutable' USING ERRCODE='23514';
    END IF;
    IF OLD."providerDispatchKey" IS NOT NULL AND ROW(NEW."providerDispatchKey",NEW."providerDispatchAdmittedAt",
         NEW."providerDispatchControlRevision",NEW."providerDispatchRestrictionRevision",NEW."outboundMessageId") IS DISTINCT FROM
       ROW(OLD."providerDispatchKey",OLD."providerDispatchAdmittedAt",OLD."providerDispatchControlRevision",
         OLD."providerDispatchRestrictionRevision",OLD."outboundMessageId") THEN
      RAISE EXCEPTION 'ARCH040 one-way provider permit immutable' USING ERRCODE='23514';
    END IF;
    IF NEW."dispatchAttemptCount" < OLD."dispatchAttemptCount" THEN
      RAISE EXCEPTION 'ARCH040 dispatch attempt count cannot decrease' USING ERRCODE='23514';
    END IF;
    IF OLD."state" IN ('SENT','CANCELLED') AND NEW."state"<>OLD."state" THEN
      RAISE EXCEPTION 'ARCH040 terminal command cannot reopen' USING ERRCODE='23514';
    END IF;
    IF OLD."providerDispatchKey" IS NOT NULL AND NEW."state" IN ('ACCEPTED','CLAIMED','CANCELLED') THEN
      RAISE EXCEPTION 'ARCH040 admitted command cannot be resent' USING ERRCODE='23514';
    END IF;
    IF NEW."state"='DISPATCH_ADMITTED' AND OLD."state"<>'DISPATCH_ADMITTED' THEN
      IF OLD."state"<>'CLAIMED' OR OLD."leaseToken" IS NULL
         OR OLD."leaseExpiresAt" <= statement_timestamp()
         OR NEW."providerDispatchControlRevision" IS DISTINCT FROM NEW."expectedControlRevision" THEN
        RAISE EXCEPTION 'ARCH040 only current claim can obtain provider permit' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW."state"='CLAIMED' AND OLD."state"='CLAIMED' AND (
       OLD."leaseExpiresAt">statement_timestamp() OR NEW."leaseToken" IS NOT DISTINCT FROM OLD."leaseToken"
       OR NEW."dispatchAttemptCount"<>OLD."dispatchAttemptCount"+1) THEN
      RAISE EXCEPTION 'ARCH040 cannot steal active lease' USING ERRCODE='23514';
    END IF;
    IF NEW."state"='CLAIMED' AND OLD."state" IN ('ACCEPTED','FAILED') AND (
       OLD."providerDispatchKey" IS NOT NULL OR NEW."dispatchAttemptCount"<>OLD."dispatchAttemptCount"+1
       OR NEW."leaseExpiresAt"<=statement_timestamp()) THEN
      RAISE EXCEPTION 'ARCH040 invalid lease acquisition' USING ERRCODE='23514';
    END IF;
    IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
      (OLD."state" IN ('ACCEPTED','FAILED') AND NEW."state" IN ('CLAIMED','CANCELLED')) OR
      (OLD."state"='CLAIMED' AND NEW."state" IN ('ACCEPTED','DISPATCH_ADMITTED','FAILED','CANCELLED')) OR
      (OLD."state"='DISPATCH_ADMITTED' AND NEW."state" IN ('SENT','UNKNOWN','FAILED')) OR
      (OLD."state"='UNKNOWN' AND NEW."state" IN ('SENT','FAILED'))
    ) THEN
      RAISE EXCEPTION 'ARCH040 invalid command state transition' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW."state"<>'ACCEPTED' OR NEW."dispatchAttemptCount"<>0 OR NEW."providerDispatchKey" IS NOT NULL OR
       NEW."outboundMessageId" IS NOT NULL OR NEW."leaseToken" IS NOT NULL THEN
      RAISE EXCEPTION 'ARCH040 new command must be accepted intent only' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
