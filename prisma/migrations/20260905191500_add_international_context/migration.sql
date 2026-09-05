-- CreateEnum
CREATE TYPE "whatsapp"."LanguageSource" AS ENUM ('CUSTOMER_EXPLICIT', 'DETECTED', 'SHOPIFY', 'MERCHANT_DEFAULT', 'PLATFORM_DEFAULT');

-- AlterTable
ALTER TABLE "shopify"."ShopSettings"
ADD COLUMN "defaultLanguageTag" TEXT,
ADD COLUMN "defaultTimeZone" TEXT,
ADD COLUMN "defaultCountryCode" TEXT;

-- AlterTable
ALTER TABLE "whatsapp"."Conversation"
ADD COLUMN "languageTag" TEXT,
ADD COLUMN "languageSource" "whatsapp"."LanguageSource",
ADD COLUMN "countryCode" TEXT,
ADD COLUMN "currencyCode" TEXT,
ADD COLUMN "timeZone" TEXT;
