CREATE SCHEMA IF NOT EXISTS "woocommerce";

CREATE TYPE "commerce"."ShopPlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE');

ALTER TABLE "commerce"."Shop"
  ADD COLUMN "platform" "commerce"."ShopPlatform" NOT NULL DEFAULT 'SHOPIFY',
  ADD COLUMN "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "commerce"."Shop" AS shop
SET "onboardingCompleted" = COALESCE(
  (
    SELECT settings."onboardingCompleted"
    FROM "shopify"."ShopSettings" AS settings
    WHERE settings."shopId" = shop."id"
  ),
  false
);

ALTER TABLE "commerce"."Shop"
  ADD CONSTRAINT "Shop_platform_shopify_id_check"
    CHECK ("platform" = 'SHOPIFY' OR "shopifyShopId" IS NULL);

CREATE INDEX "Shop_platform_status_idx"
  ON "commerce"."Shop"("platform", "status");

CREATE TYPE "woocommerce"."WooCommerceInstallationStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "woocommerce"."WooCommerceInstallation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "canonicalSiteUrl" VARCHAR(512) NOT NULL,
  "status" "woocommerce"."WooCommerceInstallationStatus" NOT NULL DEFAULT 'ACTIVE',
  "credentialDigest" BYTEA NOT NULL,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "credentialIssuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooCommerceInstallation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WooCommerceInstallation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooCommerceInstallation_canonical_site_url_check"
    CHECK (btrim("canonicalSiteUrl") <> ''),
  CONSTRAINT "WooCommerceInstallation_credential_digest_length_check"
    CHECK (octet_length("credentialDigest") = 32),
  CONSTRAINT "WooCommerceInstallation_credential_version_check"
    CHECK ("credentialVersion" > 0),
  CONSTRAINT "WooCommerceInstallation_status_revoked_at_check"
    CHECK (("status" = 'ACTIVE' AND "revokedAt" IS NULL)
      OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "WooCommerceInstallation_shopId_key"
  ON "woocommerce"."WooCommerceInstallation"("shopId");

CREATE UNIQUE INDEX "WooCommerceInstallation_canonicalSiteUrl_key"
  ON "woocommerce"."WooCommerceInstallation"("canonicalSiteUrl");

CREATE INDEX "WooCommerceInstallation_status_shopId_idx"
  ON "woocommerce"."WooCommerceInstallation"("status", "shopId");

CREATE OR REPLACE FUNCTION "woocommerce"."arch026_woocommerce_installation_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'WooCommerce installation id is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."shopId" IS DISTINCT FROM OLD."shopId" THEN
    RAISE EXCEPTION 'WooCommerce installation shopId is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "arch026_woocommerce_installation_guard"
  BEFORE UPDATE ON "woocommerce"."WooCommerceInstallation"
  FOR EACH ROW
  EXECUTE FUNCTION "woocommerce"."arch026_woocommerce_installation_guard"();