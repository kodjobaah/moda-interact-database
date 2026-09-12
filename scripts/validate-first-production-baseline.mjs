import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260912000000_arch010_first_production_baseline/migration.sql",
  "utf8",
);
const seed = await readFile("prisma/seed.mjs", "utf8");

const model = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[1];
};

const enumBlock = (name) => {
  const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing enum ${name}`);
  return match[1];
};

const policy = model("PlatformBillingPolicy");
assert.match(policy, /lifetimeFreeRecoveryAllowance\s+Int\s+@default\(5\)/);
assert.match(policy, /minimumUpgradePremiumBps\s+Int\s+@default\(2000\)/);

assert.match(enumBlock("EntitlementCounter"), /LIFETIME_FREE_RECOVERY_CREDITS/);
assert.match(enumBlock("EntitlementCounter"), /PURCHASED_RECOVERY_CREDITS/);
assert.doesNotMatch(enumBlock("EntitlementCounter"), /PROMOTIONAL/);
assert.match(enumBlock("RecoveryCreditPurchaseStatus"), /PENDING_BILLING/);
assert.deepEqual(
  enumBlock("RecoveryCreditRefundStatus")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line)),
  ["REQUESTED", "PROVIDER_ACTION_REQUIRED", "COMPLETED", "REJECTED", "WITHDRAWN", "NEEDS_ATTENTION"],
);

const grant = model("PromotionalCreditGrant");
assert.match(grant, /campaignId\s+String\n/);
assert.match(grant, /@@unique\(\[campaignId, shopId\]\)/);
assert.match(model("MerchantPromotionSelection"), /shopId\s+String\s+@unique/);
assert.match(model("UsageReservation"), /promotionalCreditGrantId\s+String\?/);

assert.match(model("BillingUpgradeEconomicsEdge"), /@@unique\(\[lowerPlanId\]\)/);
assert.match(model("BillingUpgradeEconomicsEdge"), /@@unique\(\[higherPlanId\]\)/);
assert.match(model("BillingEconomicsSnapshot"), /monthlyRecurringAmountMinor\s+Int/);
assert.match(model("BillingEconomicsSnapshot"), /currency\s+String\s+@db\.Char\(3\)/);
assert.match(enumBlock("BillingAuditAction"), /UPGRADE_ECONOMICS_EVALUATED/);

assert.match(migration, /CREATE TABLE "billing"\."BillingUpgradeEconomicsEdge"/);
assert.match(migration, /CREATE TABLE "billing"\."BillingEconomicsSnapshot"/);
assert.match(migration, /minimumUpgradePremiumBps/);
assert.match(migration, /minimumUpgradePremiumBps_check/);
assert.match(migration, /distinctPlans_check/);
assert.match(migration, /quantityAccounting_check/);
assert.doesNotMatch(migration, /^UPDATE\s+/im);
assert.doesNotMatch(migration, /^INSERT\s+INTO/i);
assert.match(seed, /minimumUpgradePremiumBps: 2000/);

console.log("First-production baseline invariants passed.");
