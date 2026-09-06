-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "support";

-- CreateEnum
CREATE TYPE "support"."MerchantSupportMessageKind" AS ENUM ('ADMINISTRATIVE', 'SYSTEM', 'MERCHANT');

-- CreateEnum
CREATE TYPE "support"."MerchantSupportMessageState" AS ENUM ('PROCESSING', 'AVAILABLE', 'FAILED');

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

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSupportThread_shopId_key" ON "support"."MerchantSupportThread"("shopId");

-- CreateIndex
CREATE INDEX "MerchantSupportThread_needsAdminResponse_lastMerchantMessageAt_idx" ON "support"."MerchantSupportThread"("needsAdminResponse", "lastMerchantMessageAt");

-- CreateIndex
CREATE INDEX "MerchantSupportThread_assignedPlatformAdminId_idx" ON "support"."MerchantSupportThread"("assignedPlatformAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSupportMessage_sourceKey_key" ON "support"."MerchantSupportMessage"("sourceKey");

-- CreateIndex
CREATE INDEX "MerchantSupportMessage_threadId_createdAt_idx" ON "support"."MerchantSupportMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantSupportMessage_platformAdminId_idx" ON "support"."MerchantSupportMessage"("platformAdminId");

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportThread" ADD CONSTRAINT "MerchantSupportThread_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportThread" ADD CONSTRAINT "MerchantSupportThread_assignedPlatformAdminId_fkey" FOREIGN KEY ("assignedPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportMessage" ADD CONSTRAINT "MerchantSupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "support"."MerchantSupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantSupportMessage" ADD CONSTRAINT "MerchantSupportMessage_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
