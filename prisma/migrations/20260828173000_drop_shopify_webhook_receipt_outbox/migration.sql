-- DropForeignKey
ALTER TABLE "shopify"."ShopifyWebhookOutbox" DROP CONSTRAINT IF EXISTS "ShopifyWebhookOutbox_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "shopify"."ShopifyWebhookReceipt" DROP CONSTRAINT IF EXISTS "ShopifyWebhookReceipt_shopId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookReceipt_shopDomain_receivedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookReceipt_eventId_idx";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookReceipt_shopId_receivedAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookReceipt_appKey_deliveryId_key";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookOutbox_receiptId_key";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookOutbox_jobId_key";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookOutbox_state_nextAttemptAt_lockedUntil_idx";

-- DropIndex
DROP INDEX IF EXISTS "shopify"."ShopifyWebhookOutbox_due";

-- DropTable
DROP TABLE IF EXISTS "shopify"."ShopifyWebhookOutbox";

-- DropTable
DROP TABLE IF EXISTS "shopify"."ShopifyWebhookReceipt";

-- DropEnum
DROP TYPE IF EXISTS "shopify"."WebhookOutboxState";

-- DropEnum
DROP TYPE IF EXISTS "shopify"."WebhookOutboxDestination";

-- DropEnum
DROP TYPE IF EXISTS "shopify"."WebhookDisposition";
