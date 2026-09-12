-- Extend promotional grants with campaign ownership and durable lot lifecycle accounting.
ALTER TABLE "billing"."PromotionalCreditGrant"
ADD COLUMN "campaignId" TEXT,
ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "committedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "firstSelectedAt" TIMESTAMP(3),
ADD COLUMN "lastSelectedAt" TIMESTAMP(3),
ADD COLUMN "selectionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "firstUsedAt" TIMESTAMP(3),
ADD COLUMN "lastUsedAt" TIMESTAMP(3),
ADD COLUMN "exhaustedAt" TIMESTAMP(3),
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "billing"."PromotionalCreditGrant"
ADD CONSTRAINT "PromotionalCreditGrant_lot_quantities_non_negative"
CHECK (
  "reservedQuantity" >= 0
  AND "committedQuantity" >= 0
  AND "selectionCount" >= 0
  AND "version" >= 0
),
ADD CONSTRAINT "PromotionalCreditGrant_lot_quantities_within_grant"
CHECK ("reservedQuantity" + "committedQuantity" <= "quantity");

CREATE UNIQUE INDEX "PromotionalCreditGrant_campaignId_shopId_key"
ON "billing"."PromotionalCreditGrant"("campaignId", "shopId");
CREATE UNIQUE INDEX "PromotionalCreditGrant_id_shopId_key"
ON "billing"."PromotionalCreditGrant"("id", "shopId");
CREATE INDEX "PromotionalCreditGrant_campaignId_createdAt_idx"
ON "billing"."PromotionalCreditGrant"("campaignId", "createdAt");

ALTER TABLE "billing"."PromotionalCreditGrant"
ADD CONSTRAINT "PromotionalCreditGrant_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "billing"."PromotionCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve pre-existing reservations with NULL promotional ownership.
ALTER TABLE "billing"."UsageReservation"
ADD COLUMN "promotionalCreditGrantId" TEXT;

CREATE INDEX "UsageReservation_promotionalCreditGrantId_status_idx"
ON "billing"."UsageReservation"("promotionalCreditGrantId", "status");

ALTER TABLE "billing"."UsageReservation"
ADD CONSTRAINT "UsageReservation_promotionalCreditGrantId_fkey"
FOREIGN KEY ("promotionalCreditGrantId") REFERENCES "billing"."PromotionalCreditGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "billing"."MerchantPromotionSelection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "promotionalCreditGrantId" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MerchantPromotionSelection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantPromotionSelection_shopId_key"
ON "billing"."MerchantPromotionSelection"("shopId");
CREATE UNIQUE INDEX "MerchantPromotionSelection_promotionalCreditGrantId_key"
ON "billing"."MerchantPromotionSelection"("promotionalCreditGrantId");
CREATE UNIQUE INDEX "MerchantPromotionSelection_promotionalCreditGrantId_shopId_key"
ON "billing"."MerchantPromotionSelection"("promotionalCreditGrantId", "shopId");

ALTER TABLE "billing"."MerchantPromotionSelection"
ADD CONSTRAINT "MerchantPromotionSelection_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."MerchantPromotionSelection"
ADD CONSTRAINT "MerchantPromotionSelection_promotionalCreditGrantId_shopId_fkey"
FOREIGN KEY ("promotionalCreditGrantId", "shopId")
REFERENCES "billing"."PromotionalCreditGrant"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing"."MerchantPromotionSelection"
ADD CONSTRAINT "MerchantPromotionSelection_version_non_negative"
CHECK ("version" >= 0);
