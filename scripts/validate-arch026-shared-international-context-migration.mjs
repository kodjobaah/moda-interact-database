import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration = readFileSync(new URL('../prisma/migrations/20261003140000_arch026_shared_international_context/migration.sql', import.meta.url), 'utf8');

assert.match(migration, /ALTER TABLE "commerce"\."Shop"[\s\S]*?ADD COLUMN "storeLocale" VARCHAR\(128\)[\s\S]*?ADD COLUMN "defaultLanguageTag" VARCHAR\(64\)[\s\S]*?ADD COLUMN "defaultTimeZone" VARCHAR\(255\)[\s\S]*?ADD COLUMN "defaultCountryCode" VARCHAR\(2\)/);
assert.match(migration, /UPDATE "commerce"\."Shop" AS shop[\s\S]*?SET "defaultLanguageTag" = settings\."defaultLanguageTag",\s*"defaultTimeZone" = settings\."defaultTimeZone",\s*"defaultCountryCode" = settings\."defaultCountryCode"[\s\S]*?FROM "shopify"\."ShopSettings" AS settings[\s\S]*?WHERE settings\."shopId" = shop\."id"/);
assert.doesNotMatch(migration, /SET[\s\S]*?"storeLocale"\s*=/, 'Historical provider-native store locale must remain NULL');
assert.match(migration, /ADD CONSTRAINT "Shop_default_country_code_check"\s+CHECK \("defaultCountryCode" IS NULL OR "defaultCountryCode" ~ '\^\[A-Z\]\{2\}\$'\)/);
assert.doesNotMatch(migration, /CREATE\s+(?:TYPE|ENUM)|ALTER TABLE "shopify"\."ShopSettings"|DROP\s+(?:COLUMN|TABLE|SCHEMA)/i,
  'Migration must not add a closed locale type, rewrite legacy settings, or remove existing state');
assert.doesNotMatch(migration, /ALTER TABLE "(?:billing|whatsapp|support|public)"|CREATE\s+(?:TABLE|TYPE) "(?:billing|whatsapp|support|public)"/i,
  'Migration may only modify shared commerce.Shop using legacy Shopify values as a read source');

console.log('ARCH-026 shared international-context migration checks passed.');