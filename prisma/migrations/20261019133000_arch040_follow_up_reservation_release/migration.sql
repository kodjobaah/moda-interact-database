-- ARCH-040-DATABASE-006: preserve one physical outreach attempt, but allow
-- immutable historical (cancelled) commands to share its FK with a new command.
-- This migration does NOT release any claim or decide follow-up eligibility.
DROP INDEX "whatsapp"."MerchantConversationSendCommand_recoveryOutreachAttemptId_key";
CREATE INDEX "MerchantSend_outreach_attempt_idx"
  ON "whatsapp"."MerchantConversationSendCommand"("recoveryOutreachAttemptId");

-- Only structural/irreversibility checks live here. Release is authorised solely
-- by the application-owned BG007 Shop -> Conversation -> command -> attempt
-- locking transaction, including provider, moderation and billing checks.
CREATE OR REPLACE FUNCTION "commerce".arch040_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."id",NEW."checkoutRecoveryId",NEW."sequence") IS DISTINCT FROM
       ROW(OLD."id",OLD."checkoutRecoveryId",OLD."sequence") THEN
      RAISE EXCEPTION 'ARCH040 attempt identity immutable' USING ERRCODE='23514';
    END IF;
    IF OLD."initiationKey" IS NOT NULL AND
       ROW(NEW."initiatedBy",NEW."initiationKey",NEW."claimedAt",NEW."trigger",NEW."recipient",
           NEW."configuredOfferMode",NEW."fixedShopifyDiscountId",NEW."offerSnapshot") IS DISTINCT FROM
       ROW(OLD."initiatedBy",OLD."initiationKey",OLD."claimedAt",OLD."trigger",OLD."recipient",
           OLD."configuredOfferMode",OLD."fixedShopifyDiscountId",OLD."offerSnapshot") THEN
      -- Structural exception only. Background must establish the current owner,
      -- terminal pre-provider cancellation and billing safety under row locks.
      -- An attempt can be made unclaimed only without mutating any other value
      -- (updatedAt may advance); immutable historical commands keep their FK.
      IF NOT (
        NEW."initiationKey" IS NULL AND NEW."initiatedBy" IS NULL AND NEW."claimedAt" IS NULL
        AND OLD."status" = 'PENDING' AND NEW."status" = 'PENDING'
        AND OLD."outboundMessageId" IS NULL AND NEW."outboundMessageId" IS NULL
        AND OLD."sentAt" IS NULL AND NEW."sentAt" IS NULL
        AND ROW(NEW."id",NEW."checkoutRecoveryId",NEW."sequence",NEW."trigger",NEW."recipient",
                NEW."configuredOfferMode",NEW."fixedShopifyDiscountId",NEW."offerSnapshot",
                NEW."followUpDueAt",NEW."customerRespondedAt",NEW."closedAt",NEW."failureCode",
                NEW."createdAt") IS NOT DISTINCT FROM
            ROW(OLD."id",OLD."checkoutRecoveryId",OLD."sequence",OLD."trigger",OLD."recipient",
                OLD."configuredOfferMode",OLD."fixedShopifyDiscountId",OLD."offerSnapshot",
                OLD."followUpDueAt",OLD."customerRespondedAt",OLD."closedAt",OLD."failureCode",
                OLD."createdAt")
        AND NOT EXISTS (
          SELECT 1 FROM "whatsapp"."MerchantConversationSendCommand" cmd
          WHERE cmd."recoveryOutreachAttemptId" = OLD."id"
            AND (cmd."providerDispatchKey" IS NOT NULL
                 OR cmd."outboundMessageId" IS NOT NULL
                 OR cmd."state" IN ('DISPATCH_ADMITTED','UNKNOWN','SENT'))
        )
      ) THEN
        RAISE EXCEPTION 'ARCH040 outreach claim is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
    IF OLD."outboundMessageId" IS NOT NULL AND NEW."outboundMessageId" IS DISTINCT FROM OLD."outboundMessageId" THEN
      RAISE EXCEPTION 'ARCH040 outbound outreach identity is set-once' USING ERRCODE='23514';
    END IF;
    IF OLD."initiationKey" IS NULL AND NEW."initiationKey" IS NOT NULL AND
       (OLD."status" <> 'PENDING' OR OLD."outboundMessageId" IS NOT NULL OR OLD."sentAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'ARCH040 cannot claim previously dispatched outreach' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."outboundMessageId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "whatsapp"."ConversationMessage" m
    JOIN "whatsapp"."Conversation" c ON c."id"=m."conversationId"
    WHERE m."id"=NEW."outboundMessageId" AND c."checkoutRecoveryId"=NEW."checkoutRecoveryId"
      AND m."direction"='OUTBOUND'
  ) THEN
    RAISE EXCEPTION 'ARCH040 attempt message belongs to different recovery' USING ERRCODE='23514';
  END IF;
  IF NEW."outboundMessageId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "whatsapp"."MerchantConversationSendCommand" cmd
    WHERE cmd."recoveryOutreachAttemptId"=NEW."id" AND cmd."outboundMessageId" IS NOT NULL
      AND cmd."outboundMessageId"<>NEW."outboundMessageId"
  ) THEN
    RAISE EXCEPTION 'ARCH040 follow-up attempt/command message mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
