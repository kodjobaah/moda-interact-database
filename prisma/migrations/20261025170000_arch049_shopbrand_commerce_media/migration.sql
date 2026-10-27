-- ARCH-049-DATABASE-001: move the existing ShopBrand relation without rebuilding it.
-- The table OID, primary key, unique shopId index, foreign key and existing rows
-- survive SET SCHEMA. Existing and newly inserted rows default to empty media.
BEGIN;

ALTER TABLE "shopify"."ShopBrand" SET SCHEMA "commerce";

ALTER TABLE "commerce"."ShopBrand"
  ADD COLUMN "whatsAppMedia" JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
