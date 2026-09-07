-- CreateEnum
CREATE TYPE "billing"."BillingPlanKind" AS ENUM ('FREE', 'PAID_METERED');

-- CreateEnum
CREATE TYPE "billing"."BillingPlanFeatureIdentifier" AS ENUM ('CHECKOUT_RECOVERY', 'AI_CONVERSATIONS', 'PRODUCT_SEARCH', 'ORDER_SUPPORT');

-- CreateEnum
CREATE TYPE "billing"."SubscriptionProjectionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'NO_CONTRACT', 'UNMAPPED', 'SYNC_ERROR');

-- CreateEnum
CREATE TYPE "billing"."BillingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- DropIndex
DROP INDEX "billing"."BillingPlan_handle_key";

-- DropIndex
DROP INDEX "billing"."Subscription_planHandle_idx";

-- DropIndex
DROP INDEX "billing"."BillingPeriod_shopId_periodStart_key";

-- AlterTable
ALTER TABLE "billing"."BillingPlan" DROP COLUMN "entitlements",
DROP COLUMN "handle",
DROP COLUMN "limits",
ADD COLUMN     "defaultOutboundHardLimit" INTEGER NOT NULL,
ADD COLUMN     "defaultOutboundSoftLimit" INTEGER NOT NULL,
ADD COLUMN     "freeLifetimeConversationAllowance" INTEGER,
ADD COLUMN     "kind" "billing"."BillingPlanKind" NOT NULL,
ADD COLUMN     "shopifyPlanHandle" TEXT NOT NULL,
ADD COLUMN     "shopifyUsageEventHandle" TEXT,
ADD COLUMN     "terminalMessageReservedSlots" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "billing"."Subscription" DROP COLUMN "planHandle",
DROP COLUMN "provider",
ADD COLUMN     "billingPeriodId" TEXT,
ADD COLUMN     "lastSyncErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncErrorCode" TEXT,
ADD COLUMN     "observedShopifyPlanHandle" TEXT,
ADD COLUMN     "pendingEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "pendingPlanId" TEXT,
ADD COLUMN     "pendingShopifyPlanHandle" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "billing"."SubscriptionProjectionStatus" NOT NULL;

-- AlterTable
ALTER TABLE "billing"."BillingPeriod" DROP COLUMN "status",
ADD COLUMN     "status" "billing"."BillingPeriodStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "billing"."BillingPlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "feature" "billing"."BillingPlanFeatureIdentifier" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BillingPlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlanFeature_planId_feature_key" ON "billing"."BillingPlanFeature"("planId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_shopifyPlanHandle_key" ON "billing"."BillingPlan"("shopifyPlanHandle");

-- CreateIndex
CREATE INDEX "BillingPlan_active_idx" ON "billing"."BillingPlan"("active");

-- CreateIndex
CREATE INDEX "Subscription_observedShopifyPlanHandle_idx" ON "billing"."Subscription"("observedShopifyPlanHandle");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "billing"."Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_billingPeriodId_idx" ON "billing"."Subscription"("billingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriod_shopId_periodStart_periodEnd_key" ON "billing"."BillingPeriod"("shopId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "billing"."BillingPlanFeature" ADD CONSTRAINT "BillingPlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
