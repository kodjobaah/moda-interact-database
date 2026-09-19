-- ARCH-010 follow-up: Shopify App Events can confirm a recovery-credit purchase
-- with a positive usage delta and a zero monetary delta (for example a free
-- top-up meter). Keep the provider-confirmed valuation invariant, but make the
-- usage increase the authority rather than requiring a positive charge.
--
-- This migration is deliberately data-independent: it contains no fixture IDs,
-- no test-data lookup, and no data-migration DML. It is safe to apply when the
-- RecoveryCreditPurchase table is empty.

ALTER TABLE "billing"."RecoveryCreditPurchase"
DROP CONSTRAINT IF EXISTS "RecoveryCreditPurchase_confirmed_valuation_complete";

ALTER TABLE "billing"."RecoveryCreditPurchase"
ADD CONSTRAINT "RecoveryCreditPurchase_confirmed_valuation_complete"
CHECK (
    "status" = 'REQUESTED'
    OR (
        "providerUsageQuantityAfterSnapshot" IS NOT NULL
        AND "providerUsageQuantityAfterSnapshot" > "providerUsageQuantityBeforeSnapshot"
        AND "providerUsageCostAfterSnapshot" IS NOT NULL
        AND "providerUsageCostCurrencyAfterSnapshot" IS NOT NULL
        AND "providerPurchaseAmount" IS NOT NULL
        AND "providerPurchaseAmount" >= 0
        AND "providerPurchaseCurrency" IS NOT NULL
        AND "providerValuationConfirmedAt" IS NOT NULL
        AND "providerPriceSnapshot" IS NOT NULL
        AND "providerUsageCostCurrencyBeforeSnapshot" = "providerUsageCostCurrencyAfterSnapshot"
        AND "providerUsageCostCurrencyAfterSnapshot" = "providerPurchaseCurrency"
        AND "providerUsageCostAfterSnapshot" >= "providerUsageCostBeforeSnapshot"
        AND "providerPurchaseAmount" = "providerUsageCostAfterSnapshot" - "providerUsageCostBeforeSnapshot"
    )
);
