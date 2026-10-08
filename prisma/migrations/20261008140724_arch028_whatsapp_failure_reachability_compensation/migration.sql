CREATE TYPE "billing"."UsageReservationCompensationReason" AS ENUM (
  'WHATSAPP_RECIPIENT_UNDELIVERABLE'
);

CREATE TYPE "billing"."UsageReservationCompensationDisposition" AS ENUM (
  'RESTORED_SPENDABLE',
  'HELD_FOR_REFUND',
  'HISTORICAL_ONLY'
);

ALTER TYPE "commerce"."RecoveryAdmissionBlockReason"
  ADD VALUE 'WHATSAPP_RECIPIENT_SUPPRESSED';

ALTER TABLE "whatsapp"."ConversationMessage"
  ADD COLUMN "providerFailureCode" VARCHAR(64),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD CONSTRAINT "ConversationMessage_providerFailureCode_check"
    CHECK (
      "providerFailureCode" IS NULL
      OR ("providerFailureCode" ~ '[^[:space:]]'
        AND "providerFailureCode" !~ '^[[:space:]]|[[:space:]]$'
        AND "failedAt" IS NOT NULL)
    );

ALTER TABLE "billing"."PlatformBillingPolicy"
  ADD COLUMN "whatsappRecipientSuppressionDays" INTEGER NOT NULL DEFAULT 7,
  ADD CONSTRAINT "PlatformBillingPolicy_whatsappRecipientSuppressionDays_check"
    CHECK ("whatsappRecipientSuppressionDays" > 0);

ALTER TABLE "billing"."UsageReservation"
  ADD COLUMN "compensationUsageEventId" TEXT,
  ADD COLUMN "compensationReason" "billing"."UsageReservationCompensationReason",
  ADD COLUMN "compensationDisposition" "billing"."UsageReservationCompensationDisposition",
  ADD COLUMN "compensatedAt" TIMESTAMP(3),
  ADD CONSTRAINT "UsageReservation_compensation_fields_all_or_none_check"
    CHECK (
      ("compensationUsageEventId" IS NULL
        AND "compensationReason" IS NULL
        AND "compensationDisposition" IS NULL
        AND "compensatedAt" IS NULL)
      OR
      ("compensationUsageEventId" IS NOT NULL
        AND "compensationReason" IS NOT NULL
        AND "compensationDisposition" IS NOT NULL
        AND "compensatedAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "UsageReservation_compensationUsageEventId_key"
    UNIQUE ("compensationUsageEventId"),
  ADD CONSTRAINT "UsageReservation_compensationUsageEventId_fkey"
    FOREIGN KEY ("compensationUsageEventId")
    REFERENCES "billing"."UsageEvent"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "whatsapp"."WhatsAppRecipientReachability" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "recipient" VARCHAR(64) NOT NULL,
  "lastProviderFailureCode" VARCHAR(64),
  "lastFailureAt" TIMESTAMP(3),
  "suppressUntil" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppRecipientReachability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppRecipientReachability_recipient_check"
    CHECK (("recipient" COLLATE "C") ~ '^[0-9]{1,64}$'),
  CONSTRAINT "WhatsAppRecipientReachability_failureCode_check"
    CHECK (
      "lastProviderFailureCode" IS NULL
      OR ("lastProviderFailureCode" ~ '[^[:space:]]'
        AND "lastProviderFailureCode" !~ '^[[:space:]]|[[:space:]]$'
        AND "lastFailureAt" IS NOT NULL)
    ),
  CONSTRAINT "WhatsAppRecipientReachability_suppression_check"
    CHECK (
      "suppressUntil" IS NULL
      OR ("lastFailureAt" IS NOT NULL AND "suppressUntil" > "lastFailureAt")
    ),
  CONSTRAINT "WhatsAppRecipientReachability_version_check"
    CHECK ("version" >= 0),
  CONSTRAINT "WhatsAppRecipientReachability_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WhatsAppRecipientReachability_shopId_recipient_key"
  ON "whatsapp"."WhatsAppRecipientReachability"("shopId", "recipient");
CREATE INDEX "WhatsAppRecipientReachability_shopId_suppressUntil_idx"
  ON "whatsapp"."WhatsAppRecipientReachability"("shopId", "suppressUntil");

CREATE FUNCTION billing.arch028_assert_reservation_compensation(target_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "billing"."UsageReservation" AS reservation
    WHERE reservation."id" = target_id
      AND reservation."compensationUsageEventId" IS NOT NULL
      AND (
        reservation."status" <> 'COMMITTED'
        OR reservation."committedUsageEventId" IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM "billing"."UsageEvent" AS original
          JOIN "billing"."UsageEvent" AS correction
            ON correction."id" = reservation."compensationUsageEventId"
          WHERE original."id" = reservation."committedUsageEventId"
            AND original."shopId" = reservation."shopId"
            AND original."metric" = 'RECOVERY_CONVERSATION'
            AND original."quantity" > 0
            AND original."quantity" = reservation."quantity"
            AND correction."shopId" = original."shopId"
            AND correction."metric" = 'RECOVERY_CONVERSATION'
            AND correction."quantity" = -original."quantity"
            AND correction."correctionOfUsageEventId" = original."id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'ARCH028 compensation must link the exact same-Shop negative recovery correction to its committed source'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION billing.arch028_usage_reservation_compensation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM billing.arch028_assert_reservation_compensation(NEW."id");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER arch028_usage_reservation_compensation_guard
  AFTER INSERT OR UPDATE ON "billing"."UsageReservation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch028_usage_reservation_compensation_guard();

CREATE FUNCTION billing.arch028_usage_event_compensation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_reservation_id TEXT;
BEGIN
  FOR affected_reservation_id IN
    SELECT reservation."id"
    FROM "billing"."UsageReservation" AS reservation
    WHERE reservation."compensationUsageEventId" IS NOT NULL
      AND (reservation."committedUsageEventId" = NEW."id"
        OR reservation."compensationUsageEventId" = NEW."id")
  LOOP
    PERFORM billing.arch028_assert_reservation_compensation(affected_reservation_id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER arch028_usage_event_compensation_guard
  AFTER INSERT OR UPDATE ON "billing"."UsageEvent"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch028_usage_event_compensation_guard();
