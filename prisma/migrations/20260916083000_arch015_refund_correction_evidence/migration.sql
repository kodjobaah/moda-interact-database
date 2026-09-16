ALTER TABLE "billing"."RecoveryCreditRefund"
  ADD COLUMN "automaticCorrectionUsageEventId" TEXT,
  ADD COLUMN "providerUsageQuantityBeforeCorrection" DECIMAL(65,30),
  ADD COLUMN "providerUsageCostBeforeCorrection" DECIMAL(65,30),
  ADD COLUMN "expectedProviderUsageQuantityAfterCorrection" DECIMAL(65,30),
  ADD COLUMN "expectedProviderUsageCostAfterCorrection" DECIMAL(65,30);

CREATE UNIQUE INDEX "RecoveryCreditRefund_automaticCorrectionUsageEventId_key"
  ON "billing"."RecoveryCreditRefund"("automaticCorrectionUsageEventId");

ALTER TABLE "billing"."RecoveryCreditRefund"
  ADD CONSTRAINT "RecoveryCreditRefund_automaticCorrectionUsageEventId_fkey"
  FOREIGN KEY ("automaticCorrectionUsageEventId") REFERENCES "billing"."UsageEvent"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing"."RecoveryCreditRefund"
  ADD CONSTRAINT "ck_arch015_refund_automatic_correction_evidence_group"
  CHECK (
    (
      "automaticCorrectionUsageEventId" IS NULL
      AND "providerUsageQuantityBeforeCorrection" IS NULL
      AND "providerUsageCostBeforeCorrection" IS NULL
      AND "expectedProviderUsageQuantityAfterCorrection" IS NULL
      AND "expectedProviderUsageCostAfterCorrection" IS NULL
    )
    OR (
      "automaticCorrectionUsageEventId" IS NOT NULL
      AND "providerUsageQuantityBeforeCorrection" IS NOT NULL
      AND "providerUsageCostBeforeCorrection" IS NOT NULL
      AND "expectedProviderUsageQuantityAfterCorrection" IS NOT NULL
      AND "expectedProviderUsageCostAfterCorrection" IS NOT NULL
      AND "finalCreditQuantity" IS NOT NULL
      AND "expectedProviderAmount" IS NOT NULL
      AND "expectedProviderCurrency" IS NOT NULL
    )
  );

ALTER TABLE "billing"."RecoveryCreditRefund"
  ADD CONSTRAINT "ck_arch015_refund_automatic_correction_nonnegative"
  CHECK (
    "automaticCorrectionUsageEventId" IS NULL
    OR (
      "providerUsageQuantityBeforeCorrection" >= 0
      AND "providerUsageCostBeforeCorrection" >= 0
      AND "expectedProviderUsageQuantityAfterCorrection" >= 0
      AND "expectedProviderUsageCostAfterCorrection" >= 0
      AND "finalCreditQuantity" > 0
      AND "expectedProviderAmount" >= 0
    )
  );