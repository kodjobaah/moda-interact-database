import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260912000000_arch010_first_production_baseline/migration.sql",
  "utf8",
);
const seed = await readFile("prisma/seed.mjs", "utf8");
const erd = await readFile("docs/generated/prisma-erd.puml", "utf8");

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
assert.match(model("BillingEconomicsSnapshot"), /@@index\(\[billingPlanId, verifiedAt\]\)/);
assert.match(model("BillingEconomicsSnapshot"), /@@index\(\[verifiedByPlatformAdminId, verifiedAt\]\)/);
assert.doesNotMatch(model("BillingEconomicsSnapshot"), /\bupdatedAt\b/);
assert.match(enumBlock("BillingAuditAction"), /UPGRADE_ECONOMICS_EVALUATED/);

assert.match(migration, /CREATE TABLE "billing"\."BillingUpgradeEconomicsEdge"/);
assert.match(migration, /CREATE TABLE "billing"\."BillingEconomicsSnapshot"/);
assert.match(migration, /minimumUpgradePremiumBps/);
assert.match(migration, /minimumUpgradePremiumBps_check/);
assert.match(migration, /distinctPlans_check/);
assert.match(migration, /quantityAccounting_check/);
assert.match(migration, /BillingEconomicsSnapshot_billingPlanId_verifiedAt_idx/);
assert.match(migration, /BillingEconomicsSnapshot_verifiedByPlatformAdminId_verified_idx/);
assert.match(migration, /BillingEconomicsSnapshot_currency_normalized/);

for (const constraint of [
  "Conversation_standalone_scope_invariant",
  "BillingPlan_recovery_credit_pack_config",
  "RecoveryCreditPurchase_creditsGranted_positive",
  "CheckoutRecovery_admission_block_pair",
  "PlatformBillingPolicy_lifetimeFreeRecoveryAllowance_non_negative",
  "RecoveryCreditPurchase_lot_quantities_non_negative",
  "RecoveryCreditPurchase_lot_quantities_within_grant",
  "RecoveryCreditRefund_quantities_positive",
  "BillingPeriodEntitlementCounter_grantedQuantity_non_negative",
  "BillingPeriodEntitlementCounter_committedQuantity_non_negative",
  "BillingPeriodEntitlementCounter_reservedQuantity_non_negative",
  "BillingPeriodEntitlementCounter_forfeitedQuantity_non_negative",
  "BillingPeriodEntitlementCounter_capacity",
  "BillingPeriod_period_boundary",
  "BillingPeriod_included_recovery_credits_non_negative",
  "BillingPeriod_open_close_metadata_empty",
  "PromotionCampaign_quantity_positive",
  "PromotionCampaign_expiry_after_start",
  "PromotionCampaign_scope_target_shape",
  "MerchantPromotionSelection_version_non_negative",
  "PromotionalCreditGrant_nonnegativeVersion_check",
]) {
  assert.match(migration, new RegExp(constraint), `missing baseline constraint ${constraint}`);
}

assert.match(
  migration,
  /UsageReservation_capacity_source_shape[\s\S]*counterId[\s\S]*billingPeriodEntitlementCounterId[\s\S]*purchasedCreditPurchaseId[\s\S]*promotionalCreditGrantId/,
);
assert.doesNotMatch(migration, /UsageReservation_counter_family_xor/);

assert.doesNotMatch(model("RecoveryCreditRefund"), /settlementMode|correctionUsageEventId|attemptCount|nextAttemptAt|lastAttemptAt|processingStartedAt|providerErrorCode|providerResponseSummary/);
assert.doesNotMatch(grant, /grantType|campaignReference|platformAdminId/);
assert.doesNotMatch(schema, /SubscriptionCancellationRequest|SubscriptionCancellationMode|SubscriptionCancellationStatus/);
assert.match(enumBlock("EntitlementCounter"), /LIFETIME_FREE_RECOVERY_CREDITS/);
assert.doesNotMatch(enumBlock("EntitlementCounter"), /FREE_RECOVERY_LIFETIME|PROMOTIONAL_RECOVERY_CREDITS/);
assert.doesNotMatch(policy, /freeLifetimeConversationAllowance/);

for (const removedName of [
  "freeLifetimeConversationAllowance",
  "BillingAllowanceAdjustment",
  "FREE_RECOVERY_LIFETIME",
  "MIGRATION_RECONCILED",
  "SubscriptionCancellationRequest",
  "SubscriptionCancellationMode",
  "SubscriptionCancellationStatus",
  "CURRENT_CYCLE_APP_EVENT_CORRECTION",
  "PROMOTIONAL_RECOVERY_CREDITS",
  "PromotionalCreditGrantType",
]) {
  const removedNamePattern = new RegExp(removedName);
  for (const [label, content] of [["schema", schema], ["migration", migration], ["seed", seed], ["erd", erd]]) {
    assert.doesNotMatch(content, removedNamePattern, `${removedName} remains in ${label}`);
  }
}

assert.doesNotMatch(migration, /^UPDATE\s+/im);
assert.doesNotMatch(migration, /^INSERT\s+INTO/i);
assert.doesNotMatch(migration, /^DELETE\s+FROM/i);
assert.match(seed, /minimumUpgradePremiumBps: 2000/);

console.log("First-production baseline invariants passed.");
