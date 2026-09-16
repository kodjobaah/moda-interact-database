CREATE TYPE "shopify"."RecoveryOfferMode" AS ENUM ('NONE', 'FIXED', 'AI_BEST_APPLICABLE');

CREATE TYPE "shopify"."ShopifyDiscountCatalogueStatus" AS ENUM ('UNAVAILABLE', 'SYNC_REQUIRED', 'SYNCING', 'CURRENT', 'ERROR');

CREATE TYPE "shopify"."ShopifyDiscountMethod" AS ENUM ('AUTOMATIC', 'CODE');

CREATE TYPE "shopify"."ShopRecoveryPolicyOverrideAuditAction" AS ENUM ('UPSERT', 'CLEAR');

CREATE TYPE "commerce"."RecoveryOutreachTrigger" AS ENUM ('INITIAL', 'NO_RESPONSE_FOLLOW_UP');

CREATE TYPE "commerce"."RecoveryOutreachStatus" AS ENUM (
    'PENDING',
    'WAITING_FOR_RESPONSE',
    'ENGAGED',
    'NO_RESPONSE',
    'CAPACITY_BLOCKED',
    'CANCELLED',
    'FAILED'
);

ALTER TYPE "public"."BackgroundRuntimeLeaseName" ADD VALUE 'CHECKOUT_RECOVERY_EXPIRY';

CREATE TABLE "shopify"."ShopifyDiscountCatalogue" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "shopify"."ShopifyDiscountCatalogueStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "syncGeneration" INTEGER NOT NULL DEFAULT 0,
    "activeSyncToken" TEXT,
    "syncRequestedAt" TIMESTAMP(3),
    "syncStartedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(128),
    "unavailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyDiscountCatalogue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify"."ShopifyDiscount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyDiscountNodeId" TEXT NOT NULL,
    "providerType" VARCHAR(128) NOT NULL,
    "method" "shopify"."ShopifyDiscountMethod" NOT NULL,
    "providerStatus" VARCHAR(64) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "codeCount" INTEGER,
    "singleRedeemCode" TEXT,
    "fixedSelectable" BOOLEAN NOT NULL DEFAULT false,
    "providerSnapshot" JSONB NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenSyncGeneration" INTEGER NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "unavailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyDiscount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify"."ShopRecoveryPolicyOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "recoveryDelayMinutes" INTEGER NOT NULL,
    "recoveryOfferMode" "shopify"."RecoveryOfferMode" NOT NULL,
    "fixedShopifyDiscountId" TEXT,
    "followUpEnabled" BOOLEAN NOT NULL,
    "followUpDelayMinutes" INTEGER,
    "reason" VARCHAR(1000) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "updatedByPlatformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopRecoveryPolicyOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shopify"."ShopRecoveryPolicyOverrideAuditEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "action" "shopify"."ShopRecoveryPolicyOverrideAuditAction" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopRecoveryPolicyOverrideAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."RecoveryOutreachAttempt" (
    "id" TEXT NOT NULL,
    "checkoutRecoveryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "trigger" "commerce"."RecoveryOutreachTrigger" NOT NULL,
    "status" "commerce"."RecoveryOutreachStatus" NOT NULL DEFAULT 'PENDING',
    "configuredOfferMode" "shopify"."RecoveryOfferMode" NOT NULL,
    "fixedShopifyDiscountId" TEXT,
    "offerSnapshot" JSONB,
    "outboundMessageId" TEXT,
    "followUpDueAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "customerRespondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "failureCode" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryOutreachAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopifyDiscountCatalogue_shopId_key" ON "shopify"."ShopifyDiscountCatalogue"("shopId");
CREATE UNIQUE INDEX "ShopifyDiscount_shopId_shopifyDiscountNodeId_key" ON "shopify"."ShopifyDiscount"("shopId", "shopifyDiscountNodeId");
CREATE UNIQUE INDEX "ShopRecoveryPolicyOverride_shopId_key" ON "shopify"."ShopRecoveryPolicyOverride"("shopId");
CREATE UNIQUE INDEX "RecoveryOutreachAttempt_outboundMessageId_key" ON "commerce"."RecoveryOutreachAttempt"("outboundMessageId");
CREATE UNIQUE INDEX "RecoveryOutreachAttempt_checkoutRecoveryId_sequence_key" ON "commerce"."RecoveryOutreachAttempt"("checkoutRecoveryId", "sequence");

CREATE INDEX "ShopifyDiscount_shopId_isAvailable_providerStatus_idx" ON "shopify"."ShopifyDiscount"("shopId", "isAvailable", "providerStatus");
CREATE INDEX "ShopifyDiscount_shopId_fixedSelectable_isAvailable_idx" ON "shopify"."ShopifyDiscount"("shopId", "fixedSelectable", "isAvailable");
CREATE INDEX "ShopifyDiscount_shopId_startsAt_endsAt_idx" ON "shopify"."ShopifyDiscount"("shopId", "startsAt", "endsAt");
CREATE INDEX "ShopRecoveryPolicyOverrideAuditEvent_shopId_occurredAt_idx" ON "shopify"."ShopRecoveryPolicyOverrideAuditEvent"("shopId", "occurredAt");
CREATE INDEX "ShopRecoveryPolicyOverrideAuditEvent_platformAdminId_occurredAt_idx" ON "shopify"."ShopRecoveryPolicyOverrideAuditEvent"("platformAdminId", "occurredAt");
CREATE INDEX "RecoveryOutreachAttempt_checkoutRecoveryId_status_sequence_idx" ON "commerce"."RecoveryOutreachAttempt"("checkoutRecoveryId", "status", "sequence");
CREATE INDEX "RecoveryOutreachAttempt_status_followUpDueAt_idx" ON "commerce"."RecoveryOutreachAttempt"("status", "followUpDueAt");

ALTER TABLE "shopify"."ShopifyDiscountCatalogue"
    ADD CONSTRAINT "ShopifyDiscountCatalogue_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shopify"."ShopifyDiscount"
    ADD CONSTRAINT "ShopifyDiscount_shop_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ShopifyDiscount_catalogue_fkey"
    FOREIGN KEY ("shopId") REFERENCES "shopify"."ShopifyDiscountCatalogue"("shopId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shopify"."ShopRecoveryPolicyOverride"
    ADD CONSTRAINT "ShopRecoveryPolicyOverride_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ShopRecoveryPolicyOverride_fixedShopifyDiscountId_fkey"
    FOREIGN KEY ("fixedShopifyDiscountId") REFERENCES "shopify"."ShopifyDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "ShopRecoveryPolicyOverride_updatedByPlatformAdminId_fkey"
    FOREIGN KEY ("updatedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shopify"."ShopRecoveryPolicyOverrideAuditEvent"
    ADD CONSTRAINT "ShopRecoveryPolicyOverrideAuditEvent_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ShopRecoveryPolicyOverrideAuditEvent_platformAdminId_fkey"
    FOREIGN KEY ("platformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce"."RecoveryOutreachAttempt"
    ADD CONSTRAINT "RecoveryOutreachAttempt_checkoutRecoveryId_fkey"
    FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "RecoveryOutreachAttempt_fixedShopifyDiscountId_fkey"
    FOREIGN KEY ("fixedShopifyDiscountId") REFERENCES "shopify"."ShopifyDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "RecoveryOutreachAttempt_outboundMessageId_fkey"
    FOREIGN KEY ("outboundMessageId") REFERENCES "whatsapp"."ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shopify"."ShopSettings"
    ADD COLUMN "recoveryOfferMode" "shopify"."RecoveryOfferMode" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "fixedShopifyDiscountId" TEXT,
    ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "followUpDelayMinutes" INTEGER,
    ADD CONSTRAINT "ShopSettings_fixedShopifyDiscountId_fkey"
        FOREIGN KEY ("fixedShopifyDiscountId") REFERENCES "shopify"."ShopifyDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commerce"."CheckoutRecovery"
    DROP CONSTRAINT "CheckoutRecovery_shopId_checkoutToken_key",
    ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "lastExternalActivityAt" TIMESTAMP(3);

UPDATE "commerce"."CheckoutRecovery"
SET "lastExternalActivityAt" = GREATEST("detectedAt", COALESCE("engagedAt", "detectedAt"))
WHERE "lastExternalActivityAt" IS NULL;

ALTER TABLE "commerce"."CheckoutRecovery"
    ALTER COLUMN "lastExternalActivityAt" SET NOT NULL;

CREATE UNIQUE INDEX "CheckoutRecovery_shopId_checkoutToken_generation_key"
    ON "commerce"."CheckoutRecovery"("shopId", "checkoutToken", "generation");
CREATE INDEX "CheckoutRecovery_shopId_checkoutToken_generation_idx"
    ON "commerce"."CheckoutRecovery"("shopId", "checkoutToken", "generation");
CREATE INDEX "CheckoutRecovery_status_lastExternalActivityAt_idx"
    ON "commerce"."CheckoutRecovery"("status", "lastExternalActivityAt");
CREATE UNIQUE INDEX "CheckoutRecovery_active_generation_key"
    ON "commerce"."CheckoutRecovery"("shopId", "checkoutToken")
    WHERE "status" IN ('DETECTED', 'MESSAGE_SENT', 'ENGAGED');

ALTER TABLE "public"."BackgroundRuntimeConfig"
    ADD COLUMN "checkoutRecoveryLifetimeDays" INTEGER NOT NULL DEFAULT 21;

ALTER TABLE "shopify"."ShopSettings"
    ADD CONSTRAINT "ck_arch016_shop_settings_recovery_delay"
        CHECK ("recoveryDelayMinutes" BETWEEN 0 AND 10080),
    ADD CONSTRAINT "ck_arch016_shop_settings_follow_up"
        CHECK ((NOT "followUpEnabled" AND "followUpDelayMinutes" IS NULL)
            OR ("followUpEnabled" AND "followUpDelayMinutes" BETWEEN 1 AND 10080)),
    ADD CONSTRAINT "ck_arch016_shop_settings_fixed_offer"
        CHECK (("recoveryOfferMode" = 'FIXED' AND "fixedShopifyDiscountId" IS NOT NULL)
            OR ("recoveryOfferMode" <> 'FIXED' AND "fixedShopifyDiscountId" IS NULL));

ALTER TABLE "shopify"."ShopRecoveryPolicyOverride"
    ADD CONSTRAINT "ck_arch016_policy_override_recovery_delay"
        CHECK ("recoveryDelayMinutes" BETWEEN 0 AND 10080),
    ADD CONSTRAINT "ck_arch016_policy_override_follow_up"
        CHECK ((NOT "followUpEnabled" AND "followUpDelayMinutes" IS NULL)
            OR ("followUpEnabled" AND "followUpDelayMinutes" BETWEEN 1 AND 10080)),
    ADD CONSTRAINT "ck_arch016_policy_override_fixed_offer"
        CHECK (("recoveryOfferMode" = 'FIXED' AND "fixedShopifyDiscountId" IS NOT NULL)
            OR ("recoveryOfferMode" <> 'FIXED' AND "fixedShopifyDiscountId" IS NULL));

ALTER TABLE "shopify"."ShopifyDiscountCatalogue"
    ADD CONSTRAINT "ck_arch016_discount_catalogue_generation"
        CHECK ("syncGeneration" >= 0),
    ADD CONSTRAINT "ck_arch016_discount_catalogue_syncing"
        CHECK (("status" = 'SYNCING' AND "activeSyncToken" IS NOT NULL AND "syncStartedAt" IS NOT NULL)
            OR ("status" <> 'SYNCING' AND "activeSyncToken" IS NULL));

ALTER TABLE "shopify"."ShopifyDiscount"
    ADD CONSTRAINT "ck_arch016_discount_code_count"
        CHECK ("codeCount" IS NULL OR "codeCount" >= 0),
    ADD CONSTRAINT "ck_arch016_discount_generation"
        CHECK ("lastSeenSyncGeneration" >= 0),
    ADD CONSTRAINT "ck_arch016_discount_automatic_code"
        CHECK ("method" <> 'AUTOMATIC' OR "singleRedeemCode" IS NULL),
    ADD CONSTRAINT "ck_arch016_discount_single_code"
        CHECK ("singleRedeemCode" IS NULL OR "codeCount" = 1),
    ADD CONSTRAINT "ck_arch016_discount_fixed_selectable"
        CHECK (NOT "fixedSelectable" OR "method" <> 'CODE' OR ("codeCount" = 1 AND "singleRedeemCode" IS NOT NULL));

ALTER TABLE "commerce"."RecoveryOutreachAttempt"
    ADD CONSTRAINT "ck_arch016_outreach_sequence"
        CHECK ("sequence" >= 1),
    ADD CONSTRAINT "ck_arch016_outreach_trigger_sequence"
        CHECK (("trigger" = 'INITIAL' AND "sequence" = 1)
            OR ("trigger" = 'NO_RESPONSE_FOLLOW_UP' AND "sequence" >= 2)),
    ADD CONSTRAINT "ck_arch016_outreach_fixed_offer"
        CHECK (("configuredOfferMode" = 'FIXED' AND "fixedShopifyDiscountId" IS NOT NULL)
            OR ("configuredOfferMode" <> 'FIXED' AND "fixedShopifyDiscountId" IS NULL)),
    ADD CONSTRAINT "ck_arch016_outreach_waiting_message"
        CHECK ("status" <> 'WAITING_FOR_RESPONSE' OR ("sentAt" IS NOT NULL AND "outboundMessageId" IS NOT NULL)),
    ADD CONSTRAINT "ck_arch016_outreach_response_sent"
        CHECK ("customerRespondedAt" IS NULL OR "sentAt" IS NOT NULL);

ALTER TABLE "commerce"."CheckoutRecovery"
    ADD CONSTRAINT "ck_arch016_recovery_generation"
        CHECK ("generation" >= 1);

ALTER TABLE "public"."BackgroundRuntimeConfig"
    ADD CONSTRAINT "ck_arch016_checkout_recovery_lifetime"
        CHECK ("checkoutRecoveryLifetimeDays" BETWEEN 1 AND 90);
