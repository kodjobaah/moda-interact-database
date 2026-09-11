CREATE TYPE "commerce"."RecoveryAdmissionBlockReason" AS ENUM ('RECOVERY_CAPACITY_EXHAUSTED');

ALTER TABLE "commerce"."CheckoutRecovery"
ADD COLUMN "admissionBlockedAt" TIMESTAMP(3),
ADD COLUMN "admissionBlockReason" "commerce"."RecoveryAdmissionBlockReason";

CREATE INDEX "CheckoutRecovery_shopId_admissionBlockReason_status_detectedAt_idx"
ON "commerce"."CheckoutRecovery"("shopId", "admissionBlockReason", "status", "detectedAt");

ALTER TABLE "commerce"."CheckoutRecovery"
ADD CONSTRAINT "CheckoutRecovery_admission_block_pair"
CHECK (
  ("admissionBlockedAt" IS NULL AND "admissionBlockReason" IS NULL)
  OR ("admissionBlockedAt" IS NOT NULL AND "admissionBlockReason" IS NOT NULL)
);