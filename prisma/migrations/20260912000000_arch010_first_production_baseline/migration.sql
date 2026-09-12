-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "shopify";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "support";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "whatsapp";

-- CreateEnum
CREATE TYPE "commerce"."CheckoutRecoveryStatus" AS ENUM ('DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "commerce"."RecoveryAdmissionBlockReason" AS ENUM ('RECOVERY_CAPACITY_EXHAUSTED');

-- CreateEnum
CREATE TYPE "whatsapp"."ConversationType" AS ENUM ('RECOVERY', 'PRODUCT_DISCOVERY', 'PRODUCT_SUPPORT', 'POST_PURCHASE');

-- CreateEnum
CREATE TYPE "whatsapp"."LanguageSource" AS ENUM ('CUSTOMER_EXPLICIT', 'DETECTED', 'SHOPIFY', 'MERCHANT_DEFAULT', 'PLATFORM_DEFAULT');

-- CreateEnum
CREATE TYPE "whatsapp"."ConversationOutcome" AS ENUM ('IN_PROGRESS', 'RECOVERED', 'NO_RESPONSE', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageSenderType" AS ENUM ('CUSTOMER', 'AGENT', 'AUTOMATION', 'HUMAN');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "billing"."BillingPlanKind" AS ENUM ('FREE', 'PAID_METERED');

-- CreateEnum
CREATE TYPE "billing"."BillingPlanFeatureIdentifier" AS ENUM ('CHECKOUT_RECOVERY', 'AI_CONVERSATIONS', 'PRODUCT_SEARCH', 'ORDER_SUPPORT');

-- CreateEnum
CREATE TYPE "billing"."SubscriptionProjectionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'NO_CONTRACT', 'UNMAPPED', 'SYNC_ERROR', 'FROZEN');

-- CreateEnum
CREATE TYPE "billing"."ProviderSubscriptionLifecycleState" AS ENUM ('CREATED', 'UPDATED', 'CANCELLATION_SCHEDULED', 'CANCELED', 'FROZEN', 'UNFROZEN');

-- CreateEnum
CREATE TYPE "billing"."BillingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "billing"."BillingPeriodCloseReason" AS ENUM ('RENEWED_SAME_PLAN', 'PLAN_CHANGED', 'CONTRACT_ENDED');

-- CreateEnum
CREATE TYPE "billing"."EntitlementCounter" AS ENUM ('LIFETIME_FREE_RECOVERY_CREDITS', 'PURCHASED_RECOVERY_CREDITS');

-- CreateEnum
CREATE TYPE "billing"."BillingPeriodEntitlementCounterKind" AS ENUM ('INCLUDED_RECOVERY_CREDITS');

-- CreateEnum
CREATE TYPE "billing"."UsageReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "billing"."UsageReservationReleaseReason" AS ENUM ('PERIOD_CLOSED');

-- CreateEnum
CREATE TYPE "billing"."UsageMetric" AS ENUM ('RECOVERY_CONVERSATION', 'OUTBOUND_AUTOMATED_MESSAGE', 'DELIVERED_WHATSAPP_MESSAGE', 'RECOVERY_CREDIT_PACK_PURCHASE');

-- CreateEnum
CREATE TYPE "billing"."RecoveryCreditPurchaseStatus" AS ENUM ('PENDING_BILLING', 'ACTIVE', 'NEEDS_ATTENTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "billing"."BillingLifecycleRequestSource" AS ENUM ('MERCHANT_UI', 'MERCHANT_SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "billing"."RecoveryCreditProviderActionKind" AS ENUM ('REFUND', 'CREDIT');

-- CreateEnum
CREATE TYPE "billing"."RecoveryCreditRefundStatus" AS ENUM ('REQUESTED', 'PROVIDER_ACTION_REQUIRED', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "billing"."ShopifyReportState" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'IN_FLIGHT', 'RETRYABLE', 'REPORTED', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "billing"."BillingAuditAction" AS ENUM ('PLAN_CATALOG_CHANGED', 'PLATFORM_POLICY_CHANGED', 'SHOP_OVERRIDE_CHANGED', 'SHOP_OVERRIDE_EXPIRED', 'AUTOMATION_PAUSED', 'AUTOMATION_RESUMED', 'BILLING_EVENT_RETRY', 'BILLING_CORRECTION_CREATED', 'RECOVERY_CREDIT_REFUND', 'UPGRADE_ECONOMICS_EVALUATED');

-- CreateEnum
CREATE TYPE "billing"."PromotionTargetScope" AS ENUM ('GLOBAL', 'PLAN', 'SHOP');

-- CreateEnum
CREATE TYPE "billing"."PromotionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "billing"."PromotionCampaignEventType" AS ENUM ('CREATED', 'ACTIVATED', 'CLOSED', 'REOPENED', 'EXPIRY_CHANGED');

-- CreateEnum
CREATE TYPE "commerce"."ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppTemplateStatus" AS ENUM ('APPROVED', 'IN_APPEAL', 'PENDING', 'REJECTED', 'PENDING_DELETION', 'DELETED', 'DISABLED', 'PAUSED', 'LIMIT_EXCEEDED');

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "support"."MerchantSupportMessageKind" AS ENUM ('ADMINISTRATIVE', 'SYSTEM', 'MERCHANT');

-- CreateEnum
CREATE TYPE "support"."MerchantSupportMessageState" AS ENUM ('PROCESSING', 'AVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationDirection" AS ENUM ('MERCHANT_TO_ADMIN', 'ADMIN_TO_MERCHANT', 'SYSTEM_TO_MERCHANT');

-- CreateEnum
CREATE TYPE "support"."MerchantMessageTranslationStatus" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationBatchStatus" AS ENUM ('READY', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'PROVIDER_COMPLETED', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationReconciliationScope" AS ENUM ('TRANSLATION', 'FAILED_TRANSLATIONS');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationReconciliationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "shopify"."Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify"."ShopSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT,
    "recoveryDelayMinutes" INTEGER NOT NULL DEFAULT 30,
    "defaultLanguageTag" TEXT,
    "defaultTimeZone" TEXT,
    "defaultCountryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify"."ShopBrand" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "logoAltText" TEXT,
    "logoWidth" INTEGER,
    "logoHeight" INTEGER,
    "squareLogoUrl" TEXT,
    "squareLogoAltText" TEXT,
    "coverImageUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."Customer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "shopifyCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CustomerPhone" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CheckoutRecoveryStatusHistory" (
    "id" TEXT NOT NULL,
    "checkoutRecoveryId" TEXT NOT NULL,
    "fromStatus" "commerce"."CheckoutRecoveryStatus",
    "toStatus" "commerce"."CheckoutRecoveryStatus" NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutRecoveryStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CheckoutRecovery" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "cartToken" TEXT,
    "customerId" TEXT,
    "status" "commerce"."CheckoutRecoveryStatus" NOT NULL DEFAULT 'DETECTED',
    "currency" TEXT,
    "totalPrice" DECIMAL(65,30),
    "checkoutUrl" TEXT,
    "lineItems" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageSentAt" TIMESTAMP(3),
    "engagedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "admissionBlockedAt" TIMESTAMP(3),
    "admissionBlockReason" "commerce"."RecoveryAdmissionBlockReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."Conversation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "customerId" TEXT,
    "checkoutRecoveryId" TEXT,
    "standaloneScopeKey" VARCHAR(255),
    "type" "whatsapp"."ConversationType" NOT NULL,
    "outcome" "whatsapp"."ConversationOutcome" NOT NULL DEFAULT 'IN_PROGRESS',
    "languageTag" TEXT,
    "languageSource" "whatsapp"."LanguageSource",
    "countryCode" TEXT,
    "currencyCode" TEXT,
    "timeZone" TEXT,
    "inboundVersion" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedVersion" INTEGER NOT NULL DEFAULT 0,
    "pendingTurnStartedAt" TIMESTAMP(3),
    "processingInboundVersion" INTEGER,
    "processingStartedAt" TIMESTAMP(3),
    "summary" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "inReplyToProviderId" TEXT,
    "direction" "whatsapp"."MessageDirection" NOT NULL,
    "senderType" "whatsapp"."MessageSenderType" NOT NULL,
    "status" "whatsapp"."MessageStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingPlan" (
    "id" TEXT NOT NULL,
    "shopifyPlanHandle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "billing"."BillingPlanKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shopifyUsageEventHandle" TEXT,
    "includedRecoveryConversationAllowance" INTEGER,
    "recoveryCreditPackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCreditsPerPack" INTEGER,
    "shopifyRecoveryCreditPackEventHandle" TEXT,
    "defaultOutboundSoftLimit" INTEGER NOT NULL,
    "defaultOutboundHardLimit" INTEGER NOT NULL,
    "terminalMessageReservedSlots" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingUpgradeEconomicsEdge" (
    "id" TEXT NOT NULL,
    "lowerPlanId" TEXT NOT NULL,
    "higherPlanId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingUpgradeEconomicsEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingEconomicsSnapshot" (
    "id" TEXT NOT NULL,
    "billingPlanId" TEXT NOT NULL,
    "shopifyPlanHandleSnapshot" TEXT NOT NULL,
    "monthlyRecurringAmountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "recoveryCreditPackEnabledSnapshot" BOOLEAN NOT NULL,
    "recoveryCreditsPerPackSnapshot" INTEGER,
    "shopifyRecoveryCreditPackEventHandleSnapshot" TEXT,
    "usagePricingSnapshot" JSONB,
    "providerEvidence" JSONB,
    "verifiedByPlatformAdminId" TEXT NOT NULL,
    "verificationReason" VARCHAR(1000) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEconomicsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingPlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "feature" "billing"."BillingPlanFeatureIdentifier" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BillingPlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."Subscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planId" TEXT,
    "observedShopifyPlanHandle" TEXT,
    "status" "billing"."SubscriptionProjectionStatus" NOT NULL,
    "billingPeriodId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "providerSubscriptionId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncErrorCode" TEXT,
    "lastSyncErrorAt" TIMESTAMP(3),
    "pendingShopifyPlanHandle" TEXT,
    "pendingPlanId" TEXT,
    "pendingEffectiveAt" TIMESTAMP(3),
    "nextReconcileAt" TIMESTAMP(3),
    "lastProviderLifecycleState" "billing"."ProviderSubscriptionLifecycleState",
    "lastProviderLifecycleEventId" TEXT,
    "lastProviderLifecycleEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."UsageEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billingPeriodId" TEXT,
    "metric" "billing"."UsageMetric" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correctionOfUsageEventId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopifyReportState" "billing"."ShopifyReportState" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "shopifyEventHandle" TEXT,
    "shopifyIdempotencyKey" TEXT,
    "reportAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextReportAt" TIMESTAMP(3),
    "lastReportAttemptAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "providerErrorCode" VARCHAR(128),
    "providerResponseSummary" VARCHAR(2000),
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."ShopEntitlementCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "counter" "billing"."EntitlementCounter" NOT NULL,
    "grantedQuantity" INTEGER NOT NULL DEFAULT 0,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "refundingQuantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopEntitlementCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingPeriodEntitlementCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billingPeriodId" TEXT NOT NULL,
    "counter" "billing"."BillingPeriodEntitlementCounterKind" NOT NULL,
    "grantedQuantity" INTEGER NOT NULL DEFAULT 0,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "forfeitedQuantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPeriodEntitlementCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."RecoveryCreditPurchase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planId" TEXT,
    "shopifyPlanHandleSnapshot" TEXT NOT NULL,
    "shopifyEventHandleSnapshot" TEXT NOT NULL,
    "creditsGranted" INTEGER NOT NULL,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "refundingQuantity" INTEGER NOT NULL DEFAULT 0,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" "billing"."RecoveryCreditPurchaseStatus" NOT NULL DEFAULT 'PENDING_BILLING',
    "usageEventId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."UsageReservation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "counterId" TEXT,
    "billingPeriodEntitlementCounterId" TEXT,
    "purchasedCreditPurchaseId" TEXT,
    "promotionalCreditGrantId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "billing"."UsageReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "releaseReason" "billing"."UsageReservationReleaseReason",
    "expiresAt" TIMESTAMP(3),
    "committedUsageEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PlatformBillingPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "globalPauseNewRecoveries" BOOLEAN NOT NULL DEFAULT false,
    "globalPauseAutomatedWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "lifetimeFreeRecoveryAllowance" INTEGER NOT NULL DEFAULT 5,
    "minimumUpgradePremiumBps" INTEGER NOT NULL DEFAULT 2000,
    "absoluteOutboundHardLimit" INTEGER NOT NULL,
    "defaultWarningPercent" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBillingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."ShopBillingPolicyOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "outboundSoftLimit" INTEGER,
    "outboundHardLimit" INTEGER,
    "pauseNewRecoveries" BOOLEAN,
    "pauseAutomatedWhatsapp" BOOLEAN,
    "recoverySafetyCeiling" INTEGER,
    "reason" VARCHAR(1000) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "updatedByPlatformAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBillingPolicyOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PromotionCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantDescription" TEXT,
    "scope" "billing"."PromotionTargetScope" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "targetPlanId" TEXT,
    "targetShopId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "billing"."PromotionCampaignStatus" NOT NULL,
    "createdByPlatformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PromotionCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PromotionCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" "billing"."PromotionCampaignEventType" NOT NULL,
    "oldExpiresAt" TIMESTAMP(3),
    "newExpiresAt" TIMESTAMP(3),
    "platformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionCampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."PromotionalCreditGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "firstSelectedAt" TIMESTAMP(3),
    "lastSelectedAt" TIMESTAMP(3),
    "selectionCount" INTEGER NOT NULL DEFAULT 0,
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "exhaustedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionalCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."MerchantPromotionSelection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "promotionalCreditGrantId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MerchantPromotionSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingAuditEvent" (
    "id" TEXT NOT NULL,
    "action" "billing"."BillingAuditAction" NOT NULL,
    "shopId" TEXT,
    "platformAdminId" TEXT NOT NULL,
    "reason" VARCHAR(1000),
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "relatedEntityType" VARCHAR(128),
    "relatedEntityId" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."BillingPeriod" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planId" TEXT,
    "shopifyPlanHandleSnapshot" TEXT,
    "planNameSnapshot" TEXT,
    "planKindSnapshot" "billing"."BillingPlanKind",
    "includedRecoveryCreditsGranted" INTEGER,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "billing"."BillingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closeReason" "billing"."BillingPeriodCloseReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "status" "commerce"."ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "reinstallPendingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WhatsAppTemplateVariant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "languageTag" TEXT NOT NULL,
    "providerLanguageCode" TEXT NOT NULL,
    "providerTemplateName" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "status" "whatsapp"."WhatsAppTemplateStatus" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplateVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tour" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image" TEXT,
    "stops" JSONB NOT NULL,

    CONSTRAINT "Tour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagSearchResults" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "answer" JSONB NOT NULL,
    "prompt" JSONB NOT NULL,
    "astraDoc" TEXT NOT NULL DEFAULT 'documentskodjobaah',

    CONSTRAINT "RagSearchResults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "providerSubject" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "PlatformAdminRole" NOT NULL DEFAULT 'ADMIN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantSupportThread" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMerchantMessageAt" TIMESTAMP(3),
    "lastAdministrativeMessageAt" TIMESTAMP(3),
    "needsAdminResponse" BOOLEAN NOT NULL DEFAULT false,
    "merchantMessageVersion" INTEGER NOT NULL DEFAULT 0,
    "assignedPlatformAdminId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantSupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "kind" "support"."MerchantSupportMessageKind" NOT NULL,
    "state" "support"."MerchantSupportMessageState" NOT NULL,
    "originalBody" TEXT NOT NULL,
    "sourceLanguageTag" TEXT NOT NULL,
    "displayLanguageTag" TEXT,
    "platformAdminId" TEXT,
    "shopifyUserId" TEXT,
    "systemCode" TEXT,
    "systemVersion" TEXT,
    "sourceKey" TEXT,
    "availableAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "respondsThroughMerchantVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."RecoveryCreditRefund" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "source" "billing"."BillingLifecycleRequestSource" NOT NULL,
    "sourceMessageId" TEXT,
    "requestedByShopifyUserId" TEXT,
    "originalUsageEventIdSnapshot" TEXT NOT NULL,
    "billingPeriodIdSnapshot" TEXT,
    "planHandleSnapshot" TEXT NOT NULL,
    "eventHandleSnapshot" TEXT NOT NULL,
    "creditsSnapshot" INTEGER NOT NULL,
    "purchaseCreditsGrantedSnapshot" INTEGER NOT NULL,
    "creditsRequested" INTEGER NOT NULL,
    "creditsApproved" INTEGER,
    "creditsRefunded" INTEGER,
    "status" "billing"."RecoveryCreditRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestKey" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(1000),
    "approvedByPlatformAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "holdAppliedAt" TIMESTAMP(3),
    "providerReference" VARCHAR(512),
    "providerActionKind" "billing"."RecoveryCreditProviderActionKind",
    "providerAmount" DECIMAL(20,2),
    "providerCurrency" VARCHAR(3),
    "providerConfirmedByPlatformAdminId" TEXT,
    "providerConfirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCreditRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantMessageTranslation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" "support"."MerchantTranslationDirection" NOT NULL,
    "sourceLanguageTag" TEXT NOT NULL,
    "targetLanguageTag" TEXT NOT NULL,
    "status" "support"."MerchantMessageTranslationStatus" NOT NULL,
    "translatedBody" TEXT,
    "failureCode" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "currentBatchId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantMessageTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantTranslationBatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "support"."MerchantTranslationBatchStatus" NOT NULL,
    "providerBatchId" TEXT,
    "inputFileId" TEXT,
    "outputFileId" TEXT,
    "errorFileId" TEXT,
    "submissionStartedAt" TIMESTAMP(3),
    "lastSubmitAttemptAt" TIMESTAMP(3),
    "submitAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextSubmitAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "pollSequence" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantTranslationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantTranslationBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "providerCustomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantTranslationBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantTranslationReconciliationRequest" (
    "id" TEXT NOT NULL,
    "requestedByPlatformAdminId" TEXT NOT NULL,
    "scope" "support"."MerchantTranslationReconciliationScope" NOT NULL,
    "translationId" TEXT,
    "status" "support"."MerchantTranslationReconciliationStatus" NOT NULL,
    "failureCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantTranslationReconciliationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopId_key" ON "shopify"."ShopSettings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopBrand_shopId_key" ON "shopify"."ShopBrand"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopId_shopifyCustomerId_key" ON "commerce"."Customer"("shopId", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CustomerPhone_customerId_endedAt_idx" ON "commerce"."CustomerPhone"("customerId", "endedAt");

-- CreateIndex
CREATE INDEX "CustomerPhone_phone_endedAt_idx" ON "commerce"."CustomerPhone"("phone", "endedAt");

-- CreateIndex
CREATE INDEX "CheckoutRecoveryStatusHistory_checkoutRecoveryId_occurredAt_idx" ON "commerce"."CheckoutRecoveryStatusHistory"("checkoutRecoveryId", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckoutRecoveryStatusHistory_toStatus_occurredAt_idx" ON "commerce"."CheckoutRecoveryStatusHistory"("toStatus", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckoutRecovery_customerId_idx" ON "commerce"."CheckoutRecovery"("customerId");

-- CreateIndex
CREATE INDEX "CheckoutRecovery_shopId_admissionBlockReason_status_detecte_idx" ON "commerce"."CheckoutRecovery"("shopId", "admissionBlockReason", "status", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutRecovery_shopId_checkoutToken_key" ON "commerce"."CheckoutRecovery"("shopId", "checkoutToken");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_standaloneScopeKey_key" ON "whatsapp"."Conversation"("standaloneScopeKey");

-- CreateIndex
CREATE INDEX "Conversation_checkoutRecoveryId_idx" ON "whatsapp"."Conversation"("checkoutRecoveryId");

-- CreateIndex
CREATE INDEX "Conversation_shopId_customerId_type_outcome_idx" ON "whatsapp"."Conversation"("shopId", "customerId", "type", "outcome");

-- CreateIndex
CREATE INDEX "Conversation_customerId_lastMessageAt_idx" ON "whatsapp"."Conversation"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "whatsapp"."Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_processingStartedAt_idx" ON "whatsapp"."Conversation"("processingStartedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_checkoutRecoveryId_key" ON "whatsapp"."Conversation"("checkoutRecoveryId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_providerMessageId_key" ON "whatsapp"."ConversationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "whatsapp"."ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_inReplyToProviderId_idx" ON "whatsapp"."ConversationMessage"("inReplyToProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_shopifyPlanHandle_key" ON "billing"."BillingPlan"("shopifyPlanHandle");

-- CreateIndex
CREATE INDEX "BillingPlan_active_idx" ON "billing"."BillingPlan"("active");

-- CreateIndex
CREATE INDEX "BillingUpgradeEconomicsEdge_active_idx" ON "billing"."BillingUpgradeEconomicsEdge"("active");

-- CreateIndex
CREATE UNIQUE INDEX "BillingUpgradeEconomicsEdge_lowerPlanId_key" ON "billing"."BillingUpgradeEconomicsEdge"("lowerPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingUpgradeEconomicsEdge_higherPlanId_key" ON "billing"."BillingUpgradeEconomicsEdge"("higherPlanId");

-- CreateIndex
CREATE INDEX "BillingEconomicsSnapshot_billingPlanId_createdAt_idx" ON "billing"."BillingEconomicsSnapshot"("billingPlanId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEconomicsSnapshot_verifiedByPlatformAdminId_createdA_idx" ON "billing"."BillingEconomicsSnapshot"("verifiedByPlatformAdminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlanFeature_planId_feature_key" ON "billing"."BillingPlanFeature"("planId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "billing"."Subscription"("shopId");

-- CreateIndex
CREATE INDEX "Subscription_observedShopifyPlanHandle_idx" ON "billing"."Subscription"("observedShopifyPlanHandle");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "billing"."Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_billingPeriodId_idx" ON "billing"."Subscription"("billingPeriodId");

-- CreateIndex
CREATE INDEX "Subscription_nextReconcileAt_idx" ON "billing"."Subscription"("nextReconcileAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "billing"."UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_shopifyIdempotencyKey_key" ON "billing"."UsageEvent"("shopifyIdempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_shopId_billingPeriodId_occurredAt_idx" ON "billing"."UsageEvent"("shopId", "billingPeriodId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_shopId_metric_occurredAt_idx" ON "billing"."UsageEvent"("shopId", "metric", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_shopifyReportState_nextReportAt_occurredAt_idx" ON "billing"."UsageEvent"("shopifyReportState", "nextReportAt", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_shopifyReportState_lastReportAttemptAt_idx" ON "billing"."UsageEvent"("shopifyReportState", "lastReportAttemptAt");

-- CreateIndex
CREATE INDEX "UsageEvent_correctionOfUsageEventId_idx" ON "billing"."UsageEvent"("correctionOfUsageEventId");

-- CreateIndex
CREATE INDEX "UsageEvent_billingPeriodId_idx" ON "billing"."UsageEvent"("billingPeriodId");

-- CreateIndex
CREATE INDEX "ShopEntitlementCounter_shopId_idx" ON "billing"."ShopEntitlementCounter"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopEntitlementCounter_shopId_counter_key" ON "billing"."ShopEntitlementCounter"("shopId", "counter");

-- CreateIndex
CREATE INDEX "BillingPeriodEntitlementCounter_shopId_billingPeriodId_idx" ON "billing"."BillingPeriodEntitlementCounter"("shopId", "billingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriodEntitlementCounter_billingPeriodId_counter_key" ON "billing"."BillingPeriodEntitlementCounter"("billingPeriodId", "counter");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCreditPurchase_usageEventId_key" ON "billing"."RecoveryCreditPurchase"("usageEventId");

-- CreateIndex
CREATE INDEX "RecoveryCreditPurchase_shopId_status_createdAt_idx" ON "billing"."RecoveryCreditPurchase"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCreditPurchase_shopId_status_activatedAt_createdAt__idx" ON "billing"."RecoveryCreditPurchase"("shopId", "status", "activatedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "RecoveryCreditPurchase_planId_createdAt_idx" ON "billing"."RecoveryCreditPurchase"("planId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageReservation_sourceKey_key" ON "billing"."UsageReservation"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageReservation_committedUsageEventId_key" ON "billing"."UsageReservation"("committedUsageEventId");

-- CreateIndex
CREATE INDEX "UsageReservation_shopId_status_idx" ON "billing"."UsageReservation"("shopId", "status");

-- CreateIndex
CREATE INDEX "UsageReservation_status_expiresAt_idx" ON "billing"."UsageReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "UsageReservation_purchasedCreditPurchaseId_status_idx" ON "billing"."UsageReservation"("purchasedCreditPurchaseId", "status");

-- CreateIndex
CREATE INDEX "UsageReservation_promotionalCreditGrantId_status_idx" ON "billing"."UsageReservation"("promotionalCreditGrantId", "status");

-- CreateIndex
CREATE INDEX "UsageReservation_billingPeriodEntitlementCounterId_idx" ON "billing"."UsageReservation"("billingPeriodEntitlementCounterId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageReservation_id_shopId_key" ON "billing"."UsageReservation"("id", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopBillingPolicyOverride_shopId_key" ON "billing"."ShopBillingPolicyOverride"("shopId");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_expiresAt_idx" ON "billing"."ShopBillingPolicyOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_shopId_expiresAt_idx" ON "billing"."ShopBillingPolicyOverride"("shopId", "expiresAt");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_updatedByPlatformAdminId_idx" ON "billing"."ShopBillingPolicyOverride"("updatedByPlatformAdminId");

-- CreateIndex
CREATE INDEX "PromotionCampaign_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("status", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "PromotionCampaign_targetPlanId_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("targetPlanId", "status", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "PromotionCampaign_targetShopId_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("targetShopId", "status", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "PromotionCampaign_createdAt_idx" ON "billing"."PromotionCampaign"("createdAt");

-- CreateIndex
CREATE INDEX "PromotionCampaign_updatedAt_idx" ON "billing"."PromotionCampaign"("updatedAt");

-- CreateIndex
CREATE INDEX "PromotionCampaignEvent_campaignId_createdAt_idx" ON "billing"."PromotionCampaignEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionCampaignEvent_platformAdminId_createdAt_idx" ON "billing"."PromotionCampaignEvent"("platformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionalCreditGrant_shopId_createdAt_idx" ON "billing"."PromotionalCreditGrant"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionalCreditGrant_campaignId_createdAt_idx" ON "billing"."PromotionalCreditGrant"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionalCreditGrant_campaignId_shopId_key" ON "billing"."PromotionalCreditGrant"("campaignId", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionalCreditGrant_id_shopId_key" ON "billing"."PromotionalCreditGrant"("id", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPromotionSelection_shopId_key" ON "billing"."MerchantPromotionSelection"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPromotionSelection_promotionalCreditGrantId_key" ON "billing"."MerchantPromotionSelection"("promotionalCreditGrantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPromotionSelection_promotionalCreditGrantId_shopId_key" ON "billing"."MerchantPromotionSelection"("promotionalCreditGrantId", "shopId");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_shopId_createdAt_idx" ON "billing"."BillingAuditEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_platformAdminId_createdAt_idx" ON "billing"."BillingAuditEvent"("platformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_action_createdAt_idx" ON "billing"."BillingAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "BillingPeriod_shopId_periodStart_periodEnd_idx" ON "billing"."BillingPeriod"("shopId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "BillingPeriod_subscriptionId_periodStart_periodEnd_idx" ON "billing"."BillingPeriod"("subscriptionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriod_shopId_periodStart_periodEnd_key" ON "billing"."BillingPeriod"("shopId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "commerce"."Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "commerce"."Shop"("shopifyShopId");

-- CreateIndex
CREATE INDEX "Shop_status_idx" ON "commerce"."Shop"("status");

-- CreateIndex
CREATE INDEX "Shop_status_reinstallPendingAt_idx" ON "commerce"."Shop"("status", "reinstallPendingAt");

-- CreateIndex
CREATE INDEX "WhatsAppTemplateVariant_shopId_providerAccountId_purpose_la_idx" ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "languageTag", "enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplateVariant_identity_key" ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "providerTemplateName", "providerLanguageCode");

-- CreateIndex
CREATE UNIQUE INDEX "Tour_city_country_key" ON "Tour"("city", "country");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "PlatformAdmin_active_role_idx" ON "PlatformAdmin"("active", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_provider_providerSubject_key" ON "PlatformAdmin"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSupportThread_shopId_key" ON "support"."MerchantSupportThread"("shopId");

-- CreateIndex
CREATE INDEX "MerchantSupportThread_needsAdminResponse_lastMerchantMessag_idx" ON "support"."MerchantSupportThread"("needsAdminResponse", "lastMerchantMessageAt");

-- CreateIndex
CREATE INDEX "MerchantSupportThread_assignedPlatformAdminId_idx" ON "support"."MerchantSupportThread"("assignedPlatformAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSupportMessage_sourceKey_key" ON "support"."MerchantSupportMessage"("sourceKey");

-- CreateIndex
CREATE INDEX "MerchantSupportMessage_threadId_createdAt_idx" ON "support"."MerchantSupportMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantSupportMessage_platformAdminId_idx" ON "support"."MerchantSupportMessage"("platformAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCreditRefund_requestKey_key" ON "billing"."RecoveryCreditRefund"("requestKey");

-- CreateIndex
CREATE INDEX "RecoveryCreditRefund_shopId_status_createdAt_idx" ON "billing"."RecoveryCreditRefund"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCreditRefund_purchaseId_status_createdAt_idx" ON "billing"."RecoveryCreditRefund"("purchaseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCreditRefund_sourceMessageId_idx" ON "billing"."RecoveryCreditRefund"("sourceMessageId");

-- CreateIndex
CREATE INDEX "RecoveryCreditRefund_approvedByPlatformAdminId_createdAt_idx" ON "billing"."RecoveryCreditRefund"("approvedByPlatformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCreditRefund_providerConfirmedByPlatformAdminId_cre_idx" ON "billing"."RecoveryCreditRefund"("providerConfirmedByPlatformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantMessageTranslation_status_currentBatchId_nextAttemp_idx" ON "support"."MerchantMessageTranslation"("status", "currentBatchId", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMessageTranslation_messageId_targetLanguageTag_key" ON "support"."MerchantMessageTranslation"("messageId", "targetLanguageTag");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatch_status_nextSubmitAt_createdAt_idx" ON "support"."MerchantTranslationBatch"("status", "nextSubmitAt", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatch_status_nextPollAt_createdAt_idx" ON "support"."MerchantTranslationBatch"("status", "nextPollAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatch_provider_providerBatchId_key" ON "support"."MerchantTranslationBatch"("provider", "providerBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatchItem_providerCustomId_key" ON "support"."MerchantTranslationBatchItem"("providerCustomId");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatchItem_translationId_createdAt_idx" ON "support"."MerchantTranslationBatchItem"("translationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatchItem_batchId_translationId_key" ON "support"."MerchantTranslationBatchItem"("batchId", "translationId");

-- CreateIndex
CREATE INDEX "MerchantTranslationReconciliationRequest_status_requestedAt_idx" ON "support"."MerchantTranslationReconciliationRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "MerchantTranslationReconciliationRequest_translationId_stat_idx" ON "support"."MerchantTranslationReconciliationRequest"("translationId", "status");

-- AddForeignKey
ALTER TABLE "shopify"."ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify"."ShopBrand" ADD CONSTRAINT "ShopBrand_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CustomerPhone" ADD CONSTRAINT "CustomerPhone_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CheckoutRecoveryStatusHistory" ADD CONSTRAINT "CheckoutRecoveryStatusHistory_checkoutRecoveryId_fkey" FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CheckoutRecovery" ADD CONSTRAINT "CheckoutRecovery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CheckoutRecovery" ADD CONSTRAINT "CheckoutRecovery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_checkoutRecoveryId_fkey" FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingUpgradeEconomicsEdge" ADD CONSTRAINT "BillingUpgradeEconomicsEdge_lowerPlanId_fkey" FOREIGN KEY ("lowerPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingUpgradeEconomicsEdge" ADD CONSTRAINT "BillingUpgradeEconomicsEdge_higherPlanId_fkey" FOREIGN KEY ("higherPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingEconomicsSnapshot" ADD CONSTRAINT "BillingEconomicsSnapshot_billingPlanId_fkey" FOREIGN KEY ("billingPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingEconomicsSnapshot" ADD CONSTRAINT "BillingEconomicsSnapshot_verifiedByPlatformAdminId_fkey" FOREIGN KEY ("verifiedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPlanFeature" ADD CONSTRAINT "BillingPlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_correctionOfUsageEventId_fkey" FOREIGN KEY ("correctionOfUsageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ShopEntitlementCounter" ADD CONSTRAINT "ShopEntitlementCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPeriodEntitlementCounter" ADD CONSTRAINT "BillingPeriodEntitlementCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPeriodEntitlementCounter" ADD CONSTRAINT "BillingPeriodEntitlementCounter_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "billing"."ShopEntitlementCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_billingPeriodEntitlementCounterId_fkey" FOREIGN KEY ("billingPeriodEntitlementCounterId") REFERENCES "billing"."BillingPeriodEntitlementCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_purchasedCreditPurchaseId_fkey" FOREIGN KEY ("purchasedCreditPurchaseId") REFERENCES "billing"."RecoveryCreditPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_promotionalCreditGrantId_shopId_fkey" FOREIGN KEY ("promotionalCreditGrantId", "shopId") REFERENCES "billing"."PromotionalCreditGrant"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_committedUsageEventId_fkey" FOREIGN KEY ("committedUsageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ShopBillingPolicyOverride" ADD CONSTRAINT "ShopBillingPolicyOverride_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ShopBillingPolicyOverride" ADD CONSTRAINT "ShopBillingPolicyOverride_updatedByPlatformAdminId_fkey" FOREIGN KEY ("updatedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_targetShopId_fkey" FOREIGN KEY ("targetShopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_createdByPlatformAdminId_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaignEvent" ADD CONSTRAINT "PromotionCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "billing"."PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaignEvent" ADD CONSTRAINT "PromotionCampaignEvent_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionalCreditGrant" ADD CONSTRAINT "PromotionalCreditGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."PromotionalCreditGrant" ADD CONSTRAINT "PromotionalCreditGrant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "billing"."PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."MerchantPromotionSelection" ADD CONSTRAINT "MerchantPromotionSelection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."MerchantPromotionSelection" ADD CONSTRAINT "MerchantPromotionSelection_promotionalCreditGrantId_shopId_fkey" FOREIGN KEY ("promotionalCreditGrantId", "shopId") REFERENCES "billing"."PromotionalCreditGrant"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPeriod" ADD CONSTRAINT "BillingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPeriod" ADD CONSTRAINT "BillingPeriod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "billing"."Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingPeriod" ADD CONSTRAINT "BillingPeriod_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WhatsAppTemplateVariant" ADD CONSTRAINT "WhatsAppTemplateVariant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportThread" ADD CONSTRAINT "MerchantSupportThread_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportThread" ADD CONSTRAINT "MerchantSupportThread_assignedPlatformAdminId_fkey" FOREIGN KEY ("assignedPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportMessage" ADD CONSTRAINT "MerchantSupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "support"."MerchantSupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportMessage" ADD CONSTRAINT "MerchantSupportMessage_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "billing"."RecoveryCreditPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "support"."MerchantSupportMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_approvedByPlatformAdminId_fkey" FOREIGN KEY ("approvedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_providerConfirmedByPlatformAdminId_fkey" FOREIGN KEY ("providerConfirmedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantMessageTranslation" ADD CONSTRAINT "MerchantMessageTranslation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "support"."MerchantSupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantMessageTranslation" ADD CONSTRAINT "MerchantMessageTranslation_currentBatchId_fkey" FOREIGN KEY ("currentBatchId") REFERENCES "support"."MerchantTranslationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationBatchItem" ADD CONSTRAINT "MerchantTranslationBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "support"."MerchantTranslationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationBatchItem" ADD CONSTRAINT "MerchantTranslationBatchItem_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "support"."MerchantMessageTranslation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationReconciliationRequest" ADD CONSTRAINT "MerchantTranslationReconciliationRequest_requestedByPlatfo_fkey" FOREIGN KEY ("requestedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing"."PlatformBillingPolicy"
ADD CONSTRAINT "PlatformBillingPolicy_minimumUpgradePremiumBps_check"
CHECK ("minimumUpgradePremiumBps" BETWEEN 0 AND 10000);

ALTER TABLE "billing"."BillingUpgradeEconomicsEdge"
ADD CONSTRAINT "BillingUpgradeEconomicsEdge_distinctPlans_check"
CHECK ("lowerPlanId" <> "higherPlanId");

ALTER TABLE "billing"."PromotionalCreditGrant"
ADD CONSTRAINT "PromotionalCreditGrant_positiveQuantity_check"
CHECK ("quantity" > 0),
ADD CONSTRAINT "PromotionalCreditGrant_nonnegativeReservedQuantity_check"
CHECK ("reservedQuantity" >= 0),
ADD CONSTRAINT "PromotionalCreditGrant_nonnegativeCommittedQuantity_check"
CHECK ("committedQuantity" >= 0),
ADD CONSTRAINT "PromotionalCreditGrant_quantityAccounting_check"
CHECK ("reservedQuantity" + "committedQuantity" <= "quantity"),
ADD CONSTRAINT "PromotionalCreditGrant_nonnegativeSelectionCount_check"
CHECK ("selectionCount" >= 0);

