import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261002090000_arch026_woocommerce_installation_identity/migration.sql');
const erd = read('docs/generated/prisma-erd.puml');
const block = (source, kind, name) => source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const model = name => block(schema, 'model', name);
const enumBody = name => block(schema, 'enum', name);
const requireFields = (body, fields, owner) => {
  assert.ok(body, `${owner} missing`);
  for (const field of fields) assert.match(body, new RegExp(`^\\s*${field}\\s`, 'm'), `${owner}.${field} missing`);
};

assert.match(schema, /schemas\s*=\s*\[[^\]]*"woocommerce"/);
assert.match(enumBody('ShopPlatform'), /^\s*SHOPIFY\s+WOOCOMMERCE\s+@@schema\("commerce"\)\s*$/);
assert.match(enumBody('WooCommerceInstallationStatus'), /^\s*ACTIVE\s+REVOKED\s+@@schema\("woocommerce"\)\s*$/);
const shop = model('Shop');
requireFields(shop, ['platform', 'onboardingCompleted', 'wooCommerceInstallation'], 'Shop');
assert.match(shop, /platform\s+ShopPlatform\s+@default\(SHOPIFY\)/);
assert.match(shop, /onboardingCompleted\s+Boolean\s+@default\(false\)/);
assert.match(shop, /@@index\(\[platform, status\], map: "Shop_platform_status_idx"\)/);
assert.match(model('ShopSettings'), /onboardingCompleted\s+Boolean\s+@default\(false\)/, 'legacy Shopify onboarding field must remain');

const installation = model('WooCommerceInstallation');
requireFields(installation, [
  'id', 'shopId', 'shop', 'canonicalSiteUrl', 'status', 'credentialDigest', 'credentialVersion',
  'credentialIssuedAt', 'revokedAt', 'createdAt', 'updatedAt',
], 'WooCommerceInstallation');
for (const field of [
  /id\s+String\s+@id\s+@default\(cuid\(\)\)\s+@db\.Text/,
  /shopId\s+String\s+@unique(?:\([^\n]*\))?\s+@db\.Text/,
  /shop\s+Shop\s+@relation\(fields: \[shopId\], references: \[id\], onDelete: Cascade, onUpdate: Restrict\)/,
  /canonicalSiteUrl\s+String\s+@unique(?:\([^\n]*\))?\s+@db\.VarChar\(512\)/,
  /status\s+WooCommerceInstallationStatus\s+@default\(ACTIVE\)/,
  /credentialDigest\s+Bytes/,
  /credentialVersion\s+Int\s+@default\(1\)/,
  /credentialIssuedAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/,
  /revokedAt\s+DateTime\?/,
  /@@index\(\[status, shopId\], map: "WooCommerceInstallation_status_shopId_idx"\)/,
  /@@schema\("woocommerce"\)/,
]) assert.match(installation, field, `WooCommerceInstallation missing shape ${field}`);
assert.doesNotMatch(installation, /credential(?:Secret)?\s+String|\b(secret|accessToken|bearerToken|apiToken)\s+String/i,
  'Woo installation must not persist raw credentials');

assert.match(migration, /CREATE SCHEMA IF NOT EXISTS "woocommerce"/);
assert.match(migration, /UPDATE "commerce"\."Shop" AS shop[\s\S]*?COALESCE\([\s\S]*?settings\."onboardingCompleted"[\s\S]*?false/s);
assert.match(migration, /CREATE TYPE "commerce"\."ShopPlatform" AS ENUM \('SHOPIFY', 'WOOCOMMERCE'\)/);
assert.match(migration, /ADD CONSTRAINT "Shop_platform_shopify_id_check"[\s\S]*?"platform" = 'SHOPIFY' OR "shopifyShopId" IS NULL/);
assert.match(migration, /CREATE INDEX "Shop_platform_status_idx"[\s\S]*?"platform", "status"/);
assert.match(migration, /CREATE TYPE "woocommerce"\."WooCommerceInstallationStatus" AS ENUM \('ACTIVE', 'REVOKED'\)/);
assert.match(migration, /CREATE TABLE "woocommerce"\."WooCommerceInstallation"/);
assert.match(migration, /"updatedAt" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
for (const name of [
  'WooCommerceInstallation_shopId_key', 'WooCommerceInstallation_canonicalSiteUrl_key',
  'WooCommerceInstallation_canonical_site_url_check', 'WooCommerceInstallation_credential_digest_length_check',
  'WooCommerceInstallation_credential_version_check', 'WooCommerceInstallation_status_revoked_at_check',
  'WooCommerceInstallation_status_shopId_idx', 'WooCommerceInstallation_shopId_fkey',
  'arch026_woocommerce_installation_guard',
]) assert.ok(migration.includes(name), `${name} missing from migration`);
assert.match(migration, /CREATE OR REPLACE FUNCTION "woocommerce"\."arch026_woocommerce_installation_guard"\(\)/);
assert.match(migration, /NEW\."id" IS DISTINCT FROM OLD\."id"/);
assert.match(migration, /NEW\."shopId" IS DISTINCT FROM OLD\."shopId"/);
assert.match(migration, /ON DELETE CASCADE ON UPDATE RESTRICT/);
assert.doesNotMatch(migration, /CREATE (?:TABLE|TYPE|FUNCTION) "commerce"\."(?:WooCommerceInstallation|WooCommerceInstallationStatus|arch026_woocommerce_installation_guard)/);
assert.doesNotMatch(migration, /INSERT INTO "(?:commerce|woocommerce)"\."(?:Shop|WooCommerceInstallation)"/);
assert.doesNotMatch(migration, /ALTER TABLE "(?:billing|shopify|whatsapp|support|public)"|CREATE (?:TABLE|TYPE|FUNCTION) "(?:billing|shopify|whatsapp|support|public)"/);
const erdInstallation = erd.match(/entity "WooCommerceInstallation" as \w+ \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.doesNotMatch(`${installation}\n${migration}\n${erdInstallation}`,
  /\b(?:credentialSecret|credential\s+String|secret\s+String|accessToken\s+(?:String|TEXT)|bearerToken|apiToken)\b/i,
  'raw credential column must not appear in the Woo installation contract');
assert.ok(erdInstallation, 'WooCommerceInstallation missing from generated ERD');
const erdShop = erd.match(/entity "Shop" as \w+ \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(erdShop, /platform\s*:\s*ShopPlatform/);

console.log('ARCH-026 WooCommerce installation static schema, migration and ERD checks passed.');