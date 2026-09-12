import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260912100000_add_promotion_selection_and_grant_lots/migration.sql",
  "utf8",
);
const campaignMigration = await readFile(
  "prisma/migrations/20260912090000_add_promotion_campaign_catalogue/migration.sql",
  "utf8",
);
const grantMigration = await readFile(
  "prisma/migrations/20260911150000_add_promotional_credit_grants/migration.sql",
  "utf8",
);
const purchasedLotMigration = await readFile(
  "prisma/migrations/20260911130000_add_purchased_credit_lot_accounting/migration.sql",
  "utf8",
);

assert.match(
  schema,
  /model PromotionalCreditGrant\s*\{[\s\S]*?campaignId\s+String\?[\s\S]*?reservedQuantity\s+Int\s+@default\(0\)[\s\S]*?committedQuantity\s+Int\s+@default\(0\)[\s\S]*?firstSelectedAt\s+DateTime\?[\s\S]*?lastSelectedAt\s+DateTime\?[\s\S]*?selectionCount\s+Int\s+@default\(0\)[\s\S]*?firstUsedAt\s+DateTime\?[\s\S]*?lastUsedAt\s+DateTime\?[\s\S]*?exhaustedAt\s+DateTime\?[\s\S]*?version\s+Int\s+@default\(0\)/,
);
assert.match(schema, /model PromotionalCreditGrant\s*\{[\s\S]*?@@unique\(\[campaignId, shopId\]\)/);
assert.match(schema, /model PromotionalCreditGrant\s*\{[\s\S]*?@@index\(\[campaignId, createdAt\]\)/);
assert.match(
  schema,
  /model MerchantPromotionSelection\s*\{[\s\S]*?shopId\s+String\s+@unique[\s\S]*?promotionalCreditGrantId\s+String\s+@unique[\s\S]*?selectedAt\s+DateTime[\s\S]*?updatedAt\s+DateTime[\s\S]*?version\s+Int\s+@default\(0\)/,
);
assert.match(
  schema,
  /promotionalCreditGrant\s+PromotionalCreditGrant\s+@relation\(fields: \[promotionalCreditGrantId, shopId\], references: \[id, shopId\], onDelete: Restrict\)/,
);
assert.match(
  schema,
  /model UsageReservation\s*\{[\s\S]*?promotionalCreditGrantId\s+String\?[\s\S]*?promotionalCreditGrant\s+PromotionalCreditGrant\?/,
);
assert.match(schema, /@@index\(\[promotionalCreditGrantId, status\]\)/);
assert.match(schema, /model PromotionCampaign\s*\{[\s\S]*?promotionalCreditGrants\s+PromotionalCreditGrant\[\]/);
assert.match(schema, /model Shop\s*\{[\s\S]*?merchantPromotionSelection\s+MerchantPromotionSelection\?/);

assert.match(migration, /ADD COLUMN "campaignId" TEXT/);
assert.match(migration, /ADD COLUMN "promotionalCreditGrantId" TEXT/);
assert.match(grantMigration, /PromotionalCreditGrant_quantity_positive[\s\S]*?CHECK \("quantity" > 0\)/);
assert.match(migration, /PromotionalCreditGrant_campaignId_shopId_key/);
assert.match(migration, /PromotionalCreditGrant_campaignId_createdAt_idx[\s\S]*?\("campaignId", "createdAt"\)/);
assert.match(migration, /MerchantPromotionSelection_shopId_key/);
assert.match(migration, /MerchantPromotionSelection_promotionalCreditGrantId_key/);
assert.match(migration, /PromotionalCreditGrant_lot_quantities_non_negative/);
assert.match(migration, /"reservedQuantity" >= 0[\s\S]*?"committedQuantity" >= 0[\s\S]*?"selectionCount" >= 0/);
assert.match(migration, /PromotionalCreditGrant_lot_quantities_within_grant/);
assert.match(migration, /"reservedQuantity" \+ "committedQuantity" <= "quantity"/);
assert.match(migration, /UsageReservation_promotionalCreditGrantId_status_idx/);
assert.match(migration, /UsageReservation_promotionalCreditGrantId_fkey[\s\S]*?ON DELETE SET NULL/);
assert.match(migration, /MerchantPromotionSelection_promotionalCreditGrantId_shopId_fkey[\s\S]*?REFERENCES "billing"\."PromotionalCreditGrant"\("id", "shopId"\)[\s\S]*?ON DELETE RESTRICT/);
assert.match(migration, /MerchantPromotionSelection_version_non_negative/);
assert.match(migration, /PromotionalCreditGrant_campaignId_fkey[\s\S]*?PromotionCampaign/);
assert.match(campaignMigration, /CREATE TABLE "billing"\."PromotionCampaign"/);
assert.match(purchasedLotMigration, /UsageReservation_purchasedCreditPurchaseId_status_idx/);

assert.doesNotMatch(migration, /INSERT\s+INTO/i);
assert.doesNotMatch(migration, /UPDATE\s+"billing"/i);
assert.doesNotMatch(migration, /ShopEntitlementCounter|EntitlementCounter|BillingPeriod|Subscription/i);
assert.match(migration, /"campaignId" TEXT/);
assert.match(migration, /"promotionalCreditGrantId" TEXT/);

console.log("Promotion selection and grant-lot schema assertions passed.");
