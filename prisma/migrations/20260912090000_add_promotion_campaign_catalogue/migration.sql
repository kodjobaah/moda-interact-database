-- CreateEnum
CREATE TYPE "billing"."PromotionTargetScope" AS ENUM ('GLOBAL', 'PLAN', 'SHOP');

-- CreateEnum
CREATE TYPE "billing"."PromotionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "billing"."PromotionCampaignEventType" AS ENUM ('CREATED', 'ACTIVATED', 'CLOSED', 'REOPENED', 'EXPIRY_CHANGED');

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

-- CreateIndex
CREATE INDEX "PromotionCampaign_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("status", "startsAt", "expiresAt");
CREATE INDEX "PromotionCampaign_targetPlanId_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("targetPlanId", "status", "startsAt", "expiresAt");
CREATE INDEX "PromotionCampaign_targetShopId_status_startsAt_expiresAt_idx" ON "billing"."PromotionCampaign"("targetShopId", "status", "startsAt", "expiresAt");
CREATE INDEX "PromotionCampaign_createdAt_idx" ON "billing"."PromotionCampaign"("createdAt");
CREATE INDEX "PromotionCampaign_updatedAt_idx" ON "billing"."PromotionCampaign"("updatedAt");
CREATE INDEX "PromotionCampaignEvent_campaignId_createdAt_idx" ON "billing"."PromotionCampaignEvent"("campaignId", "createdAt");
CREATE INDEX "PromotionCampaignEvent_platformAdminId_createdAt_idx" ON "billing"."PromotionCampaignEvent"("platformAdminId", "createdAt");

-- AddConstraint
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_expiry_after_start" CHECK ("expiresAt" > "startsAt");
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_scope_target_shape" CHECK (
    ("scope" = 'GLOBAL' AND "targetPlanId" IS NULL AND "targetShopId" IS NULL)
    OR ("scope" = 'PLAN' AND "targetPlanId" IS NOT NULL AND "targetShopId" IS NULL)
    OR ("scope" = 'SHOP' AND "targetPlanId" IS NULL AND "targetShopId" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_targetPlanId_fkey" FOREIGN KEY ("targetPlanId") REFERENCES "billing"."BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_targetShopId_fkey" FOREIGN KEY ("targetShopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."PromotionCampaign" ADD CONSTRAINT "PromotionCampaign_createdByPlatformAdminId_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."PromotionCampaignEvent" ADD CONSTRAINT "PromotionCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "billing"."PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."PromotionCampaignEvent" ADD CONSTRAINT "PromotionCampaignEvent_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
