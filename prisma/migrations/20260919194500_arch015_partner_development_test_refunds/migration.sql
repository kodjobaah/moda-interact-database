-- Allow no-charge Shopify App Pricing development-store refund workflows.
-- Existing refund rows default to production semantics (false). The application
-- may set this snapshot only from authenticated Shopify Admin shop.plan.partnerDevelopment.
-- This migration is pure DDL and is safe when RecoveryCreditRefund is empty.

ALTER TABLE "billing"."RecoveryCreditRefund"
ADD COLUMN "shopifyPartnerDevelopmentSnapshot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "billing"."RecoveryCreditRefund"
DROP CONSTRAINT IF EXISTS "RecoveryCreditRefund_snapshot_amounts";

ALTER TABLE "billing"."RecoveryCreditRefund"
ADD CONSTRAINT "RecoveryCreditRefund_snapshot_amounts"
CHECK (
    "purchaseCreditsGrantedSnapshot" > 0
    AND "purchaseProviderAmountSnapshot" >= 0
    AND (
        "purchaseProviderAmountSnapshot" > 0
        OR "shopifyPartnerDevelopmentSnapshot" = true
    )
    AND "currentAmountAtRequestSnapshot" >= 0
    AND "currentAmountAtRequestSnapshot" <= "purchaseCreditsGrantedSnapshot"
    AND "reservedAmountAtRequestSnapshot" >= 0
    AND "reservedAmountAtRequestSnapshot" <= "currentAmountAtRequestSnapshot"
    AND "availableAmountAtRequestSnapshot" = "currentAmountAtRequestSnapshot" - "reservedAmountAtRequestSnapshot"
    AND "availableAmountAtRequestSnapshot" > 0
    AND ("finalCreditQuantity" IS NULL OR "finalCreditQuantity" > 0)
    AND ("finalCreditQuantity" IS NULL OR "finalCreditQuantity" <= "currentAmountAtRequestSnapshot")
    AND ("expectedProviderAmount" IS NULL OR "expectedProviderAmount" >= 0)
);
