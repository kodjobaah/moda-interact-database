-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "commerce";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "whatsapp";

-- CreateEnum
CREATE TYPE "commerce"."CheckoutRecoveryStatus" AS ENUM ('DETECTED', 'MESSAGE_SENT', 'ENGAGED', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "whatsapp"."ConversationType" AS ENUM ('RECOVERY', 'PRODUCT_DISCOVERY', 'PRODUCT_SUPPORT', 'POST_PURCHASE');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageSenderType" AS ENUM ('CUSTOMER', 'AGENT', 'AUTOMATION', 'HUMAN');

-- CreateEnum
CREATE TYPE "whatsapp"."MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "commerce"."Customer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "shopifyCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CheckoutRecovery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "checkoutToken" TEXT NOT NULL,
    "cartToken" TEXT,
    "customerId" TEXT,
    "status" "commerce"."CheckoutRecoveryStatus" NOT NULL DEFAULT 'DETECTED',
    "currency" TEXT,
    "totalPrice" DECIMAL(65,30),
    "checkoutUrl" TEXT,
    "lineItems" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageSentAt" TIMESTAMP(3),
    "engagedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."Conversation" (
    "id" TEXT NOT NULL,
    "checkoutRecoveryId" TEXT NOT NULL,
    "type" "whatsapp"."ConversationType" NOT NULL,
    "inboundVersion" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedVersion" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "inReplyToProviderId" TEXT,
    "direction" "whatsapp"."MessageDirection" NOT NULL,
    "senderType" "whatsapp"."MessageSenderType" NOT NULL,
    "status" "whatsapp"."MessageStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_shop_idx" ON "commerce"."Customer"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shop_phone_key" ON "commerce"."Customer"("shop", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shop_shopifyCustomerId_key" ON "commerce"."Customer"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CheckoutRecovery_customerId_idx" ON "commerce"."CheckoutRecovery"("customerId");

-- CreateIndex
CREATE INDEX "CheckoutRecovery_shop_status_idx" ON "commerce"."CheckoutRecovery"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutRecovery_shop_checkoutToken_key" ON "commerce"."CheckoutRecovery"("shop", "checkoutToken");

-- CreateIndex
CREATE INDEX "Conversation_checkoutRecoveryId_idx" ON "whatsapp"."Conversation"("checkoutRecoveryId");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "whatsapp"."Conversation"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_checkoutRecoveryId_type_key" ON "whatsapp"."Conversation"("checkoutRecoveryId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_providerMessageId_key" ON "whatsapp"."ConversationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "whatsapp"."ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_inReplyToProviderId_idx" ON "whatsapp"."ConversationMessage"("inReplyToProviderId");

-- AddForeignKey
ALTER TABLE "commerce"."CheckoutRecovery" ADD CONSTRAINT "CheckoutRecovery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "commerce"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."Conversation" ADD CONSTRAINT "Conversation_checkoutRecoveryId_fkey" FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
