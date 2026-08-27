-- CreateEnum
CREATE TYPE "shopify"."WebhookDisposition" AS ENUM ('ACCEPTED', 'IGNORED', 'REJECTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "shopify"."WebhookOutboxDestination" AS ENUM ('CHECKOUT_EVENTS', 'ORDER_EVENTS');

-- CreateEnum
CREATE TYPE "shopify"."WebhookOutboxState" AS ENUM ('PENDING', 'PUBLISHED', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "shopify"."ShopifyWebhookReceipt" (
    "id" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventId" TEXT,
    "shopId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "apiVersion" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "triggeredAtRaw" TEXT,
    "subscriptionName" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disposition" "shopify"."WebhookDisposition" NOT NULL,
    "dispositionCode" TEXT,
    "rejectedPayload" JSONB,

    CONSTRAINT "ShopifyWebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify"."ShopifyWebhookOutbox" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "destination" "shopify"."WebhookOutboxDestination" NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "delayMs" INTEGER NOT NULL DEFAULT 0,
    "state" "shopify"."WebhookOutboxState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockToken" TEXT,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "exhaustedAt" TIMESTAMP(3),
    "lastErrorClass" TEXT,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "ShopifyWebhookOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyWebhookReceipt_shopDomain_receivedAt_idx" ON "shopify"."ShopifyWebhookReceipt"("shopDomain", "receivedAt");

-- CreateIndex
CREATE INDEX "ShopifyWebhookReceipt_eventId_idx" ON "shopify"."ShopifyWebhookReceipt"("eventId");

-- CreateIndex
CREATE INDEX "ShopifyWebhookReceipt_shopId_receivedAt_idx" ON "shopify"."ShopifyWebhookReceipt"("shopId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyWebhookReceipt_appKey_deliveryId_key" ON "shopify"."ShopifyWebhookReceipt"("appKey", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyWebhookOutbox_receiptId_key" ON "shopify"."ShopifyWebhookOutbox"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyWebhookOutbox_jobId_key" ON "shopify"."ShopifyWebhookOutbox"("jobId");

-- CreateIndex
CREATE INDEX "ShopifyWebhookOutbox_state_nextAttemptAt_lockedUntil_idx" ON "shopify"."ShopifyWebhookOutbox"("state", "nextAttemptAt", "lockedUntil");

-- AddForeignKey
ALTER TABLE "shopify"."ShopifyWebhookReceipt" ADD CONSTRAINT "ShopifyWebhookReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify"."ShopifyWebhookOutbox" ADD CONSTRAINT "ShopifyWebhookOutbox_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "shopify"."ShopifyWebhookReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreatePartialIndex
CREATE INDEX "ShopifyWebhookOutbox_due"
ON shopify."ShopifyWebhookOutbox"
  ("nextAttemptAt", "createdAt")
WHERE "state" = 'PENDING';
