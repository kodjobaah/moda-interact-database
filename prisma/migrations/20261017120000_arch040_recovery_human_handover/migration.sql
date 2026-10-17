-- ARCH-040-DATABASE-001: fresh-development persistence for recovery handover.
-- Consumers must acquire locks in this order: Shop (when HUMAN restriction is
-- relevant), recovery Conversation, then command / outreach attempt / message.
-- All CAS and event INSERT operations share a short PostgreSQL transaction;
-- network/Meta/Redis operations must never occur under these locks.
CREATE TYPE "whatsapp"."ConversationControlMode" AS ENUM ('AI', 'HUMAN');
CREATE TYPE "commerce"."RecoveryOutreachInitiator" AS ENUM ('HUMAN', 'AGENT', 'AUTOMATION');
CREATE TYPE "whatsapp"."MerchantConversationSendKind" AS ENUM ('HUMAN_TEXT', 'RECOVERY_FOLLOW_UP_TEMPLATE');
CREATE TYPE "whatsapp"."MerchantConversationSendState" AS ENUM ('ACCEPTED','CLAIMED','DISPATCH_ADMITTED','SENT','FAILED','CANCELLED','UNKNOWN');
CREATE TYPE "commerce"."HumanMessagingRestrictionStatus" AS ENUM ('ACTIVE','SUSPENDED');

ALTER TABLE "whatsapp"."Conversation"
  ADD COLUMN "controlMode" "whatsapp"."ConversationControlMode" NOT NULL DEFAULT 'AI',
  ADD COLUMN "controlRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "controlChangedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "Conversation_control_revision_check" CHECK (
    "controlRevision" >= 0 AND
    (("controlRevision" = 0 AND "controlMode" = 'AI' AND "controlChangedAt" IS NULL) OR
     ("controlRevision" > 0 AND "controlChangedAt" IS NOT NULL))
  );
ALTER TABLE "whatsapp"."ConversationMessage"
  ADD COLUMN "providerDispatchKey" VARCHAR(128),
  ADD COLUMN "providerDispatchAdmittedAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerDispatchControlRevision" INTEGER,
  ADD CONSTRAINT "ConversationMessage_dispatch_tuple_check" CHECK (
    ("providerDispatchKey" IS NULL AND "providerDispatchAdmittedAt" IS NULL AND "providerDispatchControlRevision" IS NULL) OR
    ("providerDispatchKey" IS NOT NULL AND length(btrim("providerDispatchKey")) > 0
      AND "providerDispatchAdmittedAt" IS NOT NULL AND "providerDispatchControlRevision" IS NOT NULL
      AND "providerDispatchControlRevision" >= 0 AND "direction" = 'OUTBOUND')
  );
CREATE UNIQUE INDEX "ConversationMessage_providerDispatchKey_key" ON "whatsapp"."ConversationMessage"("providerDispatchKey");

CREATE TABLE "whatsapp"."ConversationControlEvent" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "fromMode" "whatsapp"."ConversationControlMode" NOT NULL,
  "toMode" "whatsapp"."ConversationControlMode" NOT NULL,
  "fromRevision" INTEGER NOT NULL,
  "toRevision" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationControlEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConversationControlEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationControlEvent_transition_check" CHECK (
    "fromRevision" >= 0 AND "toRevision" = "fromRevision" + 1 AND "fromMode" <> "toMode"
  )
);
CREATE UNIQUE INDEX "ConversationControlEvent_conversationId_toRevision_key" ON "whatsapp"."ConversationControlEvent"("conversationId", "toRevision");
CREATE INDEX "ConversationControlEvent_conversationId_occurredAt_id_idx" ON "whatsapp"."ConversationControlEvent"("conversationId", "occurredAt", "id");

ALTER TABLE "commerce"."RecoveryOutreachAttempt"
  ADD COLUMN "initiatedBy" "commerce"."RecoveryOutreachInitiator",
  ADD COLUMN "initiationKey" VARCHAR(255),
  ADD COLUMN "claimedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "RecoveryOutreachAttempt_sequence_trigger_check" CHECK (
    ("sequence" = 1 AND "trigger" = 'INITIAL' AND "initiationKey" IS NULL) OR
    ("sequence" = 2 AND "trigger" IN ('NO_RESPONSE_FOLLOW_UP','POST_WINDOW_FOLLOW_UP'))
  ),
  ADD CONSTRAINT "RecoveryOutreachAttempt_claim_tuple_check" CHECK (
    ("initiatedBy" IS NULL AND "initiationKey" IS NULL AND "claimedAt" IS NULL) OR
    ("initiatedBy" IS NOT NULL AND "initiationKey" IS NOT NULL AND length(btrim("initiationKey")) > 0 AND "claimedAt" IS NOT NULL)
  );
CREATE UNIQUE INDEX "RecoveryOutreachAttempt_initiationKey_key" ON "commerce"."RecoveryOutreachAttempt"("initiationKey");

CREATE TABLE "commerce"."ShopHumanMessagingRestriction" (
  "shopId" TEXT NOT NULL,
  "status" "commerce"."HumanMessagingRestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reasonCode" VARCHAR(128) NOT NULL,
  "reasonNote" VARCHAR(1024),
  "suspendedAt" TIMESTAMPTZ(3),
  "restoredAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopHumanMessagingRestriction_pkey" PRIMARY KEY ("shopId"),
  CONSTRAINT "ShopHumanMessagingRestriction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopHumanMessagingRestriction_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "ShopHumanMessagingRestriction_reason_check" CHECK (length(btrim("reasonCode")) > 0),
  CONSTRAINT "ShopHumanMessagingRestriction_status_dates_check" CHECK (
    ("status" = 'SUSPENDED' AND "suspendedAt" IS NOT NULL) OR
    ("status" = 'ACTIVE' AND "restoredAt" IS NOT NULL)
  )
);
CREATE TABLE "commerce"."ShopHumanMessagingRestrictionEvent" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "fromStatus" "commerce"."HumanMessagingRestrictionStatus" NOT NULL,
  "toStatus" "commerce"."HumanMessagingRestrictionStatus" NOT NULL,
  "revision" INTEGER NOT NULL,
  "reasonCode" VARCHAR(128) NOT NULL,
  "reasonNote" VARCHAR(1024),
  "platformAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopHumanMessagingRestrictionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopHumanMessagingRestrictionEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopHumanMessagingRestrictionEvent_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShopHumanMessagingRestrictionEvent_revision_check" CHECK ("revision" >= 1 AND "fromStatus" <> "toStatus" AND length(btrim("reasonCode")) > 0)
);
CREATE UNIQUE INDEX "ShopHumanMessagingRestrictionEvent_shopId_revision_key" ON "commerce"."ShopHumanMessagingRestrictionEvent"("shopId", "revision");
CREATE INDEX "ShopHumanMessagingRestrictionEvent_shopId_createdAt_id_idx" ON "commerce"."ShopHumanMessagingRestrictionEvent"("shopId", "createdAt", "id");

CREATE TABLE "whatsapp"."MerchantConversationSendCommand" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "payloadSha256" VARCHAR(64) NOT NULL,
  "expectedControlRevision" INTEGER NOT NULL,
  "kind" "whatsapp"."MerchantConversationSendKind" NOT NULL,
  "recipientSnapshot" VARCHAR(64) NOT NULL,
  "textBody" TEXT,
  "templateName" VARCHAR(255),
  "templateLanguageCode" VARCHAR(32),
  "templateParameters" JSONB,
  "recoveryOutreachAttemptId" TEXT,
  "outboundMessageId" TEXT,
  "state" "whatsapp"."MerchantConversationSendState" NOT NULL DEFAULT 'ACCEPTED',
  "providerDispatchKey" VARCHAR(128),
  "providerDispatchAdmittedAt" TIMESTAMPTZ(3),
  "providerDispatchControlRevision" INTEGER,
  "providerDispatchRestrictionRevision" INTEGER,
  "dispatchAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "leaseToken" VARCHAR(128),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantConversationSendCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantConversationSendCommand_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MerchantConversationSendCommand_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MerchantConversationSendCommand_recoveryOutreachAttemptId_fkey" FOREIGN KEY ("recoveryOutreachAttemptId") REFERENCES "commerce"."RecoveryOutreachAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantConversationSendCommand_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "whatsapp"."ConversationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantConversationSendCommand_revision_counts_check" CHECK (
    "expectedControlRevision" >= 0 AND "dispatchAttemptCount" >= 0
  ),
  CONSTRAINT "MerchantConversationSendCommand_identity_check" CHECK (
    length(btrim("idempotencyKey")) > 0 AND length(btrim("recipientSnapshot")) > 0
    AND "payloadSha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "MerchantConversationSendCommand_payload_check" CHECK (
    ("kind" = 'HUMAN_TEXT' AND "textBody" IS NOT NULL AND length(btrim("textBody")) > 0
      AND "templateName" IS NULL AND "templateLanguageCode" IS NULL
      AND "templateParameters" IS NULL AND "recoveryOutreachAttemptId" IS NULL) OR
    ("kind" = 'RECOVERY_FOLLOW_UP_TEMPLATE' AND "textBody" IS NULL
      AND "templateName" IS NOT NULL AND length(btrim("templateName")) > 0
      AND "templateLanguageCode" IS NOT NULL AND length(btrim("templateLanguageCode")) > 0
      AND "recoveryOutreachAttemptId" IS NOT NULL)
  ),
  CONSTRAINT "MerchantConversationSendCommand_lease_check" CHECK (
    ("leaseToken" IS NULL AND "leaseExpiresAt" IS NULL) OR
    ("leaseToken" IS NOT NULL AND length(btrim("leaseToken")) > 0 AND "leaseExpiresAt" IS NOT NULL)
  ),
  CONSTRAINT "MerchantConversationSendCommand_permit_check" CHECK (
    ("providerDispatchKey" IS NULL AND "providerDispatchAdmittedAt" IS NULL
      AND "providerDispatchControlRevision" IS NULL AND "providerDispatchRestrictionRevision" IS NULL) OR
    ("providerDispatchKey" IS NOT NULL AND length(btrim("providerDispatchKey")) > 0
      AND "providerDispatchAdmittedAt" IS NOT NULL
      AND "providerDispatchControlRevision" IS NOT NULL AND "providerDispatchControlRevision" >= 0
      AND "providerDispatchRestrictionRevision" IS NOT NULL AND "providerDispatchRestrictionRevision" >= 0
      AND "outboundMessageId" IS NOT NULL)
  ),
  CONSTRAINT "MerchantConversationSendCommand_admission_check" CHECK (
    ("state" IN ('DISPATCH_ADMITTED','SENT','UNKNOWN') AND "providerDispatchKey" IS NOT NULL) OR
    ("state" NOT IN ('DISPATCH_ADMITTED','SENT','UNKNOWN'))
  ),
  CONSTRAINT "MerchantConversationSendCommand_claimed_check" CHECK (
    ("state" = 'CLAIMED' AND "leaseToken" IS NOT NULL) OR "state" <> 'CLAIMED'
  ),
  CONSTRAINT "MerchantConversationSendCommand_cancel_check" CHECK (
    "state" <> 'CANCELLED' OR "providerDispatchKey" IS NULL
  )
);
CREATE UNIQUE INDEX "MerchantConversationSendCommand_shopId_idempotencyKey_key" ON "whatsapp"."MerchantConversationSendCommand"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX "MerchantConversationSendCommand_recoveryOutreachAttemptId_key" ON "whatsapp"."MerchantConversationSendCommand"("recoveryOutreachAttemptId");
CREATE UNIQUE INDEX "MerchantConversationSendCommand_outboundMessageId_key" ON "whatsapp"."MerchantConversationSendCommand"("outboundMessageId");
CREATE UNIQUE INDEX "MerchantConversationSendCommand_providerDispatchKey_key" ON "whatsapp"."MerchantConversationSendCommand"("providerDispatchKey");
CREATE INDEX "MerchantSend_due_idx" ON "whatsapp"."MerchantConversationSendCommand"("state", "nextAttemptAt", "leaseExpiresAt", "createdAt", "id");
CREATE INDEX "MerchantSend_shop_conversation_idx" ON "whatsapp"."MerchantConversationSendCommand"("shopId", "conversationId", "createdAt", "id");

-- BEFORE row guards keep scalar identities set-once. Deferred consistency
-- checks pair revisions with events after the entire CAS transaction completes.
CREATE FUNCTION "whatsapp".arch040_conversation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."checkoutRecoveryId", NEW."shopId") IS DISTINCT FROM
     ROW(OLD."checkoutRecoveryId", OLD."shopId") AND EXISTS (
       SELECT 1 FROM "whatsapp"."MerchantConversationSendCommand" WHERE "conversationId"=OLD."id"
     ) THEN
    RAISE EXCEPTION 'ARCH040 command-bound conversation ownership is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."controlRevision" < OLD."controlRevision" THEN
    RAISE EXCEPTION 'ARCH040 control revision cannot decrease' USING ERRCODE='23514';
  END IF;
  IF NEW."controlMode" IS DISTINCT FROM OLD."controlMode" THEN
    IF NEW."controlRevision" <> OLD."controlRevision" + 1
       OR NEW."controlChangedAt" IS NULL
       OR NEW."controlChangedAt" IS NOT DISTINCT FROM OLD."controlChangedAt" THEN
      RAISE EXCEPTION 'ARCH040 transition requires one new revision/time' USING ERRCODE='23514';
    END IF;
  ELSIF ROW(NEW."controlRevision", NEW."controlChangedAt")
    IS DISTINCT FROM ROW(OLD."controlRevision", OLD."controlChangedAt") THEN
    RAISE EXCEPTION 'ARCH040 no-op cannot change revision/time' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch040_conversation_guard BEFORE UPDATE ON "whatsapp"."Conversation"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_conversation_guard();

CREATE FUNCTION "commerce".arch040_recovery_tenant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."shopId" IS DISTINCT FROM OLD."shopId" AND EXISTS (
    SELECT 1 FROM "whatsapp"."MerchantConversationSendCommand" cmd
      JOIN "whatsapp"."Conversation" c ON c."id"=cmd."conversationId"
      WHERE c."checkoutRecoveryId"=OLD."id"
  ) THEN
    RAISE EXCEPTION 'ARCH040 command-bound recovery tenant cannot change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch040_recovery_tenant_guard BEFORE UPDATE OF "shopId" ON "commerce"."CheckoutRecovery"
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch040_recovery_tenant_guard();

CREATE FUNCTION "whatsapp".arch040_conversation_transition_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Conversation' THEN
    IF NOT EXISTS (SELECT 1 FROM "whatsapp"."ConversationControlEvent" e
      WHERE e."conversationId"=NEW."id" AND e."fromRevision"=OLD."controlRevision"
        AND e."toRevision"=NEW."controlRevision" AND e."fromMode"=OLD."controlMode"
        AND e."toMode"=NEW."controlMode") THEN
      RAISE EXCEPTION 'ARCH040 control transition missing matching event' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "whatsapp"."Conversation" c
      WHERE c."id"=NEW."conversationId" AND c."controlMode"=NEW."toMode"
        AND c."controlRevision"=NEW."toRevision") THEN
      RAISE EXCEPTION 'ARCH040 event does not match conversation revision' USING ERRCODE='23514';
    END IF;
    IF NEW."fromRevision" = 0 THEN
      IF NEW."fromMode" <> 'AI' THEN
        RAISE EXCEPTION 'ARCH040 initial event must follow AI' USING ERRCODE='23514';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM "whatsapp"."ConversationControlEvent" previous
      WHERE previous."conversationId"=NEW."conversationId"
        AND previous."toRevision"=NEW."fromRevision" AND previous."toMode"=NEW."fromMode") THEN
      RAISE EXCEPTION 'ARCH040 transition history has a gap' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER arch040_conversation_transition
  AFTER UPDATE ON "whatsapp"."Conversation" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."controlMode" IS DISTINCT FROM NEW."controlMode")
  EXECUTE FUNCTION "whatsapp".arch040_conversation_transition_check();
CREATE CONSTRAINT TRIGGER arch040_conversation_event_consistency
  AFTER INSERT ON "whatsapp"."ConversationControlEvent" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_conversation_transition_check();

CREATE FUNCTION "whatsapp".arch040_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_exists BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ARCH040 audit event is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME = 'ConversationControlEvent' THEN
    SELECT EXISTS(SELECT 1 FROM "whatsapp"."Conversation" WHERE "id"=OLD."conversationId") INTO parent_exists;
  ELSE
    SELECT EXISTS(SELECT 1 FROM "commerce"."Shop" WHERE "id"=OLD."shopId") INTO parent_exists;
  END IF;
  IF parent_exists THEN
    RAISE EXCEPTION 'ARCH040 audit event cannot be directly deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER arch040_control_event_immutable BEFORE UPDATE OR DELETE ON "whatsapp"."ConversationControlEvent"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_event_immutable();
CREATE TRIGGER arch040_restriction_event_immutable BEFORE UPDATE OR DELETE ON "commerce"."ShopHumanMessagingRestrictionEvent"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_event_immutable();

CREATE FUNCTION "commerce".arch040_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
      RAISE EXCEPTION 'ARCH040 outreach claim is immutable' USING ERRCODE='23514';
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
CREATE TRIGGER arch040_attempt_guard BEFORE INSERT OR UPDATE ON "commerce"."RecoveryOutreachAttempt"
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch040_attempt_guard();

CREATE FUNCTION "whatsapp".arch040_message_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
         AND c."checkoutRecoveryId" IS NOT NULL AND c."controlRevision"=NEW."providerDispatchControlRevision"
         AND c."controlMode"=(CASE WHEN NEW."senderType"='HUMAN' THEN 'HUMAN'::"whatsapp"."ConversationControlMode" ELSE 'AI'::"whatsapp"."ConversationControlMode" END)
     )) THEN
    RAISE EXCEPTION 'ARCH040 outbound admission must match current recovery control' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch040_message_dispatch_guard BEFORE INSERT OR UPDATE ON "whatsapp"."ConversationMessage"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_message_dispatch_guard();

CREATE FUNCTION "whatsapp".arch040_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND a."sequence"=2
      AND (NEW."outboundMessageId" IS NULL OR a."outboundMessageId" IS NULL
           OR NEW."outboundMessageId"=a."outboundMessageId")
  ) THEN
    RAISE EXCEPTION 'ARCH040 follow-up must refer to same recovery sequence 2' USING ERRCODE='23514';
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
CREATE TRIGGER arch040_command_guard BEFORE INSERT OR UPDATE ON "whatsapp"."MerchantConversationSendCommand"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_command_guard();

CREATE FUNCTION "commerce".arch040_restriction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM "commerce"."Shop" WHERE "id"=OLD."shopId") THEN
      RAISE EXCEPTION 'ARCH040 restriction cannot be deleted on restore' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision"<>1 OR NEW."status"<>'SUSPENDED' THEN
      RAISE EXCEPTION 'ARCH040 initial restriction must be revision 1 suspension' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW."shopId"<>OLD."shopId" OR NEW."revision"<>OLD."revision"+1
       OR NEW."status"=OLD."status" THEN
      RAISE EXCEPTION 'ARCH040 restriction update requires transition and revision' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch040_restriction_guard BEFORE INSERT OR UPDATE OR DELETE ON "commerce"."ShopHumanMessagingRestriction"
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch040_restriction_guard();

CREATE FUNCTION "commerce".arch040_restriction_event_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestriction" r
      WHERE r."shopId"=NEW."shopId" AND r."revision"=NEW."revision" AND r."status"=NEW."toStatus") THEN
    RAISE EXCEPTION 'ARCH040 restriction event must match revision' USING ERRCODE='23514';
  END IF;
  IF NEW."revision"=1 THEN
    IF NEW."fromStatus"<>'ACTIVE' OR NEW."toStatus"<>'SUSPENDED' THEN
      RAISE EXCEPTION 'ARCH040 first restriction event must suspend' USING ERRCODE='23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestrictionEvent" e
      WHERE e."shopId"=NEW."shopId" AND e."revision"=NEW."revision"-1
        AND e."toStatus"=NEW."fromStatus") THEN
    RAISE EXCEPTION 'ARCH040 restriction event history gap' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER arch040_restriction_event_check AFTER INSERT
  ON "commerce"."ShopHumanMessagingRestrictionEvent" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch040_restriction_event_check();
CREATE FUNCTION "commerce".arch040_restriction_transition_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestrictionEvent" e
      WHERE e."shopId"=NEW."shopId" AND e."revision"=1
        AND e."fromStatus"='ACTIVE' AND e."toStatus"=NEW."status"
        AND e."reasonCode"=NEW."reasonCode"
        AND e."reasonNote" IS NOT DISTINCT FROM NEW."reasonNote") THEN
      RAISE EXCEPTION 'ARCH040 initial restriction requires admin audit' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestrictionEvent" e
      WHERE e."shopId"=NEW."shopId" AND e."revision"=NEW."revision"
        AND e."fromStatus"=OLD."status" AND e."toStatus"=NEW."status"
        AND e."reasonCode"=NEW."reasonCode"
        AND e."reasonNote" IS NOT DISTINCT FROM NEW."reasonNote") THEN
      RAISE EXCEPTION 'ARCH040 restriction change requires admin audit' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER arch040_restriction_transition AFTER INSERT OR UPDATE
  ON "commerce"."ShopHumanMessagingRestriction" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch040_restriction_transition_check();
