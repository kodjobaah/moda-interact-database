-- CreateEnum
CREATE TYPE "billing"."EntitlementCounter" AS ENUM ('FREE_RECOVERY_LIFETIME');

-- CreateEnum
CREATE TYPE "billing"."UsageReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "billing"."UsageMetric" AS ENUM ('RECOVERY_CONVERSATION', 'OUTBOUND_AUTOMATED_MESSAGE', 'DELIVERED_WHATSAPP_MESSAGE');

-- CreateEnum
CREATE TYPE "billing"."ShopifyReportState" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'IN_FLIGHT', 'RETRYABLE', 'REPORTED', 'NEEDS_ATTENTION');

-- AlterTable
ALTER TABLE "billing"."UsageEvent" DROP COLUMN "providerResponse",
ADD COLUMN     "correctionOfUsageEventId" TEXT,
ADD COLUMN     "lastReportAttemptAt" TIMESTAMP(3),
ADD COLUMN     "nextReportAt" TIMESTAMP(3),
ADD COLUMN     "providerErrorCode" VARCHAR(128),
ADD COLUMN     "providerResponseSummary" VARCHAR(2000),
ADD COLUMN     "reportAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shopifyEventHandle" TEXT,
ADD COLUMN     "shopifyIdempotencyKey" TEXT,
ADD COLUMN     "shopifyReportState" "billing"."ShopifyReportState" NOT NULL DEFAULT 'NOT_APPLICABLE',
DROP COLUMN "metric",
ADD COLUMN     "metric" "billing"."UsageMetric" NOT NULL;

-- CreateTable
CREATE TABLE "billing"."ShopEntitlementCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "counter" "billing"."EntitlementCounter" NOT NULL,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopEntitlementCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."UsageReservation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "billing"."UsageReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3),
    "committedUsageEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopEntitlementCounter_shopId_idx" ON "billing"."ShopEntitlementCounter"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopEntitlementCounter_shopId_counter_key" ON "billing"."ShopEntitlementCounter"("shopId", "counter");

-- CreateIndex
CREATE UNIQUE INDEX "UsageReservation_sourceKey_key" ON "billing"."UsageReservation"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageReservation_committedUsageEventId_key" ON "billing"."UsageReservation"("committedUsageEventId");

-- CreateIndex
CREATE INDEX "UsageReservation_shopId_status_idx" ON "billing"."UsageReservation"("shopId", "status");

-- CreateIndex
CREATE INDEX "UsageReservation_status_expiresAt_idx" ON "billing"."UsageReservation"("status", "expiresAt");

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

-- AddForeignKey
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_correctionOfUsageEventId_fkey" FOREIGN KEY ("correctionOfUsageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."ShopEntitlementCounter" ADD CONSTRAINT "ShopEntitlementCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_counterId_fkey" FOREIGN KEY ("counterId") REFERENCES "billing"."ShopEntitlementCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."UsageReservation" ADD CONSTRAINT "UsageReservation_committedUsageEventId_fkey" FOREIGN KEY ("committedUsageEventId") REFERENCES "billing"."UsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
