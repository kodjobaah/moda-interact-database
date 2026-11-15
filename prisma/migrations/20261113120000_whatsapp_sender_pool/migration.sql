-- AlterTable
ALTER TABLE "whatsapp"."ConversationMessage" ADD COLUMN     "dispatchProviderAccountId" VARCHAR(64),
ADD COLUMN     "dispatchProviderPhoneNumberId" VARCHAR(64);

-- CreateTable
CREATE TABLE "whatsapp"."WhatsAppPoolSender" (
    "providerPhoneNumberId" VARCHAR(64) NOT NULL,
    "providerAccountId" VARCHAR(64) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "allocationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppPoolSender_pkey" PRIMARY KEY ("providerPhoneNumberId")
);

-- CreateTable
CREATE TABLE "whatsapp"."RecoverySenderThread" (
    "id" TEXT NOT NULL,
    "canonicalRecipient" VARCHAR(15) NOT NULL,
    "providerPhoneNumberId" VARCHAR(64) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoverySenderThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."RecoverySenderRoute" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "canonicalRecipient" VARCHAR(15) NOT NULL,
    "providerPhoneNumberId" VARCHAR(64) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoverySenderRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."RecoverySenderAssignment" (
    "conversationId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoverySenderAssignment_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "whatsapp"."RecoveryBasketRoutingTurn" (
    "inboundProviderMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "routeId" TEXT,
    "promptScopeRouteId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputJson" JSONB,
    "candidatesJson" JSONB,
    "moderationJson" JSONB,
    "configurationSnapshot" JSONB,
    "routingDecision" JSONB,
    "parentProviderMessageId" TEXT,
    "state" VARCHAR(24) NOT NULL DEFAULT 'RECEIVED',
    "resolutionInboundProviderMessageId" TEXT,
    "selectedConversationId" TEXT,
    "promptText" TEXT,
    "promptAdmittedAt" TIMESTAMPTZ(3),
    "promptSentAt" TIMESTAMPTZ(3),
    "promptProviderMessageId" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "workToken" TEXT,
    "workLeaseUntil" TIMESTAMPTZ(3),
    "nextRepairAt" TIMESTAMPTZ(3),
    "repairAttempt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryBasketRoutingTurn_pkey" PRIMARY KEY ("inboundProviderMessageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppPoolSender_providerPhoneNumberId_providerAccountId_key" ON "whatsapp"."WhatsAppPoolSender"("providerPhoneNumberId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoverySenderThread_id_canonicalRecipient_providerPhoneNum_key" ON "whatsapp"."RecoverySenderThread"("id", "canonicalRecipient", "providerPhoneNumberId");

-- CreateIndex
CREATE INDEX "RecoverySenderRoute_threadId_closedAt_shopId_idx" ON "whatsapp"."RecoverySenderRoute"("threadId", "closedAt", "shopId");

-- CreateIndex
CREATE INDEX "RecoverySenderAssignment_routeId_releasedAt_idx" ON "whatsapp"."RecoverySenderAssignment"("routeId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryBasketRoutingTurn_promptProviderMessageId_key" ON "whatsapp"."RecoveryBasketRoutingTurn"("promptProviderMessageId");

-- CreateIndex
CREATE INDEX "RecoveryBasketRoutingTurn_threadId_state_occurredAt_idx" ON "whatsapp"."RecoveryBasketRoutingTurn"("threadId", "state", "occurredAt");

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoverySenderThread" ADD CONSTRAINT "RecoverySenderThread_providerPhoneNumberId_fkey" FOREIGN KEY ("providerPhoneNumberId") REFERENCES "whatsapp"."WhatsAppPoolSender"("providerPhoneNumberId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoverySenderRoute" ADD CONSTRAINT "RecoverySenderRoute_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoverySenderRoute" ADD CONSTRAINT "RecoverySenderRoute_threadId_canonicalRecipient_providerPh_fkey" FOREIGN KEY ("threadId", "canonicalRecipient", "providerPhoneNumberId") REFERENCES "whatsapp"."RecoverySenderThread"("id", "canonicalRecipient", "providerPhoneNumberId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoverySenderAssignment" ADD CONSTRAINT "RecoverySenderAssignment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoverySenderAssignment" ADD CONSTRAINT "RecoverySenderAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "whatsapp"."RecoverySenderRoute"("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoveryBasketRoutingTurn" ADD CONSTRAINT "RecoveryBasketRoutingTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "whatsapp"."RecoverySenderThread"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoveryBasketRoutingTurn" ADD CONSTRAINT "RecoveryBasketRoutingTurn_parentProviderMessageId_fkey" FOREIGN KEY ("parentProviderMessageId") REFERENCES "whatsapp"."RecoveryBasketRoutingTurn"("inboundProviderMessageId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "whatsapp"."RecoveryBasketRoutingTurn" ADD CONSTRAINT "RecoveryBasketRoutingTurn_selectedConversationId_fkey" FOREIGN KEY ("selectedConversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE whatsapp."RecoveryBasketRoutingTurn" ADD CONSTRAINT "RecoveryBasketRoutingTurn_resolution_fkey" FOREIGN KEY ("resolutionInboundProviderMessageId") REFERENCES whatsapp."RecoveryBasketRoutingTurn" ("inboundProviderMessageId") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;

-- Sender ownership is independent of credit eligibility and allowance accounting.
CREATE UNIQUE INDEX "RecoverySenderThread_live_recipient_sender_key" ON whatsapp."RecoverySenderThread" ("canonicalRecipient", "providerPhoneNumberId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "RecoverySenderRoute_live_recipient_shop_key" ON whatsapp."RecoverySenderRoute" ("canonicalRecipient", "shopId") WHERE "closedAt" IS NULL;
CREATE INDEX "WhatsAppPoolSender_enabled_order_idx" ON whatsapp."WhatsAppPoolSender" (priority, "providerPhoneNumberId" COLLATE "C") WHERE "allocationEnabled";
CREATE INDEX "RecoveryBasketRoutingTurn_pending_expiry_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("expiresAt", "inboundProviderMessageId") WHERE state IN ('RECEIVED','PROMPT_ADMITTED','PROMPT_UNKNOWN');
CREATE INDEX "RecoveryBasketRoutingTurn_pending_repair_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("nextRepairAt", "inboundProviderMessageId") WHERE state IN ('RECEIVED','PROMPT_ADMITTED','PROMPT_UNKNOWN') AND "nextRepairAt" IS NOT NULL;
-- Historical scalar scope stamps need selective owner-deletion cleanup.
CREATE INDEX "RecoveryBasketRoutingTurn_route_scope_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("routeId") WHERE "routeId" IS NOT NULL;
CREATE INDEX "RecoveryBasketRoutingTurn_prompt_scope_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("promptScopeRouteId") WHERE "promptScopeRouteId" IS NOT NULL;

ALTER TABLE whatsapp."WhatsAppPoolSender"
  ADD CONSTRAINT "WhatsAppPoolSender_identity_check" CHECK ("providerPhoneNumberId" ~ '^[0-9]+$' AND "providerAccountId" ~ '^[0-9]+$'),
  ADD CONSTRAINT "WhatsAppPoolSender_priority_check" CHECK (priority >= 0);
ALTER TABLE whatsapp."RecoverySenderThread"
  ADD CONSTRAINT "RecoverySenderThread_recipient_check" CHECK ("canonicalRecipient" ~ '^[1-9][0-9]{0,14}$'),
  ADD CONSTRAINT "RecoverySenderThread_time_check" CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt");
ALTER TABLE whatsapp."RecoverySenderRoute"
  ADD CONSTRAINT "RecoverySenderRoute_time_check" CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt");
ALTER TABLE whatsapp."RecoverySenderAssignment"
  ADD CONSTRAINT "RecoverySenderAssignment_time_check" CHECK ("releasedAt" IS NULL OR "releasedAt" >= "assignedAt");
ALTER TABLE whatsapp."ConversationMessage"
  ADD CONSTRAINT "ConversationMessage_dispatch_sender_check" CHECK (
    ("dispatchProviderAccountId" IS NULL AND "dispatchProviderPhoneNumberId" IS NULL) OR
    ("dispatchProviderAccountId" IS NOT NULL AND "dispatchProviderPhoneNumberId" IS NOT NULL AND
     "dispatchProviderAccountId" ~ '^[0-9]+$' AND "dispatchProviderPhoneNumberId" ~ '^[0-9]+$'));
ALTER TABLE whatsapp."RecoveryBasketRoutingTurn"
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_state_check" CHECK (state IN ('RECEIVED','PROMPT_ADMITTED','PROMPT_UNKNOWN','RESOLVED','EXPIRED','IGNORED')),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_decision_check" CHECK ("routingDecision" IS NULL OR
    (jsonb_typeof("routingDecision") = 'object' AND "routingDecision" ? 'schemaVersion' AND "routingDecision"->'schemaVersion' = '1'::jsonb AND NOT ("routingDecision" ?| ARRAY['newQuestionClause','exactnewQuestionClause','exactNewQuestionClause']))),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_lease_check" CHECK (
    ("workToken" IS NULL AND "workLeaseUntil" IS NULL) OR
    ("workToken" IS NOT NULL AND length("workToken") > 0 AND "workLeaseUntil" IS NOT NULL)),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_attempt_check" CHECK ("repairAttempt" >= 0),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_time_check" CHECK ("expiresAt" > "occurredAt" AND
    ("promptAdmittedAt" IS NULL OR "promptAdmittedAt" >= "occurredAt") AND
    ("promptSentAt" IS NULL OR "promptSentAt" >= "promptAdmittedAt") AND
    ("resolvedAt" IS NULL OR "resolvedAt" >= "occurredAt")),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_prompt_check" CHECK (
    ("promptSentAt" IS NULL) = ("promptProviderMessageId" IS NULL) AND
    ("promptSentAt" IS NULL OR "promptAdmittedAt" IS NOT NULL) AND
    ("promptScopeRouteId" IS NULL OR "promptAdmittedAt" IS NOT NULL) AND
    (state NOT IN ('PROMPT_ADMITTED','PROMPT_UNKNOWN') OR "promptAdmittedAt" IS NOT NULL)),
  ADD CONSTRAINT "RecoveryBasketRoutingTurn_terminal_check" CHECK (
    (state <> 'RESOLVED' OR ("resolvedAt" IS NOT NULL AND "routingDecision" IS NOT NULL AND "resolutionInboundProviderMessageId" IS NOT NULL)) AND
    ("resolutionInboundProviderMessageId" IS NULL OR state='RESOLVED') AND
    (state NOT IN ('RESOLVED','EXPIRED','IGNORED') OR
      ("inputJson" IS NULL AND "candidatesJson" IS NULL AND "moderationJson" IS NULL AND "promptText" IS NULL AND "workToken" IS NULL AND "nextRepairAt" IS NULL)));

CREATE FUNCTION whatsapp.arch076_sender_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'WhatsAppPoolSender' THEN
    IF (NEW."providerPhoneNumberId",NEW."providerAccountId") IS DISTINCT FROM (OLD."providerPhoneNumberId",OLD."providerAccountId") THEN
      RAISE EXCEPTION 'SENDER_INVENTORY_IDENTITY_IMMUTABLE';
    END IF;
  ELSIF TG_TABLE_NAME = 'RecoverySenderThread' THEN
    IF (NEW.id,NEW."canonicalRecipient",NEW."providerPhoneNumberId",NEW."openedAt") IS DISTINCT FROM (OLD.id,OLD."canonicalRecipient",OLD."providerPhoneNumberId",OLD."openedAt") THEN
      RAISE EXCEPTION 'SENDER_THREAD_IDENTITY_IMMUTABLE';
    END IF;
    IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN RAISE EXCEPTION 'SENDER_CLOSURE_IMMUTABLE'; END IF;
  ELSIF TG_TABLE_NAME = 'RecoverySenderRoute' THEN
    IF (NEW.id,NEW."shopId",NEW."threadId",NEW."canonicalRecipient",NEW."providerPhoneNumberId",NEW."openedAt") IS DISTINCT FROM (OLD.id,OLD."shopId",OLD."threadId",OLD."canonicalRecipient",OLD."providerPhoneNumberId",OLD."openedAt") THEN
      RAISE EXCEPTION 'SENDER_ROUTE_IDENTITY_IMMUTABLE';
    END IF;
    IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN RAISE EXCEPTION 'SENDER_CLOSURE_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch076_inventory_identity BEFORE UPDATE ON whatsapp."WhatsAppPoolSender" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_sender_identity_guard();
CREATE TRIGGER arch076_thread_identity BEFORE UPDATE ON whatsapp."RecoverySenderThread" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_sender_identity_guard();
CREATE TRIGGER arch076_route_identity BEFORE UPDATE ON whatsapp."RecoverySenderRoute" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_sender_identity_guard();

CREATE FUNCTION whatsapp.arch076_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE route_shop TEXT; owner_shop TEXT; conversation_shop TEXT; conversation_type TEXT; recovery_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."conversationId",NEW."routeId",NEW."assignedAt") IS DISTINCT FROM (OLD."conversationId",OLD."routeId",OLD."assignedAt") THEN RAISE EXCEPTION 'SENDER_ASSIGNMENT_IDENTITY_IMMUTABLE'; END IF;
    IF OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt" THEN RAISE EXCEPTION 'SENDER_RELEASE_IMMUTABLE'; END IF;
  END IF;
  SELECT r."shopId" INTO route_shop FROM whatsapp."RecoverySenderRoute" r WHERE r.id=NEW."routeId";
  -- Common owner-lock order with allowance admission: Conversation, then recovery.
  SELECT c."checkoutRecoveryId", c."shopId", c.type::text INTO recovery_id,conversation_shop,conversation_type FROM whatsapp."Conversation" c WHERE c.id=NEW."conversationId" FOR SHARE;
  SELECT cr."shopId" INTO owner_shop FROM commerce."CheckoutRecovery" cr WHERE cr.id=recovery_id FOR SHARE;
  IF route_shop IS NULL OR owner_shop IS NULL OR conversation_type <> 'RECOVERY' OR route_shop <> owner_shop OR (conversation_shop IS NOT NULL AND conversation_shop <> route_shop) THEN RAISE EXCEPTION 'SENDER_ASSIGNMENT_OWNER_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch076_assignment_owner BEFORE INSERT OR UPDATE ON whatsapp."RecoverySenderAssignment" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_assignment_guard();

CREATE FUNCTION whatsapp.arch076_routing_turn_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_route TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."inboundProviderMessageId",NEW."threadId",NEW."occurredAt",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM (OLD."inboundProviderMessageId",OLD."threadId",OLD."occurredAt",OLD."createdAt",OLD."expiresAt") THEN RAISE EXCEPTION 'ROUTING_ORIGINAL_IDENTITY_IMMUTABLE'; END IF;
    IF OLD."routeId" IS NOT NULL AND NEW."routeId" IS DISTINCT FROM OLD."routeId" THEN RAISE EXCEPTION 'ROUTING_ROUTE_IMMUTABLE'; END IF;
    IF OLD."routingDecision" IS NOT NULL AND NEW."routingDecision" IS DISTINCT FROM OLD."routingDecision" THEN RAISE EXCEPTION 'ROUTING_DECISION_IMMUTABLE'; END IF;
    IF OLD."promptAdmittedAt" IS NOT NULL AND NEW.state='RECEIVED' THEN RAISE EXCEPTION 'ROUTING_PROMPT_STATE_REGRESSION'; END IF;
    IF OLD."promptAdmittedAt" IS NOT NULL AND (NEW."promptScopeRouteId",NEW."promptAdmittedAt") IS DISTINCT FROM (OLD."promptScopeRouteId",OLD."promptAdmittedAt") THEN RAISE EXCEPTION 'ROUTING_PROMPT_SCOPE_IMMUTABLE'; END IF;
    IF OLD."promptProviderMessageId" IS NOT NULL AND (NEW."promptProviderMessageId",NEW."promptSentAt") IS DISTINCT FROM (OLD."promptProviderMessageId",OLD."promptSentAt") THEN RAISE EXCEPTION 'ROUTING_PROMPT_RECEIPT_IMMUTABLE'; END IF;
    IF OLD.state IN ('RESOLVED','EXPIRED','IGNORED') AND
       (NEW.state IS DISTINCT FROM OLD.state OR NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt" OR
        (NEW."selectedConversationId" IS DISTINCT FROM OLD."selectedConversationId" AND NEW."selectedConversationId" IS NOT NULL) OR
        (NEW."parentProviderMessageId" IS DISTINCT FROM OLD."parentProviderMessageId" AND NEW."parentProviderMessageId" IS NOT NULL) OR
        NEW."routeId" IS DISTINCT FROM OLD."routeId" OR NEW."routingDecision" IS DISTINCT FROM OLD."routingDecision" OR
        (NEW."configurationSnapshot" IS DISTINCT FROM OLD."configurationSnapshot" AND NEW."configurationSnapshot" IS NOT NULL) OR
        (NEW."promptScopeRouteId",NEW."promptAdmittedAt",NEW."promptSentAt",NEW."promptProviderMessageId") IS DISTINCT FROM
        (OLD."promptScopeRouteId",OLD."promptAdmittedAt",OLD."promptSentAt",OLD."promptProviderMessageId")) THEN RAISE EXCEPTION 'ROUTING_TERMINAL_IMMUTABLE'; END IF;
    IF (OLD."inputJson" IS NOT NULL AND NEW."inputJson" IS DISTINCT FROM OLD."inputJson") OR
       (OLD."candidatesJson" IS NOT NULL AND NEW."candidatesJson" IS DISTINCT FROM OLD."candidatesJson") OR
       (OLD."moderationJson" IS NOT NULL AND NEW."moderationJson" IS DISTINCT FROM OLD."moderationJson") THEN
      IF NOT (NEW.state IN ('RESOLVED','EXPIRED','IGNORED') AND NEW."inputJson" IS NULL AND NEW."candidatesJson" IS NULL AND NEW."moderationJson" IS NULL) THEN RAISE EXCEPTION 'ROUTING_INPUT_SNAPSHOT_IMMUTABLE'; END IF;
    END IF;
    IF OLD."resolutionInboundProviderMessageId" IS NOT NULL AND NEW."resolutionInboundProviderMessageId" IS DISTINCT FROM OLD."resolutionInboundProviderMessageId" THEN RAISE EXCEPTION 'ROUTING_RESOLVER_IMMUTABLE'; END IF;
    IF (OLD."selectedConversationId" IS NOT NULL OR OLD."resolutionInboundProviderMessageId" IS NOT NULL) AND NEW."selectedConversationId" IS DISTINCT FROM OLD."selectedConversationId" AND NEW."selectedConversationId" IS NOT NULL THEN RAISE EXCEPTION 'ROUTING_DECISION_OWNER_IMMUTABLE'; END IF;
    IF OLD."promptAdmittedAt" IS NOT NULL AND NEW."promptText" IS DISTINCT FROM OLD."promptText" AND NOT (NEW.state IN ('RESOLVED','EXPIRED','IGNORED') AND NEW."promptText" IS NULL) THEN RAISE EXCEPTION 'ROUTING_PROMPT_TEXT_IMMUTABLE'; END IF;
    IF OLD."configurationSnapshot" IS NOT NULL AND NEW."configurationSnapshot" IS DISTINCT FROM OLD."configurationSnapshot" AND NOT (NEW.state IN ('RESOLVED','EXPIRED','IGNORED') AND NEW."configurationSnapshot" IS NULL) THEN RAISE EXCEPTION 'ROUTING_CONFIGURATION_IMMUTABLE'; END IF;
    IF OLD."parentProviderMessageId" IS NOT NULL AND NEW."parentProviderMessageId" IS DISTINCT FROM OLD."parentProviderMessageId" THEN RAISE EXCEPTION 'ROUTING_PARENT_IMMUTABLE'; END IF;
  END IF;
  -- Validate initial/bind-once stamps only: deleted historical routes stay stamped.
  IF NEW."routeId" IS NOT NULL AND (TG_OP='INSERT' OR OLD."routeId" IS NULL) AND NOT EXISTS (SELECT 1 FROM whatsapp."RecoverySenderRoute" r WHERE r.id=NEW."routeId" AND r."threadId"=NEW."threadId") THEN RAISE EXCEPTION 'ROUTING_ROUTE_THREAD_MISMATCH'; END IF;
  IF NEW."promptScopeRouteId" IS NOT NULL AND (TG_OP='INSERT' OR OLD."promptAdmittedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM whatsapp."RecoverySenderRoute" r WHERE r.id=NEW."promptScopeRouteId" AND r."threadId"=NEW."threadId" AND r.id=NEW."routeId") THEN RAISE EXCEPTION 'ROUTING_PROMPT_THREAD_MISMATCH'; END IF;
  IF NEW."parentProviderMessageId" IS NOT NULL AND (TG_OP='INSERT' OR OLD."parentProviderMessageId" IS NULL) AND NOT EXISTS (SELECT 1 FROM whatsapp."RecoveryBasketRoutingTurn" p WHERE p."inboundProviderMessageId"=NEW."parentProviderMessageId" AND p."threadId"=NEW."threadId" AND p."inboundProviderMessageId"<>NEW."inboundProviderMessageId") THEN RAISE EXCEPTION 'ROUTING_PARENT_THREAD_MISMATCH'; END IF;
  IF NEW."selectedConversationId" IS NOT NULL AND (NEW."routingDecision" IS NULL OR NEW."resolutionInboundProviderMessageId" IS NULL) THEN RAISE EXCEPTION 'ROUTING_SELECTION_REQUIRES_DECISION'; END IF;
  IF NEW."selectedConversationId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."selectedConversationId" IS DISTINCT FROM OLD."selectedConversationId") THEN
    SELECT a."routeId" INTO selected_route FROM whatsapp."RecoverySenderAssignment" a JOIN whatsapp."RecoverySenderRoute" r ON r.id=a."routeId" WHERE a."conversationId"=NEW."selectedConversationId" AND r."threadId"=NEW."threadId";
    IF selected_route IS NULL OR selected_route IS DISTINCT FROM NEW."routeId" THEN RAISE EXCEPTION 'ROUTING_SELECTED_OWNER_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch076_routing_turn_evidence BEFORE INSERT OR UPDATE ON whatsapp."RecoveryBasketRoutingTurn" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_routing_turn_guard();

-- Scope stamps survive deleted shops, while pending private content cannot remain actionable.
CREATE FUNCTION whatsapp.arch076_deleted_route_scrub() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE whatsapp."RecoveryBasketRoutingTurn" SET state='EXPIRED',"inputJson"=NULL,"candidatesJson"=NULL,"moderationJson"=NULL,"configurationSnapshot"=NULL,"promptText"=NULL,"workToken"=NULL,"workLeaseUntil"=NULL,"nextRepairAt"=NULL,"updatedAt"=clock_timestamp()
    WHERE state IN ('RECEIVED','PROMPT_ADMITTED','PROMPT_UNKNOWN') AND ("routeId"=OLD.id OR "promptScopeRouteId"=OLD.id);
  RETURN OLD;
END $$;
CREATE TRIGGER arch076_route_delete_scrub AFTER DELETE ON whatsapp."RecoverySenderRoute" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_deleted_route_scrub();

CREATE FUNCTION whatsapp.arch076_dispatch_sender_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."dispatchProviderAccountId" IS NOT NULL AND (NEW."dispatchProviderAccountId",NEW."dispatchProviderPhoneNumberId") IS DISTINCT FROM (OLD."dispatchProviderAccountId",OLD."dispatchProviderPhoneNumberId") THEN RAISE EXCEPTION 'DISPATCH_SENDER_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch076_dispatch_sender_identity BEFORE UPDATE ON whatsapp."ConversationMessage" FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_dispatch_sender_guard();

-- An assignment can disappear only with its Conversation, never be recreated on another generation.
CREATE FUNCTION whatsapp.arch076_assignment_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM whatsapp."Conversation" WHERE id=OLD."conversationId") THEN RAISE EXCEPTION 'SENDER_ASSIGNMENT_DELETE_FORBIDDEN'; END IF;
  RETURN OLD;
END $$;
CREATE CONSTRAINT TRIGGER arch076_assignment_delete AFTER DELETE ON whatsapp."RecoverySenderAssignment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_assignment_delete_guard();

-- Owner edits must not invalidate an assignment that was valid when created.
-- Deferred checks permit a consistent multi-row owner transaction and whole-owner deletion.
CREATE FUNCTION whatsapp.arch076_assignment_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invalid_owner BOOLEAN;
BEGIN
  IF TG_TABLE_NAME='Conversation' THEN
    SELECT EXISTS (
      SELECT 1 FROM whatsapp."RecoverySenderAssignment" a
      JOIN whatsapp."RecoverySenderRoute" r ON r.id=a."routeId"
      JOIN whatsapp."Conversation" c ON c.id=a."conversationId"
      LEFT JOIN commerce."CheckoutRecovery" cr ON cr.id=c."checkoutRecoveryId"
      WHERE a."conversationId"=NEW.id AND
        (c.type::text <> 'RECOVERY' OR cr.id IS NULL OR cr."shopId"<>r."shopId" OR
         (c."shopId" IS NOT NULL AND c."shopId"<>r."shopId"))
    ) INTO invalid_owner;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM whatsapp."Conversation" c
      JOIN whatsapp."RecoverySenderAssignment" a ON a."conversationId"=c.id
      JOIN whatsapp."RecoverySenderRoute" r ON r.id=a."routeId"
      LEFT JOIN commerce."CheckoutRecovery" cr ON cr.id=c."checkoutRecoveryId"
      WHERE c."checkoutRecoveryId"=NEW.id AND
        (c.type::text <> 'RECOVERY' OR cr.id IS NULL OR cr."shopId"<>r."shopId" OR
         (c."shopId" IS NOT NULL AND c."shopId"<>r."shopId"))
    ) INTO invalid_owner;
  END IF;
  IF invalid_owner THEN RAISE EXCEPTION 'SENDER_ASSIGNMENT_PARENT_OWNER_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER arch076_conversation_assignment_owner AFTER UPDATE OF "shopId", "checkoutRecoveryId", type ON whatsapp."Conversation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_assignment_parent_guard();
CREATE CONSTRAINT TRIGGER arch076_recovery_assignment_owner AFTER UPDATE OF "shopId" ON commerce."CheckoutRecovery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_assignment_parent_guard();

-- Classification evidence and later resolution are different immutable facts.
-- Validate at commit so child/original admission can be written in either order.
CREATE FUNCTION whatsapp.arch076_resolution_witness_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE; resolver whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE;
BEGIN
  SELECT * INTO original FROM whatsapp."RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"=NEW."inboundProviderMessageId";
  IF NOT FOUND OR original."resolutionInboundProviderMessageId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO resolver FROM whatsapp."RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"=original."resolutionInboundProviderMessageId";
  IF NOT FOUND THEN RAISE EXCEPTION 'ROUTING_RESOLVER_MISSING'; END IF;
  IF resolver."threadId"<>original."threadId" OR resolver."routeId" IS DISTINCT FROM original."routeId" OR
     resolver.state<>'RESOLVED' OR resolver."routingDecision" IS NULL OR
     resolver."resolutionInboundProviderMessageId" IS DISTINCT FROM resolver."inboundProviderMessageId" OR
     resolver."selectedConversationId" IS DISTINCT FROM original."selectedConversationId" THEN RAISE EXCEPTION 'ROUTING_RESOLVER_OWNER_MISMATCH'; END IF;
  IF COALESCE(resolver."routingDecision"->>'role','') NOT IN ('NEW_QUESTION','SELECT_ONLY','SELECT_AND_QUESTION') THEN RAISE EXCEPTION 'ROUTING_RESOLVER_ROLE_MISMATCH'; END IF;
  IF resolver."routingDecision"->>'currentInboundProviderMessageId' IS DISTINCT FROM resolver."inboundProviderMessageId" THEN RAISE EXCEPTION 'ROUTING_RESOLVER_INBOUND_MISMATCH'; END IF;
  IF resolver."inboundProviderMessageId"<>original."inboundProviderMessageId" AND (
     resolver."parentProviderMessageId" IS DISTINCT FROM original."inboundProviderMessageId" OR
     COALESCE(resolver."routingDecision"->>'role','') NOT IN ('SELECT_ONLY','SELECT_AND_QUESTION') OR
     resolver."routingDecision"->>'originalTurnId' IS DISTINCT FROM original."inboundProviderMessageId" OR
     resolver."routingDecision"->>'currentInboundProviderMessageId' IS DISTINCT FROM resolver."inboundProviderMessageId" OR
     resolver."routingDecision"->>'promptTurnId' IS DISTINCT FROM original."inboundProviderMessageId" OR
     original."promptSentAt" IS NULL OR original."promptProviderMessageId" IS NULL OR
     resolver."routingDecision"->>'confirmedPromptProviderMessageId' IS DISTINCT FROM original."promptProviderMessageId"
  ) THEN RAISE EXCEPTION 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER arch076_resolution_witness AFTER INSERT OR UPDATE ON whatsapp."RecoveryBasketRoutingTurn" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_resolution_witness_guard();

-- Retention/deletion checks must not scan all historical requests.
CREATE INDEX "RecoveryBasketRoutingTurn_parent_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("parentProviderMessageId") WHERE "parentProviderMessageId" IS NOT NULL;
CREATE INDEX "RecoveryBasketRoutingTurn_resolution_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("resolutionInboundProviderMessageId") WHERE "resolutionInboundProviderMessageId" IS NOT NULL;
CREATE INDEX "RecoveryBasketRoutingTurn_selected_idx" ON whatsapp."RecoveryBasketRoutingTurn" ("selectedConversationId") WHERE "selectedConversationId" IS NOT NULL;
