-- AlterEnum
ALTER TYPE "billing"."BillingAuditAction" ADD VALUE 'PROMOTIONAL_CREDITS_GRANTED';

-- CreateEnum
CREATE TYPE "billing"."PromotionalCreditGrantType" AS ENUM ('CAMPAIGN', 'BETA_TESTER', 'GOODWILL', 'SUPPORT', 'INTERNAL_TEST', 'OTHER');

-- CreateTable
CREATE TABLE "billing"."PromotionalCreditGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "grantType" "billing"."PromotionalCreditGrantType" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "campaignReference" VARCHAR(255),
    "requestKey" VARCHAR(255) NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionalCreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromotionalCreditGrant_requestKey_key" ON "billing"."PromotionalCreditGrant"("requestKey");
CREATE INDEX "PromotionalCreditGrant_shopId_createdAt_idx" ON "billing"."PromotionalCreditGrant"("shopId", "createdAt");
CREATE INDEX "PromotionalCreditGrant_campaignReference_createdAt_idx" ON "billing"."PromotionalCreditGrant"("campaignReference", "createdAt");
CREATE INDEX "PromotionalCreditGrant_platformAdminId_createdAt_idx" ON "billing"."PromotionalCreditGrant"("platformAdminId", "createdAt");

-- AddForeignKey
ALTER TABLE "billing"."PromotionalCreditGrant" ADD CONSTRAINT "PromotionalCreditGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."PromotionalCreditGrant" ADD CONSTRAINT "PromotionalCreditGrant_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddConstraint
ALTER TABLE "billing"."PromotionalCreditGrant" ADD CONSTRAINT "PromotionalCreditGrant_quantity_positive" CHECK ("quantity" > 0);