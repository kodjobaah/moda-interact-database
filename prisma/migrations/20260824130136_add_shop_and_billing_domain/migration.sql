/*
  Warnings:

  - You are about to drop the column `shop` on the `CheckoutRecovery` table. All the data in the column will be lost.
  - You are about to drop the column `shop` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `shop` on the `ShopSettings` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[shopId,checkoutToken]` on the table `CheckoutRecovery` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shopId,shopifyCustomerId]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shopId]` on the table `ShopSettings` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `shopId` to the `CheckoutRecovery` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shopId` to the `Customer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shopId` to the `ShopSettings` table without a default value. This is not possible if the table is not empty.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateEnum
CREATE TYPE "commerce"."ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');

-- DropIndex
DROP INDEX "commerce"."CheckoutRecovery_shop_checkoutToken_key";

-- DropIndex
DROP INDEX "commerce"."CheckoutRecovery_shop_status_idx";

-- DropIndex
DROP INDEX "commerce"."Customer_shop_idx";

-- DropIndex
DROP INDEX "commerce"."Customer_shop_phone_key";

-- DropIndex
DROP INDEX "commerce"."Customer_shop_shopifyCustomerId_key";

-- DropIndex
DROP INDEX "shopify"."ShopSettings_shop_key";

-- AlterTable
ALTER TABLE "commerce"."CheckoutRecovery" DROP COLUMN "shop",
ADD COLUMN     "shopId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "commerce"."Customer" DROP COLUMN "shop",
ADD COLUMN     "shopId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "shopify"."ShopSettings" DROP COLUMN "shop",
ADD COLUMN     "shopId" TEXT NOT NULL;

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
CREATE TABLE "billing"."BillingPlan" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."Subscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "planId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "planHandle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "providerSubscriptionId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."UsageEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'SHOPIFY',
    "providerResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "status" "commerce"."ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerPhone_customerId_endedAt_idx" ON "commerce"."CustomerPhone"("customerId", "endedAt");

-- CreateIndex
CREATE INDEX "CustomerPhone_phone_endedAt_idx" ON "commerce"."CustomerPhone"("phone", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_handle_key" ON "billing"."BillingPlan"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_shopId_key" ON "billing"."Subscription"("shopId");

-- CreateIndex
CREATE INDEX "Subscription_planHandle_idx" ON "billing"."Subscription"("planHandle");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "billing"."UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_shopId_metric_occurredAt_idx" ON "billing"."UsageEvent"("shopId", "metric", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "commerce"."Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "commerce"."Shop"("shopifyShopId");

-- CreateIndex
CREATE INDEX "Shop_status_idx" ON "commerce"."Shop"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutRecovery_shopId_checkoutToken_key" ON "commerce"."CheckoutRecovery"("shopId", "checkoutToken");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopId_shopifyCustomerId_key" ON "commerce"."Customer"("shopId", "shopifyCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shopId_key" ON "shopify"."ShopSettings"("shopId");

-- AddForeignKey
ALTER TABLE "shopify"."ShopSettings" ADD CONSTRAINT "ShopSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CustomerPhone" ADD CONSTRAINT "CustomerPhone_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."CheckoutRecovery" ADD CONSTRAINT "CheckoutRecovery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
