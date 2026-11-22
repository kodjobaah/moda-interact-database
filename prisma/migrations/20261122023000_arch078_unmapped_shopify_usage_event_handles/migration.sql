ALTER TABLE "billing"."Subscription"
ADD COLUMN "unmappedShopifyUsageEventHandles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
