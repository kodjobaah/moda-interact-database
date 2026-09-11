import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260911121000_move_lifetime_free_grant_to_platform_policy/migration.sql",
  "utf8",
);
const seed = await readFile("prisma/seed.mjs", "utf8");
const promotionalMigration = await readFile(
  "prisma/migrations/20260911150000_add_promotional_credit_grants/migration.sql",
  "utf8",
);

assert.match(schema, /model PlatformBillingPolicy\s*\{[\s\S]*?lifetimeFreeRecoveryAllowance\s+Int\s+@default\(5\)/);
assert.match(schema, /model BillingPlan\s*\{[\s\S]*?freeLifetimeConversationAllowance\s+Int\?/);
assert.match(migration, /PlatformBillingPolicy_lifetimeFreeRecoveryAllowance_non_negative[\s\S]*?CHECK \("lifetimeFreeRecoveryAllowance" >= 0\)/);
assert.match(seed, /platformBillingPolicy\.upsert/);
assert.match(seed, /lifetimeFreeRecoveryAllowance:\s*5/);

assert.match(migration, /settings\."onboardingCompleted" = true/);
assert.match(migration, /counter\."counter" = 'FREE_RECOVERY_LIFETIME'/);
assert.match(migration, /'lifetime-free:' \|\| shop\."id"/);
assert.match(migration, /counter\."id" IS NULL/);
assert.match(migration, /counter\."grantedQuantity" = 0/);
assert.match(migration, /"committedQuantity",\s*"reservedQuantity",\s*"refundingQuantity",\s*"version"/);
assert.match(migration, /INSERT INTO[\s\S]*?\n\s*5,\n\s*0,\n\s*0,\n\s*0,\n\s*0,/);
assert.match(migration, /ON CONFLICT \("shopId", "counter"\) DO NOTHING/);
assert.doesNotMatch(migration, /BillingPeriod|billingPeriod/i);
assert.match(migration, /"version" = counter\."version" \+ 1/);

const existingCounterUpdate = migration.match(
  /UPDATE "billing"\."ShopEntitlementCounter"[\s\S]*$/,
)?.[0] ?? "";
assert.match(existingCounterUpdate, /"grantedQuantity" = 5/);
assert.match(existingCounterUpdate, /counter\."grantedQuantity" = 0/);
assert.doesNotMatch(existingCounterUpdate, /"committedQuantity"\s*=|"reservedQuantity"\s*=|"refundingQuantity"\s*=/);
assert.doesNotMatch(
  migration,
  /BillingPlan|billingPlan|planId|planKind|planHandle|settings\."plan"|PAID_METERED/,
);

assert.match(schema, /enum EntitlementCounter\s*\{[\s\S]*PROMOTIONAL_RECOVERY_CREDITS/);
assert.match(schema, /enum EntitlementCounter\s*\{[\s\S]*FREE_RECOVERY_LIFETIME[\s\S]*PURCHASED_RECOVERY_CREDITS[\s\S]*PROMOTIONAL_RECOVERY_CREDITS/);
assert.match(schema, /enum BillingAuditAction\s*\{[\s\S]*PROMOTIONAL_CREDITS_GRANTED/);
assert.match(schema, /enum PromotionalCreditGrantType\s*\{[\s\S]*CAMPAIGN[\s\S]*BETA_TESTER[\s\S]*GOODWILL[\s\S]*SUPPORT[\s\S]*INTERNAL_TEST[\s\S]*OTHER/);
assert.match(schema, /model PromotionalCreditGrant\s*\{[\s\S]*quantity\s+Int[\s\S]*reason\s+String\s+@db\.VarChar\(1000\)[\s\S]*campaignReference\s+String\?[\s\S]*requestKey\s+String\s+@unique[\s\S]*platformAdminId\s+String/);
assert.match(schema, /promotionalCreditGrants\s+PromotionalCreditGrant\[\]/);
assert.match(promotionalMigration, /CREATE TYPE "billing"\."PromotionalCreditGrantType"/);
assert.match(promotionalMigration, /ALTER TYPE "billing"\."EntitlementCounter" ADD VALUE 'PROMOTIONAL_RECOVERY_CREDITS'/);
assert.match(promotionalMigration, /ALTER TYPE "billing"\."BillingAuditAction" ADD VALUE 'PROMOTIONAL_CREDITS_GRANTED'/);
assert.match(promotionalMigration, /CREATE TABLE "billing"\."PromotionalCreditGrant"/);
assert.match(promotionalMigration, /PromotionalCreditGrant_quantity_positive/);
assert.match(promotionalMigration, /PromotionalCreditGrant_requestKey_key/);
assert.match(promotionalMigration, /PromotionalCreditGrant_shopId_createdAt_idx/);
assert.match(promotionalMigration, /PromotionalCreditGrant_campaignReference_createdAt_idx/);
assert.match(promotionalMigration, /PromotionalCreditGrant_platformAdminId_createdAt_idx/);
assert.doesNotMatch(promotionalMigration, /INSERT INTO/);
assert.doesNotMatch(promotionalMigration, /BillingAllowanceAdjustment|FREE_RECOVERY_LIFETIME|PURCHASED_RECOVERY_CREDITS|BillingPeriod|Subscription/);

console.log("Billing policy schema assertions passed.");