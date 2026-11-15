BEGIN;

-- AlterTable
ALTER TABLE "whatsapp"."ConversationMessage" ADD COLUMN     "allowanceBlockId" TEXT;

-- CreateTable
CREATE TABLE "billing"."ConversationAllowanceBlock" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "fundingKind" VARCHAR(16) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "predecessorId" TEXT,
    "creditReservationId" TEXT,
    "hardMessageLimit" INTEGER NOT NULL,
    "terminalReservedSlots" INTEGER NOT NULL,
    "repairAt" TIMESTAMPTZ(3),
    "repairLeaseToken" TEXT,
    "repairLeaseUntil" TIMESTAMPTZ(3),
    "repairDeadlineAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAllowanceBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAllowanceBlock_creditReservationId_key" ON "billing"."ConversationAllowanceBlock"("creditReservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAllowanceBlock_conversationId_ordinal_key" ON "billing"."ConversationAllowanceBlock"("conversationId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAllowanceBlock_id_conversationId_key" ON "billing"."ConversationAllowanceBlock"("id", "conversationId");

-- AddForeignKey
ALTER TABLE "whatsapp"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_allowanceBlockId_conversationId_fkey" FOREIGN KEY ("allowanceBlockId", "conversationId") REFERENCES "billing"."ConversationAllowanceBlock"("id", "conversationId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing"."ConversationAllowanceBlock" ADD CONSTRAINT "ConversationAllowanceBlock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ConversationAllowanceBlock" ADD CONSTRAINT "ConversationAllowanceBlock_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ConversationAllowanceBlock" ADD CONSTRAINT "ConversationAllowanceBlock_creditReservationId_shopId_fkey" FOREIGN KEY ("creditReservationId", "shopId") REFERENCES "billing"."UsageReservation"("id", "shopId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing"."ConversationAllowanceBlock" ADD CONSTRAINT "ConversationAllowanceBlock_predecessorId_conversationId_fkey" FOREIGN KEY ("predecessorId", "conversationId") REFERENCES "billing"."ConversationAllowanceBlock"("id", "conversationId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The nullable pin leaves historical and old-writer messages unchanged.
ALTER TABLE "billing"."ConversationAllowanceBlock"
  ADD CONSTRAINT "Allowance_ordinal_check" CHECK (ordinal >= 0),
  ADD CONSTRAINT "Allowance_funding_kind_check" CHECK ("fundingKind" IN ('INITIAL','FOLLOW_UP','CONTINUATION')),
  ADD CONSTRAINT "Allowance_state_check" CHECK (state IN ('PENDING','ACTIVE','EXHAUSTED','CLOSED','CANCELLED')),
  ADD CONSTRAINT "Allowance_limits_check" CHECK ("hardMessageLimit" > 0 AND "terminalReservedSlots" >= 0 AND "terminalReservedSlots" <= "hardMessageLimit"),
  ADD CONSTRAINT "Allowance_lineage_check" CHECK (("fundingKind"='INITIAL' AND ordinal=0 AND "predecessorId" IS NULL) OR ("fundingKind" IN ('FOLLOW_UP','CONTINUATION') AND ordinal>0 AND "predecessorId" IS NOT NULL)),
  ADD CONSTRAINT "Allowance_funding_proof_check" CHECK ("fundingKind"='INITIAL' OR state IN ('PENDING','CANCELLED') OR "creditReservationId" IS NOT NULL),
  ADD CONSTRAINT "Allowance_repair_check" CHECK (("repairLeaseToken" IS NULL)=("repairLeaseUntil" IS NULL) AND ("repairLeaseToken" IS NULL OR length("repairLeaseToken")>0) AND (state <> 'PENDING' OR "repairDeadlineAt" IS NOT NULL) AND (state='PENDING' OR ("repairAt" IS NULL AND "repairLeaseToken" IS NULL AND "repairLeaseUntil" IS NULL)) AND ("repairAt" IS NOT NULL OR "repairLeaseToken" IS NULL)),
  ADD CONSTRAINT "Allowance_time_check" CHECK ("updatedAt">="createdAt" AND ("repairDeadlineAt" IS NULL OR "repairDeadlineAt">="createdAt") AND ("repairAt" IS NULL OR ("repairDeadlineAt" IS NOT NULL AND "repairAt"<="repairDeadlineAt")));

ALTER TABLE "billing"."ConversationAllowanceBlock" ALTER CONSTRAINT "ConversationAllowanceBlock_creditReservationId_shopId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "billing"."ConversationAllowanceBlock" ALTER CONSTRAINT "ConversationAllowanceBlock_predecessorId_conversationId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "whatsapp"."ConversationMessage" ALTER CONSTRAINT "ConversationMessage_allowanceBlockId_conversationId_fkey" DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "Allowance_one_active_per_conversation" ON "billing"."ConversationAllowanceBlock" ("conversationId") WHERE state='ACTIVE';
CREATE UNIQUE INDEX "Allowance_one_pending_per_conversation" ON "billing"."ConversationAllowanceBlock" ("conversationId") WHERE state='PENDING';
CREATE INDEX "Allowance_pending_repair_due" ON "billing"."ConversationAllowanceBlock" ("repairAt",id) WHERE state='PENDING' AND "repairAt" IS NOT NULL;
CREATE INDEX "ConversationMessage_allowanceBlockId_idx" ON "whatsapp"."ConversationMessage" ("allowanceBlockId") WHERE "allowanceBlockId" IS NOT NULL;

CREATE FUNCTION "billing"."guard_conversation_allowance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_shop text; owner_type "whatsapp"."ConversationType"; owner_recovery text; direct_shop text; prior_ordinal integer; highest_ordinal integer;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW."shopId",NEW."conversationId",NEW.ordinal,NEW."fundingKind",NEW."predecessorId",NEW."hardMessageLimit",NEW."terminalReservedSlots",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."shopId",OLD."conversationId",OLD.ordinal,OLD."fundingKind",OLD."predecessorId",OLD."hardMessageLimit",OLD."terminalReservedSlots",OLD."createdAt") THEN
      RAISE EXCEPTION 'ALLOWANCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD."creditReservationId" IS NOT NULL AND NEW."creditReservationId" IS DISTINCT FROM OLD."creditReservationId" THEN
      RAISE EXCEPTION 'ALLOWANCE_RESERVATION_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.state IN ('CLOSED','CANCELLED') AND NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'ALLOWANCE_TERMINAL_STATE_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    IF OLD.state='EXHAUSTED' AND NEW.state NOT IN ('EXHAUSTED','CLOSED') OR OLD.state='ACTIVE' AND NEW.state NOT IN ('ACTIVE','EXHAUSTED','CLOSED','CANCELLED') THEN
      RAISE EXCEPTION 'ALLOWANCE_STATE_REGRESSION' USING ERRCODE='23514';
    END IF;
    IF OLD."repairDeadlineAt" IS NOT NULL AND NEW."repairDeadlineAt" IS DISTINCT FROM OLD."repairDeadlineAt" THEN
      RAISE EXCEPTION 'ALLOWANCE_REPAIR_DEADLINE_IMMUTABLE' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Serialize ordinal allocation per owner, including distinct concurrent blocks.
  SELECT c.type,c."checkoutRecoveryId",c."shopId" INTO owner_type,owner_recovery,direct_shop FROM "whatsapp"."Conversation" c WHERE c.id=NEW."conversationId" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ALLOWANCE_CONVERSATION_MISSING' USING ERRCODE='23503'; END IF;
  -- Exact C→Recovery lock order matches sender assignment admission. SHARE
  -- conflicts with a concurrent NO KEY UPDATE of recovery.shopId. Without it,
  -- both a child INSERT and the reciprocal parent guard can miss each other.
  SELECT r."shopId" INTO owner_shop FROM "commerce"."CheckoutRecovery" r WHERE r.id=owner_recovery FOR SHARE;
  IF owner_type <> 'RECOVERY' OR owner_recovery IS NULL OR owner_shop IS DISTINCT FROM NEW."shopId" OR (direct_shop IS NOT NULL AND direct_shop IS DISTINCT FROM NEW."shopId") THEN
    RAISE EXCEPTION 'ALLOWANCE_OWNER_MISMATCH' USING ERRCODE='23514';
  END IF;
  IF NEW."predecessorId" IS NOT NULL THEN
    SELECT ordinal INTO prior_ordinal FROM "billing"."ConversationAllowanceBlock" WHERE id=NEW."predecessorId" AND "conversationId"=NEW."conversationId" AND "shopId"=NEW."shopId";
    IF NOT FOUND OR prior_ordinal>=NEW.ordinal THEN RAISE EXCEPTION 'ALLOWANCE_PREDECESSOR_MISMATCH' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT max(ordinal) INTO highest_ordinal FROM "billing"."ConversationAllowanceBlock" WHERE "conversationId"=NEW."conversationId";
    IF highest_ordinal IS NOT NULL AND NEW.ordinal<=highest_ordinal THEN RAISE EXCEPTION 'ALLOWANCE_ORDINAL_NOT_MONOTONIC' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConversationAllowanceBlock_guard" BEFORE INSERT OR UPDATE ON "billing"."ConversationAllowanceBlock" FOR EACH ROW EXECUTE FUNCTION "billing"."guard_conversation_allowance"();

CREATE FUNCTION "whatsapp"."guard_message_allowance_pin"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."allowanceBlockId" IS DISTINCT FROM OLD."allowanceBlockId" OR (OLD."allowanceBlockId" IS NOT NULL AND NEW."conversationId" IS DISTINCT FROM OLD."conversationId") THEN
    RAISE EXCEPTION 'MESSAGE_ALLOWANCE_PIN_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConversationMessage_allowance_pin_guard" BEFORE UPDATE ON "whatsapp"."ConversationMessage" FOR EACH ROW EXECUTE FUNCTION "whatsapp"."guard_message_allowance_pin"();

-- Retain cancelled/exhausted lineage while its owner survives. Owner cascades
-- remain legal; a later retry cannot erase an ordinal and mint a replacement.
CREATE FUNCTION "billing"."guard_allowance_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "whatsapp"."Conversation" WHERE id=OLD."conversationId") AND EXISTS (SELECT 1 FROM "commerce"."Shop" WHERE id=OLD."shopId") THEN
    RAISE EXCEPTION 'ALLOWANCE_HISTORY_DELETE_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "ConversationAllowanceBlock_delete_guard" BEFORE DELETE ON "billing"."ConversationAllowanceBlock" FOR EACH ROW EXECUTE FUNCTION "billing"."guard_allowance_delete"();

-- Ownership must remain valid when an existing parent is edited, not merely
-- when a block is inserted. Deferred checks preserve ordinary owner cascades.
CREATE FUNCTION "billing"."guard_allowance_parent_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "billing"."ConversationAllowanceBlock" b
    JOIN "whatsapp"."Conversation" c ON c.id=b."conversationId"
    LEFT JOIN "commerce"."CheckoutRecovery" r ON r.id=c."checkoutRecoveryId"
    WHERE ((TG_TABLE_NAME='Conversation' AND c.id=NEW.id) OR (TG_TABLE_NAME='CheckoutRecovery' AND r.id=NEW.id))
    AND (c.type<>'RECOVERY' OR r.id IS NULL OR r."shopId" IS DISTINCT FROM b."shopId" OR (c."shopId" IS NOT NULL AND c."shopId" IS DISTINCT FROM b."shopId"))
  ) THEN RAISE EXCEPTION 'ALLOWANCE_PARENT_OWNER_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Conversation_allowance_owner_guard" AFTER UPDATE OF "shopId","checkoutRecoveryId",type ON "whatsapp"."Conversation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "billing"."guard_allowance_parent_owner"();
CREATE CONSTRAINT TRIGGER "CheckoutRecovery_allowance_owner_guard" AFTER UPDATE OF "shopId" ON "commerce"."CheckoutRecovery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "billing"."guard_allowance_parent_owner"();

COMMIT;
