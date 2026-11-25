-- Additive, inert retry decisions. Do not change the existing logical-slot unique key.
BEGIN;

CREATE TYPE "commerce"."RecoveryOutreachRetryPolicy" AS ENUM (
  'AFTER_COOLDOWN', 'PROVIDER_POLICY_HOLD', 'REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'DO_NOT_RETRY'
);

CREATE TABLE "commerce"."RecoveryOutreachRetryIntent" (
  "id" TEXT NOT NULL,
  "failedAttemptId" TEXT NOT NULL,
  "failedMessageId" TEXT NOT NULL,
  "fundingReservationId" TEXT NOT NULL,
  "providerFailureCode" VARCHAR(64),
  "policy" "commerce"."RecoveryOutreachRetryPolicy" NOT NULL,
  "notBeforeAt" TIMESTAMPTZ(3),
  "expectedGeneration" INTEGER NOT NULL,
  "expectedLastExternalActivityAt" TIMESTAMP(3) NOT NULL,
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RecoveryOutreachRetryIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecoveryOutreachRetryIntent_due_check" CHECK (
    ("policy" IN ('AFTER_COOLDOWN', 'PROVIDER_POLICY_HOLD') AND "notBeforeAt" IS NOT NULL)
    OR ("policy" IN ('REPAIR_REQUIRED', 'REVIEW_REQUIRED', 'DO_NOT_RETRY') AND "notBeforeAt" IS NULL)
  ),
  CONSTRAINT "RecoveryOutreachRetryIntent_generation_check" CHECK ("expectedGeneration" > 0),
  CONSTRAINT "RecoveryOutreachRetryIntent_failedAttemptId_fkey"
    FOREIGN KEY ("failedAttemptId") REFERENCES "commerce"."RecoveryOutreachAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecoveryOutreachRetryIntent_failedMessageId_fkey"
    FOREIGN KEY ("failedMessageId") REFERENCES "whatsapp"."ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecoveryOutreachRetryIntent_fundingReservationId_fkey"
    FOREIGN KEY ("fundingReservationId") REFERENCES "billing"."UsageReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RecoveryOutreachRetryIntent_failedAttemptId_key" ON "commerce"."RecoveryOutreachRetryIntent"("failedAttemptId");
CREATE UNIQUE INDEX "RecoveryOutreachRetryIntent_failedMessageId_key" ON "commerce"."RecoveryOutreachRetryIntent"("failedMessageId");
CREATE UNIQUE INDEX "RecoveryOutreachRetryIntent_fundingReservationId_key" ON "commerce"."RecoveryOutreachRetryIntent"("fundingReservationId");
CREATE INDEX "RecoveryOutreachRetryIntent_policy_cancelledAt_notBeforeAt_idx" ON "commerce"."RecoveryOutreachRetryIntent"("policy", "cancelledAt", "notBeforeAt");

COMMIT;
