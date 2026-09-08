import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260908081322_add_repeatable_recovery_credit_packs/migration.sql",
  "utf8",
);
const purchaseModel = schema.match(/model RecoveryCreditPurchase\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

assert.match(schema, /PURCHASED_RECOVERY_CREDITS/);
assert.match(schema, /RECOVERY_CREDIT_PACK_PURCHASE/);
assert.match(schema, /enum RecoveryCreditPurchaseStatus[\s\S]*?PENDING_BILLING[\s\S]*?ACTIVE[\s\S]*?NEEDS_ATTENTION[\s\S]*?CANCELLED/);
assert.match(schema, /includedRecoveryConversationAllowance\s+Int\?/);
assert.match(schema, /recoveryCreditPackEnabled\s+Boolean\s+@default\(false\)/);
assert.match(schema, /recoveryCreditsPerPack\s+Int\?/);
assert.match(schema, /shopifyRecoveryCreditPackEventHandle\s+String\?/);
assert.match(schema, /grantedQuantity\s+Int\s+@default\(0\)/);
assert.match(schema, /model RecoveryCreditPurchase\s*\{/);
assert.match(schema, /id String @id[\s\S]*?creditsGranted\s+Int/);
assert.match(schema, /usageEventId String\s+@unique/);
assert.match(schema, /recoveryCreditPurchases RecoveryCreditPurchase\[\]/);
assert.match(schema, /recoveryCreditPurchase RecoveryCreditPurchase\?/);
assert.match(schema, /enum EntitlementCounter[\s\S]*?FREE_RECOVERY_LIFETIME[\s\S]*?PURCHASED_RECOVERY_CREDITS/);
assert.match(schema, /model ShopEntitlementCounter\s*\{[\s\S]*?grantedQuantity\s+Int\s+@default\(0\)/);
assert.match(purchaseModel, /id String @id/);
assert.match(purchaseModel, /shopId String[\s\S]*?@@index\(\[shopId, status, createdAt\]\)/);
assert.doesNotMatch(purchaseModel, /price|currency/i);
assert.match(schema, /model BillingPlan\s*\{[\s\S]*?shopifyUsageEventHandle\s+String\?[\s\S]*?shopifyRecoveryCreditPackEventHandle\s+String\?/);
assert.match(schema, /freeLifetimeConversationAllowance\s+Int\?/);
assert.match(schema, /recoveryCreditPackEnabled\s+Boolean\s+@default\(false\)[\s\S]*?recoveryCreditsPerPack\s+Int\?/);

assert.match(migration, /CREATE UNIQUE INDEX "RecoveryCreditPurchase_usageEventId_key"/);
assert.match(migration, /CONSTRAINT "RecoveryCreditPurchase_pkey" PRIMARY KEY \("id"\)/);
assert.doesNotMatch(migration, /UNIQUE INDEX [^\n]*RecoveryCreditPurchase[^\n]*shopId/);
assert.match(migration, /CONSTRAINT "RecoveryCreditPurchase_creditsGranted_positive"[\s\S]*?"creditsGranted" > 0/);
assert.match(
  migration,
  /ADD CONSTRAINT "BillingPlan_recovery_credit_pack_config"[\s\S]*?NOT "recoveryCreditPackEnabled"\s+OR\s+\("recoveryCreditsPerPack" IS NOT NULL AND "recoveryCreditsPerPack" > 0\)/,
);
assert.match(migration, /NULLIF\(BTRIM\("shopifyRecoveryCreditPackEventHandle"\), ''\) IS NOT NULL/);
assert.match(migration, /"kind" = 'PAID_METERED'[\s\S]*?"includedRecoveryConversationAllowance" IS NOT NULL[\s\S]*?"includedRecoveryConversationAllowance" >= 0/);
assert.match(migration, /"shopifyUsageEventHandle" IS NULL OR "shopifyRecoveryCreditPackEventHandle" IS NULL/);
assert.match(migration, /"shopifyUsageEventHandle" <> "shopifyRecoveryCreditPackEventHandle"/);

console.log("Recovery credit pack schema assertions passed.");