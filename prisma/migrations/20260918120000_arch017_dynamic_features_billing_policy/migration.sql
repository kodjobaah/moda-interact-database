CREATE TYPE "billing"."FeatureActivationMode" AS ENUM ('ALWAYS_ENABLED', 'MERCHANT_OPT_IN');

CREATE TABLE "billing"."Feature" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activationMode" "billing"."FeatureActivationMode" NOT NULL,
    "systemRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Feature_key_key" ON "billing"."Feature"("key");
CREATE INDEX "Feature_active_displayName_idx" ON "billing"."Feature"("active", "displayName");

INSERT INTO "billing"."Feature" ("id", "key", "displayName", "activationMode", "systemRequired", "active", "updatedAt") VALUES
  ('arch017-feature-checkout-recovery', 'checkout_recovery', 'Checkout Recovery', 'ALWAYS_ENABLED', true, true, CURRENT_TIMESTAMP),
  ('arch017-feature-ai-conversations', 'ai_conversations', 'AI Conversations', 'MERCHANT_OPT_IN', false, true, CURRENT_TIMESTAMP),
  ('arch017-feature-product-search', 'product_search', 'Product Search', 'MERCHANT_OPT_IN', false, true, CURRENT_TIMESTAMP),
  ('arch017-feature-order-support', 'order_support', 'Order Support', 'MERCHANT_OPT_IN', false, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "billing"."MerchantPricingPlan"
  ADD COLUMN "shopifyRecoveryUsageEventHandle" VARCHAR(255),
  ADD COLUMN "materializedAt" TIMESTAMP(3);

ALTER TABLE "billing"."BillingPlanFeature" ADD COLUMN "featureId" TEXT;

UPDATE "billing"."BillingPlanFeature" bpf
SET "featureId" = f."id"
FROM "billing"."Feature" f
WHERE f."key" = CASE bpf."feature"::TEXT
  WHEN 'CHECKOUT_RECOVERY' THEN 'checkout_recovery'
  WHEN 'AI_CONVERSATIONS' THEN 'ai_conversations'
  WHEN 'PRODUCT_SEARCH' THEN 'product_search'
  WHEN 'ORDER_SUPPORT' THEN 'order_support'
END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "billing"."BillingPlanFeature" WHERE "featureId" IS NULL) THEN
    RAISE EXCEPTION 'ARCH-017 BillingPlanFeature feature mapping produced NULL featureId';
  END IF;
END $$;

ALTER TABLE "billing"."BillingPlanFeature" ALTER COLUMN "featureId" SET NOT NULL;
ALTER TABLE "billing"."BillingPlanFeature"
  ADD CONSTRAINT "BillingPlanFeature_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "billing"."Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "billing"."BillingPlanFeature_planId_feature_key";
CREATE UNIQUE INDEX "BillingPlanFeature_planId_featureId_key" ON "billing"."BillingPlanFeature"("planId", "featureId");
CREATE INDEX "BillingPlanFeature_featureId_idx" ON "billing"."BillingPlanFeature"("featureId");
ALTER TABLE "billing"."BillingPlanFeature" DROP COLUMN "feature";
DROP TYPE "billing"."BillingPlanFeatureIdentifier";

CREATE TABLE "billing"."MerchantPricingPlanFeature" (
    "merchantPricingPlanId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MerchantPricingPlanFeature_pkey" PRIMARY KEY ("merchantPricingPlanId", "featureId")
);
CREATE INDEX "MerchantPricingPlanFeature_featureId_idx" ON "billing"."MerchantPricingPlanFeature"("featureId");
ALTER TABLE "billing"."MerchantPricingPlanFeature"
  ADD CONSTRAINT "MerchantPricingPlanFeature_merchantPricingPlanId_fkey"
  FOREIGN KEY ("merchantPricingPlanId") REFERENCES "billing"."MerchantPricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MerchantPricingPlanFeature_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "billing"."Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "billing"."MerchantPricingPlanFeature" ("merchantPricingPlanId", "featureId")
SELECT p."id", f."id"
FROM "billing"."MerchantPricingPlan" p
CROSS JOIN "billing"."Feature" f
WHERE f."key" = 'checkout_recovery'
ON CONFLICT ("merchantPricingPlanId", "featureId") DO NOTHING;

CREATE TABLE "billing"."ShopFeaturePreference" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopFeaturePreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopFeaturePreference_shopId_featureId_key" ON "billing"."ShopFeaturePreference"("shopId", "featureId");
CREATE INDEX "ShopFeaturePreference_featureId_enabled_idx" ON "billing"."ShopFeaturePreference"("featureId", "enabled");
ALTER TABLE "billing"."ShopFeaturePreference"
  ADD CONSTRAINT "ShopFeaturePreference_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ShopFeaturePreference_featureId_fkey"
  FOREIGN KEY ("featureId") REFERENCES "billing"."Feature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing"."PlatformBillingPolicy"
  ADD COLUMN "defaultOutboundSoftLimit" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "defaultOutboundHardLimit" INTEGER NOT NULL DEFAULT 2000,
  ADD COLUMN "terminalMessageReservedSlots" INTEGER NOT NULL DEFAULT 1;
UPDATE "billing"."PlatformBillingPolicy" SET
  "defaultOutboundSoftLimit" = COALESCE("defaultOutboundSoftLimit", 1000),
  "defaultOutboundHardLimit" = COALESCE("defaultOutboundHardLimit", 2000),
  "terminalMessageReservedSlots" = COALESCE("terminalMessageReservedSlots", 1);
ALTER TABLE "billing"."PlatformBillingPolicy"
  ADD CONSTRAINT "PlatformBillingPolicy_default_soft_positive" CHECK ("defaultOutboundSoftLimit" >= 1),
  ADD CONSTRAINT "PlatformBillingPolicy_default_hard_minimum" CHECK ("defaultOutboundHardLimit" >= 2),
  ADD CONSTRAINT "PlatformBillingPolicy_default_soft_le_hard" CHECK ("defaultOutboundSoftLimit" <= "defaultOutboundHardLimit"),
  ADD CONSTRAINT "PlatformBillingPolicy_default_hard_le_absolute" CHECK ("defaultOutboundHardLimit" <= "absoluteOutboundHardLimit"),
  ADD CONSTRAINT "PlatformBillingPolicy_terminal_reserved_valid" CHECK ("terminalMessageReservedSlots" >= 1 AND "terminalMessageReservedSlots" < "defaultOutboundHardLimit");

ALTER TABLE "billing"."ShopBillingPolicyOverride" ADD COLUMN "terminalMessageReservedSlots" INTEGER;
ALTER TABLE "billing"."ShopBillingPolicyOverride"
  ADD CONSTRAINT "ShopBillingPolicyOverride_terminal_reserved_valid" CHECK ("terminalMessageReservedSlots" IS NULL OR "terminalMessageReservedSlots" >= 1);

ALTER TABLE "billing"."BillingPlan"
  DROP COLUMN "defaultOutboundSoftLimit",
  DROP COLUMN "defaultOutboundHardLimit",
  DROP COLUMN "terminalMessageReservedSlots";

ALTER TABLE "billing"."MerchantPricingPlan"
  ADD CONSTRAINT "MerchantPricingPlan_free_recovery_usage_handle_null"
  CHECK ("planKind" <> 'FREE' OR "shopifyRecoveryUsageEventHandle" IS NULL);
