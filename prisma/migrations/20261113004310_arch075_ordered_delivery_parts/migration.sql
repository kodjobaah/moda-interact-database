-- Additive ARCH-075 tables only; preserve all existing roots and baseline objects.
-- CreateEnum
CREATE TYPE "whatsapp"."ConversationDeliveryPartRole" AS ENUM ('HEADER', 'PRODUCT', 'ANSWER');

-- CreateEnum
CREATE TYPE "whatsapp"."ConversationDeliveryPartState" AS ENUM ('PREPARED', 'ADMITTED', 'ACKNOWLEDGED', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "whatsapp"."ConversationDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp"."ConversationDeliveryPart" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "ordinal" SMALLINT NOT NULL,
    "role" "whatsapp"."ConversationDeliveryPartRole" NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadDigest" VARCHAR(64) NOT NULL,
    "sourceIdentity" JSONB NOT NULL,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "state" "whatsapp"."ConversationDeliveryPartState" NOT NULL DEFAULT 'PREPARED',
    "providerAccountId" VARCHAR(128) NOT NULL,
    "providerPhoneNumberId" VARCHAR(128) NOT NULL,
    "providerDispatchKey" VARCHAR(128),
    "providerDispatchAdmittedAt" TIMESTAMPTZ(3),
    "providerMessageId" VARCHAR(512),
    "acknowledgedAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "unknownAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationDeliveryPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."ConversationDeliveryStatusReceipt" (
    "id" TEXT NOT NULL,
    "providerAccountId" VARCHAR(128) NOT NULL,
    "providerPhoneNumberId" VARCHAR(128) NOT NULL,
    "providerMessageId" VARCHAR(512) NOT NULL,
    "status" "whatsapp"."ConversationDeliveryStatus" NOT NULL,
    "providerTimestamp" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCode" VARCHAR(64),
    "partId" TEXT,

    CONSTRAINT "ConversationDeliveryStatusReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDeliveryPart_providerDispatchKey_key" ON "whatsapp"."ConversationDeliveryPart"("providerDispatchKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDeliveryPart_providerMessageId_key" ON "whatsapp"."ConversationDeliveryPart"("providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationDeliveryPart_state_deadlineAt_idx" ON "whatsapp"."ConversationDeliveryPart"("state", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDeliveryPart_messageId_ordinal_key" ON "whatsapp"."ConversationDeliveryPart"("messageId", "ordinal");

-- CreateIndex
CREATE INDEX "ConversationDeliveryStatusReceipt_partId_idx" ON "whatsapp"."ConversationDeliveryStatusReceipt"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDeliveryStatusReceipt_sender_status_key" ON "whatsapp"."ConversationDeliveryStatusReceipt"("providerAccountId", "providerPhoneNumberId", "providerMessageId", "status", "providerTimestamp");

-- AddForeignKey
ALTER TABLE "whatsapp"."ConversationDeliveryPart" ADD CONSTRAINT "ConversationDeliveryPart_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "whatsapp"."ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."ConversationDeliveryStatusReceipt" ADD CONSTRAINT "ConversationDeliveryStatusReceipt_partId_fkey" FOREIGN KEY ("partId") REFERENCES "whatsapp"."ConversationDeliveryPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every query is bounded by root identity or the pending state/deadline. Three
-- unique bounded ordinals cap storage/fanout without introducing a second ledger.
ALTER TABLE "whatsapp"."ConversationDeliveryPart"
  ADD CONSTRAINT "ConversationDeliveryPart_ordinal_check" CHECK ("ordinal" BETWEEN 0 AND 2),
  ADD CONSTRAINT "ConversationDeliveryPart_payload_check" CHECK (
    jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 65536),
  ADD CONSTRAINT "ConversationDeliveryPart_source_check" CHECK (
    jsonb_typeof("sourceIdentity") = 'object' AND octet_length("sourceIdentity"::text) <= 16384),
  ADD CONSTRAINT "ConversationDeliveryPart_digest_check" CHECK ("payloadDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "ConversationDeliveryPart_sender_check" CHECK (
    "providerAccountId" ~ '^[A-Za-z0-9_-]+$' AND "providerPhoneNumberId" ~ '^[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT "ConversationDeliveryPart_dispatch_check" CHECK (
    ("providerDispatchKey" IS NULL) = ("providerDispatchAdmittedAt" IS NULL)
    AND ("providerDispatchKey" IS NULL OR length(btrim("providerDispatchKey")) > 0)),
  ADD CONSTRAINT "ConversationDeliveryPart_ack_check" CHECK (
    ("providerMessageId" IS NULL) = ("acknowledgedAt" IS NULL)
    AND ("providerMessageId" IS NULL OR (length(btrim("providerMessageId")) > 0 AND "providerDispatchKey" IS NOT NULL))),
  ADD CONSTRAINT "ConversationDeliveryPart_state_evidence_check" CHECK (
    ("state" <> 'PREPARED' OR ("providerDispatchKey" IS NULL AND "providerMessageId" IS NULL))
    AND ("state" <> 'ADMITTED' OR ("providerDispatchKey" IS NOT NULL AND "providerMessageId" IS NULL))
    AND ("state" NOT IN ('ACKNOWLEDGED','DELIVERED','READ') OR "providerMessageId" IS NOT NULL)
    AND ("state" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL)
    AND ("state" <> 'READ' OR "readAt" IS NOT NULL)
    AND ("state" <> 'FAILED' OR "failedAt" IS NOT NULL)
    AND ("state" <> 'UNKNOWN' OR ("unknownAt" IS NOT NULL AND "providerDispatchKey" IS NOT NULL))
    AND ("state" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "providerDispatchKey" IS NULL))),
  ADD CONSTRAINT "ConversationDeliveryPart_failure_code_check" CHECK (
    "failureCode" IS NULL OR "failureCode" ~ '^[A-Za-z0-9_.:-]+$');

ALTER TABLE "whatsapp"."ConversationDeliveryStatusReceipt"
  ADD CONSTRAINT "ConversationDeliveryStatusReceipt_identity_check" CHECK (
    "providerAccountId" ~ '^[A-Za-z0-9_-]+$' AND "providerPhoneNumberId" ~ '^[A-Za-z0-9_-]+$'
    AND length(btrim("providerMessageId")) > 0),
  ADD CONSTRAINT "ConversationDeliveryStatusReceipt_failure_code_check" CHECK (
    "failureCode" IS NULL OR "failureCode" ~ '^[A-Za-z0-9_.:-]+$');

-- The sender-prefixed dedupe index also supports exact provider-ID ACK lookup.
-- Retention scans touch only unmatched receipts, in bounded receivedAt/id pages.
CREATE INDEX "ConversationDeliveryStatusReceipt_unmatched_received_idx"
ON "whatsapp"."ConversationDeliveryStatusReceipt" ("receivedAt", "id")
WHERE "partId" IS NULL;

CREATE FUNCTION "whatsapp"."guard_conversation_delivery_part"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."messageId" IS DISTINCT FROM OLD."messageId"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."payloadDigest" IS DISTINCT FROM OLD."payloadDigest"
    OR NEW."sourceIdentity" IS DISTINCT FROM OLD."sourceIdentity"
    OR NEW."deadlineAt" IS DISTINCT FROM OLD."deadlineAt"
    OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
    OR NEW."providerPhoneNumberId" IS DISTINCT FROM OLD."providerPhoneNumberId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'DELIVERY_PART_PREPARATION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF (OLD."providerDispatchKey" IS NOT NULL AND NEW."providerDispatchKey" IS DISTINCT FROM OLD."providerDispatchKey")
    OR (OLD."providerDispatchAdmittedAt" IS NOT NULL AND NEW."providerDispatchAdmittedAt" IS DISTINCT FROM OLD."providerDispatchAdmittedAt")
    OR (OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId")
    OR (OLD."acknowledgedAt" IS NOT NULL AND NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt")
    OR (OLD."deliveredAt" IS NOT NULL AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt")
    OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt")
    OR (OLD."failedAt" IS NOT NULL AND NEW."failedAt" IS DISTINCT FROM OLD."failedAt")
    OR (OLD."unknownAt" IS NOT NULL AND NEW."unknownAt" IS DISTINCT FROM OLD."unknownAt")
    OR (OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt")
    OR (OLD."failureCode" IS NOT NULL AND NEW."failureCode" IS DISTINCT FROM OLD."failureCode") THEN
    RAISE EXCEPTION 'DELIVERY_PART_OUTCOME_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  -- Durable anti-reset guards, not the application's complete state machine.
  IF (OLD."state" = 'CANCELLED' AND NEW."state" <> 'CANCELLED')
    OR (OLD."state" <> 'PREPARED' AND NEW."state" = 'PREPARED')
    OR (OLD."providerMessageId" IS NOT NULL AND NEW."state" IN ('ADMITTED','UNKNOWN','CANCELLED'))
    OR (OLD."state" = 'READ' AND NEW."state" <> 'READ')
    OR (OLD."state" = 'DELIVERED' AND NEW."state" NOT IN ('DELIVERED','READ'))
    OR (OLD."state" IN ('FAILED','CANCELLED') AND NEW."state" IN ('PREPARED','ADMITTED')) THEN
    RAISE EXCEPTION 'DELIVERY_PART_OUTCOME_REGRESSION' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConversationDeliveryPart_immutable"
BEFORE UPDATE ON "whatsapp"."ConversationDeliveryPart"
FOR EACH ROW EXECUTE FUNCTION "whatsapp"."guard_conversation_delivery_part"();

CREATE FUNCTION "whatsapp"."guard_conversation_delivery_status_receipt"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."providerAccountId" IS DISTINCT FROM OLD."providerAccountId"
    OR NEW."providerPhoneNumberId" IS DISTINCT FROM OLD."providerPhoneNumberId"
    OR NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."providerTimestamp" IS DISTINCT FROM OLD."providerTimestamp"
    OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
    OR NEW."failureCode" IS DISTINCT FROM OLD."failureCode"
    OR (OLD."partId" IS NOT NULL AND NEW."partId" IS DISTINCT FROM OLD."partId")) THEN
    RAISE EXCEPTION 'DELIVERY_STATUS_RECEIPT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW."partId" IS NOT NULL THEN
    PERFORM 1 FROM "whatsapp"."ConversationDeliveryPart" p
    WHERE p."id"=NEW."partId" AND p."providerAccountId"=NEW."providerAccountId"
      AND p."providerPhoneNumberId"=NEW."providerPhoneNumberId"
      AND p."providerMessageId"=NEW."providerMessageId" FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DELIVERY_STATUS_SENDER_OR_MESSAGE_MISMATCH' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConversationDeliveryStatusReceipt_immutable"
BEFORE INSERT OR UPDATE ON "whatsapp"."ConversationDeliveryStatusReceipt"
FOR EACH ROW EXECUTE FUNCTION "whatsapp"."guard_conversation_delivery_status_receipt"();
