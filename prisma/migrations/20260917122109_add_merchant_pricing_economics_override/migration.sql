ALTER TABLE "billing"."MerchantPricingPlan"
ADD COLUMN "economicsOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "economicsOverrideReason" TEXT,
ADD COLUMN "economicsOverrideApprovedAt" TIMESTAMP(3),
ADD COLUMN "economicsOverrideApprovedByAdminId" TEXT,
ADD COLUMN "economicsOverrideFailureCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "economicsOverrideFingerprint" VARCHAR(64);
