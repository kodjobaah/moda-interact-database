CREATE TABLE "billing"."PromotionCampaignTranslation" (
    "id" TEXT NOT NULL,
    "promotionCampaignId" TEXT NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "merchantTitle" VARCHAR(255) NOT NULL,
    "merchantDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotionCampaignTranslation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromotionCampaignTranslation_promotionCampaignId_fkey"
      FOREIGN KEY ("promotionCampaignId")
      REFERENCES "billing"."PromotionCampaign"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ck_arch014_promotion_campaign_translation_locale" CHECK (
      "locale" IN ('cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant')
    ),
    CONSTRAINT "ck_arch014_promotion_campaign_translation_title" CHECK (
      char_length(btrim("merchantTitle")) BETWEEN 1 AND 255
    ),
    CONSTRAINT "ck_arch014_promotion_campaign_translation_description" CHECK (
      char_length(btrim("merchantDescription")) BETWEEN 1 AND 10000
    ),
    CONSTRAINT "uq_arch014_promotion_campaign_translation_locale" UNIQUE ("promotionCampaignId", "locale")
);

CREATE INDEX "PromotionCampaignTranslation_promotionCampaignId_idx"
  ON "billing"."PromotionCampaignTranslation"("promotionCampaignId");