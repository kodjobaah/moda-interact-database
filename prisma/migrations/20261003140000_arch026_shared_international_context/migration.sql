ALTER TABLE "commerce"."Shop"
  ADD COLUMN "storeLocale" VARCHAR(128),
  ADD COLUMN "defaultLanguageTag" VARCHAR(64),
  ADD COLUMN "defaultTimeZone" VARCHAR(255),
  ADD COLUMN "defaultCountryCode" VARCHAR(2);

UPDATE "commerce"."Shop" AS shop
SET "defaultLanguageTag" = settings."defaultLanguageTag",
    "defaultTimeZone" = settings."defaultTimeZone",
    "defaultCountryCode" = settings."defaultCountryCode"
FROM "shopify"."ShopSettings" AS settings
WHERE settings."shopId" = shop."id";

ALTER TABLE "commerce"."Shop"
  ADD CONSTRAINT "Shop_default_country_code_check"
    CHECK ("defaultCountryCode" IS NULL OR ("defaultCountryCode" COLLATE "C") ~ '^[A-Z]{2}$');