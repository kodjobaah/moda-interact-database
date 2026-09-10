-- AlterEnum
ALTER TYPE "billing"."RecoveryCreditPurchaseStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "billing"."BillingAuditAction" ADD VALUE 'SUBSCRIPTION_CANCELLATION';
ALTER TYPE "billing"."BillingAuditAction" ADD VALUE 'RECOVERY_CREDIT_REFUND';

-- CreateEnum
CREATE TYPE "billing"."BillingLifecycleRequestSource" AS ENUM ('MERCHANT_UI', 'MERCHANT_SUPPORT', 'ADMIN');
CREATE TYPE "billing"."SubscriptionCancellationMode" AS ENUM ('END_OF_CYCLE', 'IMMEDIATE_NO_PRORATION', 'IMMEDIATE_PRORATED', 'IMMEDIATE_SKIP_FINAL_USAGE');
CREATE TYPE "billing"."SubscriptionCancellationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'RETRYABLE', 'PROVIDER_ACCEPTED', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'NEEDS_ATTENTION');
CREATE TYPE "billing"."RecoveryCreditRefundSettlementMode" AS ENUM ('CURRENT_CYCLE_APP_EVENT_CORRECTION', 'PARTNER_DASHBOARD_REFUND');
CREATE TYPE "billing"."RecoveryCreditRefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PROVIDER_PENDING', 'PROVIDER_ACTION_REQUIRED', 'PROVIDER_CONFIRMED', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'NEEDS_ATTENTION');

-- AlterTable
ALTER TABLE "billing"."ShopEntitlementCounter" ADD COLUMN "refundingQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "billing"."SubscriptionCancellationRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" "billing"."BillingLifecycleRequestSource" NOT NULL,
    "sourceMessageId" TEXT,
    "requestedByShopifyUserId" TEXT,
    "providerSubscriptionIdSnapshot" TEXT NOT NULL,
    "planHandleSnapshot" TEXT NOT NULL,
    "currentPeriodEndSnapshot" TIMESTAMP(3),
    "mode" "billing"."SubscriptionCancellationMode" NOT NULL DEFAULT 'END_OF_CYCLE',
    "status" "billing"."SubscriptionCancellationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestKey" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(1000),
    "approvedByPlatformAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "providerAcceptedAt" TIMESTAMP(3),
    "providerErrorCode" VARCHAR(128),
    "providerResponseSummary" VARCHAR(2000),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionCancellationRequest_pkey" PRIMARY KEY ("id")
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
    "settlementMode" "billing"."RecoveryCreditRefundSettlementMode",
    "status" "billing"."RecoveryCreditRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestKey" VARCHAR(255) NOT NULL,
    "reason" VARCHAR(1000),
    "approvedByPlatformAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "holdAppliedAt" TIMESTAMP(3),
    "correctionUsageEventId" TEXT,
    "providerReference" VARCHAR(512),
    "providerConfirmedByPlatformAdminId" TEXT,
    "providerConfirmedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "providerErrorCode" VARCHAR(128),
    "providerResponseSummary" VARCHAR(2000),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCreditRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCancellationRequest_requestKey_key" ON "billing"."SubscriptionCancellationRequest"("requestKey");
CREATE INDEX "SubscriptionCancellationRequest_shopId_status_createdAt_idx" ON "billing"."SubscriptionCancellationRequest"("shopId", "status", "createdAt");
CREATE INDEX "SubscriptionCancellationRequest_status_nextAttemptAt_createdAt_idx" ON "billing"."SubscriptionCancellationRequest"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "SubscriptionCancellationRequest_sourceMessageId_idx" ON "billing"."SubscriptionCancellationRequest"("sourceMessageId");
CREATE INDEX "SubscriptionCancellationRequest_approvedByPlatformAdminId_createdAt_idx" ON "billing"."SubscriptionCancellationRequest"("approvedByPlatformAdminId", "createdAt");
CREATE UNIQUE INDEX "RecoveryCreditRefund_purchaseId_key" ON "billing"."RecoveryCreditRefund"("purchaseId");
CREATE UNIQUE INDEX "RecoveryCreditRefund_requestKey_key" ON "billing"."RecoveryCreditRefund"("requestKey");
CREATE UNIQUE INDEX "RecoveryCreditRefund_correctionUsageEventId_key" ON "billing"."RecoveryCreditRefund"("correctionUsageEventId");
CREATE INDEX "RecoveryCreditRefund_shopId_status_createdAt_idx" ON "billing"."RecoveryCreditRefund"("shopId", "status", "createdAt");
CREATE INDEX "RecoveryCreditRefund_status_nextAttemptAt_createdAt_idx" ON "billing"."RecoveryCreditRefund"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "RecoveryCreditRefund_sourceMessageId_idx" ON "billing"."RecoveryCreditRefund"("sourceMessageId");
CREATE INDEX "RecoveryCreditRefund_approvedByPlatformAdminId_createdAt_idx" ON "billing"."RecoveryCreditRefund"("approvedByPlatformAdminId", "createdAt");
CREATE INDEX "RecoveryCreditRefund_providerConfirmedByPlatformAdminId_createdAt_idx" ON "billing"."RecoveryCreditRefund"("providerConfirmedByPlatformAdminId", "createdAt");

-- AddForeignKey
ALTER TABLE "billing"."SubscriptionCancellationRequest" ADD CONSTRAINT "SubscriptionCancellationRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."SubscriptionCancellationRequest" ADD CONSTRAINT "SubscriptionCancellationRequest_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "support"."MerchantSupportMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."SubscriptionCancellationRequest" ADD CONSTRAINT "SubscriptionCancellationRequest_approvedByPlatformAdminId_fkey" FOREIGN KEY ("approvedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "billing"."RecoveryCreditPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "support"."MerchantSupportMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_correctionUsageEventId_fkey" FOREIGN KEY ("correctionUsageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_approvedByPlatformAdminId_fkey" FOREIGN KEY ("approvedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing"."RecoveryCreditRefund" ADD CONSTRAINT "RecoveryCreditRefund_providerConfirmedByPlatformAdminId_fkey" FOREIGN KEY ("providerConfirmedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
