-- CreateEnum
CREATE TYPE "billing"."RecoveryCreditPurchaseStatus" AS ENUM ('PENDING_BILLING', 'ACTIVE', 'NEEDS_ATTENTION', 'CANCELLED');

-- AlterEnum
ALTER TYPE "billing"."EntitlementCounter" ADD VALUE 'PURCHASED_RECOVERY_CREDITS';

-- AlterEnum
ALTER TYPE "billing"."UsageMetric" ADD VALUE 'RECOVERY_CREDIT_PACK_PURCHASE';

-- AlterTable
ALTER TABLE "billing"."BillingPlan" ADD COLUMN     "includedRecoveryConversationAllowance" INTEGER,
ADD COLUMN     "recoveryCreditPackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryCreditsPerPack" INTEGER,
ADD COLUMN     "shopifyRecoveryCreditPackEventHandle" TEXT;

-- Enforce the typed recovery-credit pack configuration at the database boundary.
ALTER TABLE "billing"."BillingPlan"
ADD CONSTRAINT "BillingPlan_recovery_credit_pack_config"
CHECK (
    (NOT "recoveryCreditPackEnabled" OR "recoveryCreditsPerPack" > 0)
    AND (NOT "recoveryCreditPackEnabled" OR NULLIF(BTRIM("shopifyRecoveryCreditPackEventHandle"), '') IS NOT NULL)
    AND (NOT ("kind" = 'PAID_METERED' AND "recoveryCreditPackEnabled") OR ("includedRecoveryConversationAllowance" IS NOT NULL AND "includedRecoveryConversationAllowance" >= 0))
    AND ("shopifyUsageEventHandle" IS NULL OR "shopifyRecoveryCreditPackEventHandle" IS NULL OR "shopifyUsageEventHandle" <> "shopifyRecoveryCreditPackEventHandle")
);

-- AlterTable
ALTER TABLE "billing"."ShopEntitlementCounter" ADD COLUMN     "grantedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "billing"."RecoveryCreditPurchase" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planId" TEXT,
    "shopifyPlanHandleSnapshot" TEXT NOT NULL,
    "shopifyEventHandleSnapshot" TEXT NOT NULL,
    "creditsGranted" INTEGER NOT NULL,
    "status" "billing"."RecoveryCreditPurchaseStatus" NOT NULL DEFAULT 'PENDING_BILLING',
    "usageEventId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCreditPurchase_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing"."RecoveryCreditPurchase"
ADD CONSTRAINT "RecoveryCreditPurchase_creditsGranted_positive"
CHECK ("creditsGranted" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCreditPurchase_usageEventId_key" ON "billing"."RecoveryCreditPurchase"("usageEventId");

-- CreateIndex
CREATE INDEX "RecoveryCreditPurchase_shopId_status_createdAt_idx" ON "billing"."RecoveryCreditPurchase"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCreditPurchase_planId_createdAt_idx" ON "billing"."RecoveryCreditPurchase"("planId", "createdAt");

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."RecoveryCreditPurchase" ADD CONSTRAINT "RecoveryCreditPurchase_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
