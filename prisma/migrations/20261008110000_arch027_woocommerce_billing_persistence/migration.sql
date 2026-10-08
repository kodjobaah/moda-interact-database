-- ARCH-027: minimal provider-neutral billing intent and WooCommerce evidence.

CREATE TYPE "billing"."BillingOperationKind" AS ENUM (
  'SUBSCRIPTION_CREATE',
  'PLAN_SWITCH',
  'ONE_TIME_CHARGE',
  'CANCEL'
);

CREATE TYPE "billing"."BillingOperationState" AS ENUM (
  'INITIATING',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'OUTCOME_UNKNOWN',
  'FAILED'
);

ALTER TABLE "billing"."BillingPeriodEntitlementCounter"
  ADD COLUMN "currentAllowanceQuantity" INTEGER,
  ADD CONSTRAINT "BillingPeriodEntitlementCounter_currentAllowanceQuantity_check"
    CHECK ("currentAllowanceQuantity" IS NULL OR "currentAllowanceQuantity" >= 0);

ALTER TABLE "billing"."Subscription"
  ADD COLUMN "providerCoverageEndAt" TIMESTAMP(3);

CREATE INDEX "Subscription_providerSubscriptionId_idx"
  ON "billing"."Subscription"("providerSubscriptionId");
CREATE INDEX "Subscription_providerCoverageEndAt_idx"
  ON "billing"."Subscription"("providerCoverageEndAt");

ALTER TABLE "billing"."RecoveryCreditPurchase"
  ALTER COLUMN "billingPeriodId" DROP NOT NULL,
  ALTER COLUMN "shopifyPlanHandleSnapshot" DROP NOT NULL,
  ALTER COLUMN "shopifyEventHandleSnapshot" DROP NOT NULL,
  ALTER COLUMN "providerSubscriptionIdSnapshot" DROP NOT NULL,
  ALTER COLUMN "providerUsageQuantityBeforeSnapshot" DROP NOT NULL,
  ALTER COLUMN "providerUsageCostBeforeSnapshot" DROP NOT NULL,
  ALTER COLUMN "providerUsageCostCurrencyBeforeSnapshot" DROP NOT NULL,
  ALTER COLUMN "usageEventId" DROP NOT NULL,
  ADD COLUMN "provider" VARCHAR(32) NOT NULL DEFAULT 'SHOPIFY',
  ADD COLUMN "providerReference" VARCHAR(512),
  ADD COLUMN "refundAttemptedAt" TIMESTAMP(3);

ALTER TABLE "billing"."RecoveryCreditPurchase"
  DROP CONSTRAINT "RecoveryCreditPurchase_confirmed_valuation_complete",
  ADD CONSTRAINT "RecoveryCreditPurchase_provider_check"
    CHECK ("provider" IN ('SHOPIFY', 'WOOCOMMERCE')),
  ADD CONSTRAINT "RecoveryCreditPurchase_provider_reference_check"
    CHECK ("providerReference" IS NULL OR btrim("providerReference") <> ''),
  ADD CONSTRAINT "RecoveryCreditPurchase_provider_evidence_shape_check"
    CHECK (
      (
        "provider" = 'SHOPIFY'
        AND "billingPeriodId" IS NOT NULL
        AND "shopifyPlanHandleSnapshot" IS NOT NULL
        AND btrim("shopifyPlanHandleSnapshot") <> ''
        AND "shopifyEventHandleSnapshot" IS NOT NULL
        AND btrim("shopifyEventHandleSnapshot") <> ''
        AND "providerSubscriptionIdSnapshot" IS NOT NULL
        AND btrim("providerSubscriptionIdSnapshot") <> ''
        AND "providerUsageQuantityBeforeSnapshot" IS NOT NULL
        AND "providerUsageCostBeforeSnapshot" IS NOT NULL
        AND "providerUsageCostCurrencyBeforeSnapshot" IS NOT NULL
        AND "usageEventId" IS NOT NULL
      )
      OR
      (
        "provider" = 'WOOCOMMERCE'
        AND "shopifyPlanHandleSnapshot" IS NULL
        AND "shopifyEventHandleSnapshot" IS NULL
        AND "providerUsageQuantityBeforeSnapshot" IS NULL
        AND "providerUsageCostBeforeSnapshot" IS NULL
        AND "providerUsageCostCurrencyBeforeSnapshot" IS NULL
        AND "providerUsageQuantityAfterSnapshot" IS NULL
        AND "providerUsageCostAfterSnapshot" IS NULL
        AND "providerUsageCostCurrencyAfterSnapshot" IS NULL
        AND "usageEventId" IS NULL
      )
    ),
  ADD CONSTRAINT "RecoveryCreditPurchase_confirmed_valuation_complete"
    CHECK (
      "status" = 'REQUESTED'
      OR (
        "provider" = 'SHOPIFY'
        AND "providerUsageQuantityAfterSnapshot" IS NOT NULL
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
      OR (
        "provider" = 'WOOCOMMERCE'
        AND "providerReference" IS NOT NULL
        AND btrim("providerReference") <> ''
        AND "providerPurchaseAmount" IS NOT NULL
        AND "providerPurchaseAmount" > 0
        AND "providerPurchaseCurrency" IS NOT NULL
        AND ("providerPurchaseCurrency" COLLATE "C") ~ '^[A-Z]{3}$'
        AND "providerValuationConfirmedAt" IS NOT NULL
        AND "providerPriceSnapshot" IS NOT NULL
      )
    );

CREATE FUNCTION billing.arch027_recovery_credit_purchase_refund_attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."refundAttemptedAt" IS NOT NULL
     AND NEW."refundAttemptedAt" IS DISTINCT FROM OLD."refundAttemptedAt" THEN
    RAISE EXCEPTION 'ARCH027 purchase refundAttemptedAt is write-once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER arch027_recovery_credit_purchase_refund_attempt_guard
  BEFORE UPDATE OF "refundAttemptedAt"
  ON "billing"."RecoveryCreditPurchase"
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch027_recovery_credit_purchase_refund_attempt_guard();

ALTER TABLE "billing"."RecoveryCreditRefund"
  ALTER COLUMN "billingPeriodIdSnapshot" DROP NOT NULL,
  ALTER COLUMN "providerSubscriptionIdSnapshot" DROP NOT NULL,
  ALTER COLUMN "planHandleSnapshot" DROP NOT NULL,
  ALTER COLUMN "eventHandleSnapshot" DROP NOT NULL,
  ADD COLUMN "provider" VARCHAR(32) NOT NULL DEFAULT 'SHOPIFY';

ALTER TABLE "billing"."RecoveryCreditRefund"
  ADD CONSTRAINT "RecoveryCreditRefund_provider_check"
    CHECK ("provider" IN ('SHOPIFY', 'WOOCOMMERCE')),
  ADD CONSTRAINT "RecoveryCreditRefund_provider_evidence_shape_check"
    CHECK (
      (
        "provider" = 'SHOPIFY'
        AND "billingPeriodIdSnapshot" IS NOT NULL
        AND btrim("billingPeriodIdSnapshot") <> ''
        AND "providerSubscriptionIdSnapshot" IS NOT NULL
        AND btrim("providerSubscriptionIdSnapshot") <> ''
        AND "planHandleSnapshot" IS NOT NULL
        AND btrim("planHandleSnapshot") <> ''
        AND "eventHandleSnapshot" IS NOT NULL
        AND btrim("eventHandleSnapshot") <> ''
      )
      OR
      (
        "provider" = 'WOOCOMMERCE'
        AND "planHandleSnapshot" IS NULL
        AND "eventHandleSnapshot" IS NULL
        AND "shopifyPartnerDevelopmentSnapshot" = false
        AND "automaticCorrectionUsageEventId" IS NULL
        AND "providerUsageQuantityBeforeCorrection" IS NULL
        AND "providerUsageCostBeforeCorrection" IS NULL
        AND "expectedProviderUsageQuantityAfterCorrection" IS NULL
        AND "expectedProviderUsageCostAfterCorrection" IS NULL
        AND "expectedProviderAmount" IS NULL
        AND "expectedProviderCurrency" IS NULL
      )
    ),
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
            "finalCreditQuantity" > 0
            AND "providerAmount" IS NOT NULL
            AND "providerCurrency" IS NOT NULL
            AND "providerReference" IS NOT NULL
            AND btrim("providerReference") <> ''
            AND "providerActionKind" = 'REFUND'
            AND "providerConfirmedAt" IS NOT NULL
          )
        )
      )
    );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "billing"."RecoveryCreditRefund" AS refund
    JOIN "billing"."RecoveryCreditPurchase" AS purchase
      ON purchase."id" = refund."purchaseId"
    WHERE refund."provider" IS DISTINCT FROM purchase."provider"
  ) THEN
    RAISE EXCEPTION 'ARCH027 existing refund provider does not match its purchase';
  END IF;
END;
$$;

CREATE FUNCTION billing.arch027_recovery_credit_refund_provider_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_provider VARCHAR(32);
BEGIN
  SELECT purchase."provider"
    INTO purchase_provider
    FROM "billing"."RecoveryCreditPurchase" AS purchase
    WHERE purchase."id" = NEW."purchaseId"
    FOR UPDATE;

  IF purchase_provider IS NULL OR NEW."provider" IS DISTINCT FROM purchase_provider THEN
    RAISE EXCEPTION 'ARCH027 refund provider must match its recovery credit purchase'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER arch027_recovery_credit_refund_provider_guard
  BEFORE INSERT OR UPDATE OF "provider", "purchaseId"
  ON "billing"."RecoveryCreditRefund"
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch027_recovery_credit_refund_provider_guard();

CREATE TABLE "billing"."BillingOperation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "kind" "billing"."BillingOperationKind" NOT NULL,
  "state" "billing"."BillingOperationState" NOT NULL DEFAULT 'INITIATING',
  "requestKey" VARCHAR(255) NOT NULL,
  "requestFingerprint" BYTEA NOT NULL,
  "merchantPricingPlanId" TEXT,
  "merchantPricingUsageEventId" TEXT,
  "quotedAmountMinor" INTEGER,
  "quotedCurrency" CHAR(3),
  "quotedBillingPeriod" "billing"."MerchantPricingBillingPeriod",
  "recoveryCreditPurchaseId" TEXT,
  "providerReference" VARCHAR(255),
  "confirmationUrl" VARCHAR(2048),
  "lastErrorCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingOperation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "BillingOperation_merchantPricingPlanId_fkey"
    FOREIGN KEY ("merchantPricingPlanId") REFERENCES "billing"."MerchantPricingPlan"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "BillingOperation_merchantPricingUsageEventId_fkey"
    FOREIGN KEY ("merchantPricingUsageEventId") REFERENCES "billing"."MerchantPricingUsageEvent"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "BillingOperation_recoveryCreditPurchaseId_fkey"
    FOREIGN KEY ("recoveryCreditPurchaseId") REFERENCES "billing"."RecoveryCreditPurchase"("id")
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "BillingOperation_requestKey_check"
    CHECK (btrim("requestKey") <> ''),
  CONSTRAINT "BillingOperation_requestFingerprint_length_check"
    CHECK (octet_length("requestFingerprint") = 32),
  CONSTRAINT "BillingOperation_quotedCurrency_check"
    CHECK ("quotedCurrency" IS NULL OR ("quotedCurrency" COLLATE "C") ~ '^[A-Z]{3}$'),
  CONSTRAINT "BillingOperation_providerReference_check"
    CHECK ("providerReference" IS NULL OR btrim("providerReference") <> ''),
  CONSTRAINT "BillingOperation_kind_shape_check"
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
        AND "providerReference" IS NOT NULL AND btrim("providerReference") <> ''
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
        AND "providerReference" IS NOT NULL AND btrim("providerReference") <> ''
        AND "recoveryCreditPurchaseId" IS NULL
      )
    ),
  CONSTRAINT "BillingOperation_state_provider_reference_check"
    CHECK (
      "state" NOT IN ('AWAITING_CONFIRMATION', 'CONFIRMED')
      OR ("providerReference" IS NOT NULL AND btrim("providerReference") <> '')
    )
);

CREATE UNIQUE INDEX "BillingOperation_shopId_requestKey_key"
  ON "billing"."BillingOperation"("shopId", "requestKey");
CREATE UNIQUE INDEX "BillingOperation_recoveryCreditPurchaseId_key"
  ON "billing"."BillingOperation"("recoveryCreditPurchaseId");
CREATE INDEX "BillingOperation_shopId_state_createdAt_idx"
  ON "billing"."BillingOperation"("shopId", "state", "createdAt");
CREATE INDEX "BillingOperation_providerReference_createdAt_idx"
  ON "billing"."BillingOperation"("providerReference", "createdAt");
CREATE INDEX "BillingOperation_merchantPricingPlanId_idx"
  ON "billing"."BillingOperation"("merchantPricingPlanId");
CREATE INDEX "BillingOperation_merchantPricingUsageEventId_idx"
  ON "billing"."BillingOperation"("merchantPricingUsageEventId");

CREATE FUNCTION billing.arch027_billing_operation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_shop_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."kind" = 'ONE_TIME_CHARGE' AND NEW."recoveryCreditPurchaseId" IS NULL THEN
      RAISE EXCEPTION 'ARCH027 one-time charge must reference its purchase'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."kind" = 'ONE_TIME_CHARGE' THEN
      SELECT purchase."shopId"
        INTO purchase_shop_id
        FROM "billing"."RecoveryCreditPurchase" AS purchase
        WHERE purchase."id" = NEW."recoveryCreditPurchaseId"
        FOR UPDATE;
      IF purchase_shop_id IS DISTINCT FROM NEW."shopId" THEN
        RAISE EXCEPTION 'ARCH027 one-time charge purchase must belong to the same Shop'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW."id", NEW."shopId", NEW."kind", NEW."requestKey", NEW."requestFingerprint",
    NEW."merchantPricingPlanId", NEW."merchantPricingUsageEventId", NEW."quotedAmountMinor",
    NEW."quotedCurrency", NEW."quotedBillingPeriod", NEW."recoveryCreditPurchaseId"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."shopId", OLD."kind", OLD."requestKey", OLD."requestFingerprint",
    OLD."merchantPricingPlanId", OLD."merchantPricingUsageEventId", OLD."quotedAmountMinor",
    OLD."quotedCurrency", OLD."quotedBillingPeriod", OLD."recoveryCreditPurchaseId"
  ) THEN
    IF NOT (
      pg_trigger_depth() > 1
      AND OLD."recoveryCreditPurchaseId" IS NOT NULL
      AND NEW."recoveryCreditPurchaseId" IS NULL
      AND ROW(
        NEW."id", NEW."shopId", NEW."kind", NEW."requestKey", NEW."requestFingerprint",
        NEW."merchantPricingPlanId", NEW."merchantPricingUsageEventId", NEW."quotedAmountMinor",
        NEW."quotedCurrency", NEW."quotedBillingPeriod"
      ) IS NOT DISTINCT FROM ROW(
        OLD."id", OLD."shopId", OLD."kind", OLD."requestKey", OLD."requestFingerprint",
        OLD."merchantPricingPlanId", OLD."merchantPricingUsageEventId", OLD."quotedAmountMinor",
        OLD."quotedCurrency", OLD."quotedBillingPeriod"
      )
    ) THEN
      RAISE EXCEPTION 'ARCH027 billing operation intent is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."providerReference" IS NOT NULL
     AND NEW."providerReference" IS DISTINCT FROM OLD."providerReference" THEN
    RAISE EXCEPTION 'ARCH027 billing operation providerReference is write-once'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER arch027_billing_operation_guard
  BEFORE INSERT OR UPDATE
  ON "billing"."BillingOperation"
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch027_billing_operation_guard();

CREATE FUNCTION billing.arch027_recovery_credit_purchase_reference_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."provider" IS DISTINCT FROM OLD."provider"
     AND EXISTS (
       SELECT 1
       FROM "billing"."RecoveryCreditRefund" AS refund
       WHERE refund."purchaseId" = OLD."id"
         AND refund."provider" IS DISTINCT FROM NEW."provider"
     ) THEN
    RAISE EXCEPTION 'ARCH027 purchase provider change would mismatch existing refunds'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."shopId" IS DISTINCT FROM OLD."shopId"
     AND EXISTS (
       SELECT 1
       FROM "billing"."BillingOperation" AS operation
       WHERE operation."recoveryCreditPurchaseId" = OLD."id"
         AND operation."shopId" IS DISTINCT FROM NEW."shopId"
     ) THEN
    RAISE EXCEPTION 'ARCH027 purchase Shop change would mismatch its billing operation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER arch027_recovery_credit_purchase_reference_guard
  BEFORE UPDATE OF "provider", "shopId"
  ON "billing"."RecoveryCreditPurchase"
  FOR EACH ROW
  EXECUTE FUNCTION billing.arch027_recovery_credit_purchase_reference_guard();

CREATE TABLE "woocommerce"."WooCommerceBillingWebhookReceipt" (
  "id" TEXT NOT NULL,
  "topic" VARCHAR(128) NOT NULL,
  "providerContractId" VARCHAR(255),
  "billingOperationId" TEXT,
  "payloadSha256" BYTEA NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  "processingError" VARCHAR(2000),

  CONSTRAINT "WooCommerceBillingWebhookReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WooCommerceBillingWebhookReceipt_billingOperationId_fkey"
    FOREIGN KEY ("billingOperationId") REFERENCES "billing"."BillingOperation"("id")
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT "WooCommerceBillingWebhookReceipt_topic_check"
    CHECK (btrim("topic") <> ''),
  CONSTRAINT "WooCommerceBillingWebhookReceipt_providerContractId_check"
    CHECK ("providerContractId" IS NULL OR btrim("providerContractId") <> ''),
  CONSTRAINT "WooCommerceBillingWebhookReceipt_payloadSha256_length_check"
    CHECK (octet_length("payloadSha256") = 32),
  CONSTRAINT "WooCommerceBillingWebhookReceipt_processing_state_check"
    CHECK ("processedAt" IS NULL OR "processingError" IS NULL),
  CONSTRAINT "WooCommerceBillingWebhookReceipt_topic_payloadSha256_key"
    UNIQUE ("topic", "payloadSha256")
);

CREATE INDEX "WooCommerceBillingWebhookReceipt_providerContractId_receivedAt_idx"
  ON "woocommerce"."WooCommerceBillingWebhookReceipt"("providerContractId", "receivedAt");
CREATE INDEX "WooCommerceBillingWebhookReceipt_billingOperationId_receivedAt_idx"
  ON "woocommerce"."WooCommerceBillingWebhookReceipt"("billingOperationId", "receivedAt");
CREATE INDEX "WooCommerceBillingWebhookReceipt_processedAt_receivedAt_idx"
  ON "woocommerce"."WooCommerceBillingWebhookReceipt"("processedAt", "receivedAt");

CREATE FUNCTION woocommerce.arch027_woocommerce_billing_webhook_receipt_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."topic", NEW."providerContractId", NEW."payloadSha256",
    NEW."normalizedPayload", NEW."receivedAt"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."topic", OLD."providerContractId", OLD."payloadSha256",
    OLD."normalizedPayload", OLD."receivedAt"
  ) THEN
    RAISE EXCEPTION 'ARCH027 WooCommerce billing webhook evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."billingOperationId" IS NOT NULL
     AND NEW."billingOperationId" IS DISTINCT FROM OLD."billingOperationId" THEN
    IF NOT (
      pg_trigger_depth() > 1
      AND NEW."billingOperationId" IS NULL
      AND ROW(
        NEW."id", NEW."topic", NEW."providerContractId", NEW."payloadSha256",
        NEW."normalizedPayload", NEW."receivedAt"
      ) IS NOT DISTINCT FROM ROW(
        OLD."id", OLD."topic", OLD."providerContractId", OLD."payloadSha256",
        OLD."normalizedPayload", OLD."receivedAt"
      )
    ) THEN
      RAISE EXCEPTION 'ARCH027 WooCommerce billing receipt correlation is write-once'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER arch027_woocommerce_billing_webhook_receipt_guard
  BEFORE UPDATE
  ON "woocommerce"."WooCommerceBillingWebhookReceipt"
  FOR EACH ROW
  EXECUTE FUNCTION woocommerce.arch027_woocommerce_billing_webhook_receipt_guard();