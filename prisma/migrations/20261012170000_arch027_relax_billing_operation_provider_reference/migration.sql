-- ARCH-027-DATABASE-003: providerReference is nullable, provider-neutral evidence.
-- Leave the accepted DATABASE-001 migration and all provider-reference values intact.
-- Preserve BillingOperation_providerReference_check and arch027_billing_operation_guard
-- for nonblank-if-present validation and write-once evidence integrity.
BEGIN;

ALTER TABLE "billing"."BillingOperation"
  DROP CONSTRAINT "BillingOperation_kind_shape_check",
  DROP CONSTRAINT "BillingOperation_state_provider_reference_check",
  ADD CONSTRAINT "BillingOperation_kind_shape_check"
    CHECK (
      (
        "kind" = 'SUBSCRIPTION_CREATE'
        AND "merchantPricingPlanId" IS NOT NULL
        AND "merchantPricingUsageEventId" IS NULL
        AND "quotedAmountMinor" IS NOT NULL AND "quotedAmountMinor" > 0
        AND "quotedCurrency" IS NOT NULL
        AND "quotedBillingPeriod" IS NOT NULL
        AND "recoveryCreditPurchaseId" IS NULL
      )
      OR
      (
        "kind" = 'PLAN_SWITCH'
        AND "merchantPricingPlanId" IS NOT NULL
        AND "merchantPricingUsageEventId" IS NULL
        AND "quotedAmountMinor" IS NOT NULL AND "quotedAmountMinor" > 0
        AND "quotedCurrency" IS NOT NULL
        AND "quotedBillingPeriod" IS NOT NULL
        AND "recoveryCreditPurchaseId" IS NULL
      )
      OR
      (
        "kind" = 'ONE_TIME_CHARGE'
        AND "merchantPricingPlanId" IS NULL
        AND "merchantPricingUsageEventId" IS NOT NULL
        AND "quotedAmountMinor" IS NOT NULL AND "quotedAmountMinor" > 0
        AND "quotedCurrency" IS NOT NULL
        AND "quotedBillingPeriod" IS NULL
      )
      OR
      (
        "kind" = 'CANCEL'
        AND "merchantPricingPlanId" IS NULL
        AND "merchantPricingUsageEventId" IS NULL
        AND "quotedAmountMinor" IS NULL
        AND "quotedCurrency" IS NULL
        AND "quotedBillingPeriod" IS NULL
        AND "recoveryCreditPurchaseId" IS NULL
      )
    );

COMMIT;
