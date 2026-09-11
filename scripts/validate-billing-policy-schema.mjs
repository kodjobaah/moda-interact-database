import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260911121000_move_lifetime_free_grant_to_platform_policy/migration.sql",
  "utf8",
);
const seed = await readFile("prisma/seed.mjs", "utf8");

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
assert.doesNotMatch(migration, /BillingPlan|billingPlan|planId|planKind|PAID_METERED/);

console.log("Billing policy schema assertions passed.");