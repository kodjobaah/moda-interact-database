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
assert.deepEqual(
  enumBlock("RecoveryCreditPurchaseStatus")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line)),
  ["REQUESTED", "ACTIVE", "COMPLETED", "WITHDRAWN", "REFUNDED"],
);
assert.deepEqual(
  enumBlock("RecoveryCreditRefundStatus")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line)),
  ["REQUESTED", "PROVIDER_ACTION_REQUIRED", "COMPLETED", "REJECTED", "CANCELLED", "NEEDS_ATTENTION"],
);

const grant = model("PromotionalCreditGrant");
assert.match(grant, /campaignId\s+String\n/);
assert.match(grant, /@@unique\(\[campaignId, shopId\]\)/);
assert.match(model("MerchantPromotionSelection"), /shopId\s+String\s+@unique/);
assert.match(model("UsageReservation"), /promotionalCreditGrantId\s+String\?/);

const purchase = model("RecoveryCreditPurchase");
assert.match(purchase, /billingPeriodId\s+String/);
assert.match(purchase, /providerSubscriptionIdSnapshot\s+String/);
assert.match(purchase, /providerUsageQuantityBeforeSnapshot\s+Int/);
assert.match(purchase, /providerUsageCostBeforeSnapshot\s+Decimal/);
assert.match(purchase, /providerPurchaseAmount\s+Decimal\?/);
assert.match(purchase, /providerPurchaseCurrency\s+String\?/);
assert.match(purchase, /providerPriceSnapshot\s+Json\?/);
assert.match(purchase, /currentAmount\s+Int\s+@default\(0\)/);
assert.match(purchase, /reservedAmount\s+Int\s+@default\(0\)/);
assert.doesNotMatch(purchase, /availableAmount|refundingQuantity|refundedQuantity/);
assert.match(purchase, /billingPeriod\s+BillingPeriod.*onDelete: Restrict/);
assert.match(model("BillingPeriod"), /recoveryCreditPurchases\s+RecoveryCreditPurchase\[\]/);

const refund = model("RecoveryCreditRefund");
assert.match(refund, /currentAmountAtRequestSnapshot\s+Int/);
assert.match(refund, /reservedAmountAtRequestSnapshot\s+Int/);
assert.match(refund, /availableAmountAtRequestSnapshot\s+Int/);
assert.match(refund, /finalCreditQuantity\s+Int\?/);
assert.match(refund, /purchaseProviderAmountSnapshot\s+Decimal\n/);
assert.match(refund, /purchaseProviderCurrencySnapshot\s+String\s+@db\.VarChar\(3\)/);
assert.doesNotMatch(refund, /providerAmount\s+Decimal\?.*@db\.Decimal\(20, 2\)/);
assert.doesNotMatch(refund, /creditsRequested|creditsApproved/);
assert.match(schema, /@@index\(\[status, createdAt, id\]\)/);
assert.match(migration, /RecoveryCreditRefund_status_createdAt_id_idx/);
assert.match(migration, /"currentAmount" <= "creditsGranted"/);
assert.match(migration, /RecoveryCreditPurchase_confirmed_valuation_complete/);
assert.doesNotMatch(migration, /RecoveryCreditPurchase_active_valuation_complete/);
for (const condition of [
  '"status" = \'REQUESTED\'',
  '"providerUsageQuantityAfterSnapshot" IS NOT NULL',
  '"providerUsageCostAfterSnapshot" IS NOT NULL',
  '"providerUsageCostCurrencyAfterSnapshot" IS NOT NULL',
  '"providerPurchaseAmount" IS NOT NULL',
  '"providerPurchaseAmount" > 0',
  '"providerPurchaseCurrency" IS NOT NULL',
  '"providerValuationConfirmedAt" IS NOT NULL',
  '"providerPriceSnapshot" IS NOT NULL',
  '"providerUsageCostCurrencyBeforeSnapshot" = "providerUsageCostCurrencyAfterSnapshot"',
  '"providerUsageCostCurrencyAfterSnapshot" = "providerPurchaseCurrency"',
  '"providerUsageCostAfterSnapshot" > "providerUsageCostBeforeSnapshot"',
  '"providerPurchaseAmount" = "providerUsageCostAfterSnapshot" - "providerUsageCostBeforeSnapshot"',
]) {
  assert.ok(migration.includes(condition), `missing valuation condition ${condition}`);
}
for (const condition of [
  '"purchaseProviderAmountSnapshot" > 0',
  '"currentAmountAtRequestSnapshot" <= "purchaseCreditsGrantedSnapshot"',
  '"availableAmountAtRequestSnapshot" > 0',
  '"finalCreditQuantity" IS NULL OR "finalCreditQuantity" <= "currentAmountAtRequestSnapshot"',
]) {
  assert.ok(migration.includes(condition), `missing refund snapshot condition ${condition}`);
}
assert.match(migration, /"purchaseProviderAmountSnapshot" DECIMAL\(65,30\) NOT NULL/);
assert.match(migration, /"purchaseProviderCurrencySnapshot" VARCHAR\(3\) NOT NULL/);
assert.match(migration, /"providerAmount" DECIMAL\(65,30\)/);
assert.match(migration, /RecoveryCreditPurchase_billingPeriodId_fkey[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /RecoveryCreditPurchase_planId_fkey[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /RecoveryCreditRefund_one_non_terminal_per_purchase_key[\s\S]*REQUESTED[\s\S]*PROVIDER_ACTION_REQUIRED[\s\S]*NEEDS_ATTENTION/);
assert.match(migration, /RecoveryCreditRefund_one_completed_per_purchase_key[\s\S]*status" = 'COMPLETED'/);
assert.match(erd, /entity "RecoveryCreditPurchase"[\s\S]*currentAmount[\s\S]*reservedAmount/);
assert.match(erd, /entity "RecoveryCreditRefund"[\s\S]*currentAmountAtRequestSnapshot[\s\S]*finalCreditQuantity/);
assert.doesNotMatch(erd, /entity "RecoveryCreditPurchase"[\s\S]*refundingQuantity|entity "RecoveryCreditPurchase"[\s\S]*refundedQuantity/);

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
  "RecoveryCreditPurchase_amounts_non_negative",
  "RecoveryCreditPurchase_lifecycle_amounts",
  "RecoveryCreditPurchase_confirmed_valuation_complete",
  "RecoveryCreditRefund_snapshot_amounts",
  "RecoveryCreditRefund_one_non_terminal_per_purchase_key",
  "RecoveryCreditRefund_one_completed_per_purchase_key",
  "CheckoutRecovery_admission_block_pair",
  "PlatformBillingPolicy_lifetimeFreeRecoveryAllowance_non_negative",
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

assert.doesNotMatch(refund, /settlementMode|correctionUsageEventId|attemptCount|nextAttemptAt|lastAttemptAt|processingStartedAt|providerErrorCode|providerResponseSummary/);
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
