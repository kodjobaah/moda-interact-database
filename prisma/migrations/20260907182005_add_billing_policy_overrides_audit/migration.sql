-- CreateEnum
CREATE TYPE "billing"."BillingAuditAction" AS ENUM ('PLAN_CATALOG_CHANGED', 'PLATFORM_POLICY_CHANGED', 'SHOP_OVERRIDE_CHANGED', 'SHOP_OVERRIDE_EXPIRED', 'FREE_ALLOWANCE_ADJUSTED', 'AUTOMATION_PAUSED', 'AUTOMATION_RESUMED', 'BILLING_EVENT_RETRY', 'BILLING_CORRECTION_CREATED');

-- CreateTable
CREATE TABLE "billing"."PlatformBillingPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "globalPauseNewRecoveries" BOOLEAN NOT NULL DEFAULT false,
    "globalPauseAutomatedWhatsapp" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "billing"."BillingAllowanceAdjustment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "counter" "billing"."EntitlementCounter" NOT NULL DEFAULT 'FREE_RECOVERY_LIFETIME',
    "quantity" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAllowanceAdjustment_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "ShopBillingPolicyOverride_shopId_key" ON "billing"."ShopBillingPolicyOverride"("shopId");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_expiresAt_idx" ON "billing"."ShopBillingPolicyOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_shopId_expiresAt_idx" ON "billing"."ShopBillingPolicyOverride"("shopId", "expiresAt");

-- CreateIndex
CREATE INDEX "ShopBillingPolicyOverride_updatedByPlatformAdminId_idx" ON "billing"."ShopBillingPolicyOverride"("updatedByPlatformAdminId");

-- CreateIndex
CREATE INDEX "BillingAllowanceAdjustment_shopId_counter_createdAt_idx" ON "billing"."BillingAllowanceAdjustment"("shopId", "counter", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAllowanceAdjustment_platformAdminId_createdAt_idx" ON "billing"."BillingAllowanceAdjustment"("platformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_shopId_createdAt_idx" ON "billing"."BillingAuditEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_platformAdminId_createdAt_idx" ON "billing"."BillingAuditEvent"("platformAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingAuditEvent_action_createdAt_idx" ON "billing"."BillingAuditEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "billing"."ShopBillingPolicyOverride" ADD CONSTRAINT "ShopBillingPolicyOverride_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ShopBillingPolicyOverride" ADD CONSTRAINT "ShopBillingPolicyOverride_updatedByPlatformAdminId_fkey" FOREIGN KEY ("updatedByPlatformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAllowanceAdjustment" ADD CONSTRAINT "BillingAllowanceAdjustment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAllowanceAdjustment" ADD CONSTRAINT "BillingAllowanceAdjustment_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
