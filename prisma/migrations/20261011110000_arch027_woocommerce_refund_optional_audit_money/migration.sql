-- ARCH-027-DATABASE-002: provider money is optional audit evidence for Woo refunds.
-- Only replace this one check; preserve provider confirmation, quantity, matching
-- monetary-nullness, nonnegative amounts, uppercase currency and all other guards.
-- NULL-sensitive completed-refund fields are explicit: CHECK permits UNKNOWN.
-- PostgreSQL executes this single ALTER TABLE statement atomically.
ALTER TABLE "billing"."RecoveryCreditRefund"
  DROP CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check",
  ADD CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check"
    CHECK (
      "provider" <> 'WOOCOMMERCE'
      OR (
        ("providerAmount" IS NULL) = ("providerCurrency" IS NULL)
        AND ("providerAmount" IS NULL OR "providerAmount" >= 0)
        AND ("providerCurrency" IS NULL OR ("providerCurrency" COLLATE "C") ~ '^[A-Z]{3}$')
        AND (
          "status" <> 'COMPLETED'
          OR (
            "finalCreditQuantity" IS NOT NULL
            AND "finalCreditQuantity" > 0
            AND "providerReference" IS NOT NULL
            AND btrim("providerReference") <> ''
            AND "providerActionKind" IS NOT NULL
            AND "providerActionKind" = 'REFUND'
            AND "providerConfirmedAt" IS NOT NULL
          )
        )
      )
    );
