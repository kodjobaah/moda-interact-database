import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  Prisma,
  ProviderSubscriptionLifecycleState,
  SubscriptionProjectionStatus,
} from "@prisma/client";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260910030000_add_billing_lifecycle_operations/migration.sql",
  "utf8",
);
const reconciliationMigration = await readFile(
  "prisma/migrations/20260911000000_add_subscription_reconciliation_schedule/migration.sql",
  "utf8",
);
const periodReservationMigration = await readFile(
  "prisma/migrations/20260911160000_add_billing_period_entitlement_reservations/migration.sql",
  "utf8",
);
const reservationBaselineMigration = await readFile(
  "prisma/migrations/20260907180000_add_usage_reservation_reporting_ledger/migration.sql",
  "utf8",
);
const providerLifecycleMigration = await readFile(
  "prisma/migrations/20260911140000_add_subscription_provider_lifecycle_evidence/migration.sql",
  "utf8",
);

const model = (name) => schema.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
const enumBlock = (name) => schema.match(new RegExp(`enum ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
const includesAll = (value, entries) => entries.forEach((entry) => assert.ok(value.includes(entry), `Expected ${entry}`));
const enumValues = (name) => {
  const block = enumBlock(name);
  return [...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*$/gm)].map((match) => match[1]);
};
const assertExactEnum = (name, expected) => assert.deepEqual(enumValues(name), expected, `${name} values differ`);

includesAll(schema, [
  "Subscription",
  "BillingPeriod",
  "UsageEvent",
  "RecoveryCreditPurchase",
  "ShopEntitlementCounter",
  "MerchantSupportMessage",
  "PlatformAdmin",
  "BillingAuditEvent",
]);

const periodCounter = model("BillingPeriodEntitlementCounter");
const reservation = model("UsageReservation");
assert.match(enumBlock("BillingPeriodEntitlementCounterKind"), /INCLUDED_RECOVERY_CREDITS/);
assert.ok(periodCounter, "BillingPeriodEntitlementCounter model is required");
assert.match(periodCounter, /@@unique\(\[billingPeriodId, counter\]\)/);
assert.match(reservation, /counterId\s+String\?/);
assert.match(reservation, /billingPeriodEntitlementCounterId\s+String\?/);
assert.match(reservation, /@@index\(\[billingPeriodEntitlementCounterId\]\)/);
assert.match(reservationBaselineMigration, /UsageReservation_counterId_fkey/);
assert.match(periodReservationMigration, /ALTER COLUMN "counterId" DROP NOT NULL/);
assert.match(periodReservationMigration, /UsageReservation_billingPeriodEntitlementCounterId_fkey/);
assert.match(periodReservationMigration, /UsageReservation_counter_family_xor/);
assert.match(periodReservationMigration, /BillingPeriodEntitlementCounter_grantedQuantity_non_negative/);
assert.match(periodReservationMigration, /BillingPeriodEntitlementCounter_committedQuantity_non_negative/);
assert.match(periodReservationMigration, /BillingPeriodEntitlementCounter_reservedQuantity_non_negative/);
assert.match(periodReservationMigration, /BillingPeriodEntitlementCounter_forfeitedQuantity_non_negative/);
assert.match(periodReservationMigration, /BillingPeriodEntitlementCounter_capacity/);
assert.match(schema, /FREE_RECOVERY_LIFETIME/);
assert.match(schema, /PURCHASED_RECOVERY_CREDITS/);

assert.match(enumBlock("RecoveryCreditPurchaseStatus"), /REFUNDED/);
assertExactEnum("BillingLifecycleRequestSource", ["MERCHANT_UI", "MERCHANT_SUPPORT", "ADMIN"]);
assertExactEnum("SubscriptionCancellationMode", [
  "END_OF_CYCLE",
  "IMMEDIATE_NO_PRORATION",
  "IMMEDIATE_PRORATED",
  "IMMEDIATE_SKIP_FINAL_USAGE",
]);
assertExactEnum("SubscriptionCancellationStatus", [
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "RETRYABLE",
  "PROVIDER_ACCEPTED",
  "COMPLETED",
  "REJECTED",
  "WITHDRAWN",
  "NEEDS_ATTENTION",
]);
assertExactEnum("RecoveryCreditRefundSettlementMode", [
  "CURRENT_CYCLE_APP_EVENT_CORRECTION",
  "PARTNER_DASHBOARD_REFUND",
]);
assertExactEnum("RecoveryCreditRefundStatus", [
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "PROVIDER_PENDING",
  "PROVIDER_ACTION_REQUIRED",
  "PROVIDER_CONFIRMED",
  "COMPLETED",
  "REJECTED",
  "WITHDRAWN",
  "NEEDS_ATTENTION",
]);
includesAll(enumBlock("BillingAuditAction"), ["SUBSCRIPTION_CANCELLATION", "RECOVERY_CREDIT_REFUND"]);

assert.match(model("ShopEntitlementCounter"), /refundingQuantity\s+Int\s+@default\(0\)/);
const cancellation = model("SubscriptionCancellationRequest");
const refund = model("RecoveryCreditRefund");
const subscription = model("Subscription");
assert.match(subscription, /nextReconcileAt\s+DateTime\?/);
assert.match(subscription, /@@index\(\[nextReconcileAt\]\)/);
const generatedReconcileField = Prisma.dmmf.datamodel.models
  .find(({ name }) => name === "Subscription")
  ?.fields.find(({ name }) => name === "nextReconcileAt");
assert.equal(generatedReconcileField?.kind, "scalar");
assert.equal(generatedReconcileField?.type, "DateTime");
assert.equal(generatedReconcileField?.isRequired, false);
assert.equal(generatedReconcileField?.isList, false);
assert.deepEqual(enumValues("SubscriptionProjectionStatus"), ["ACTIVE", "TRIALING", "NO_CONTRACT", "UNMAPPED", "SYNC_ERROR", "FROZEN"]);
assert.equal(SubscriptionProjectionStatus.FROZEN, "FROZEN");
assertExactEnum("ProviderSubscriptionLifecycleState", [
  "CREATED",
  "UPDATED",
  "CANCELLATION_SCHEDULED",
  "CANCELED",
  "FROZEN",
  "UNFROZEN",
]);
assert.deepEqual(Object.values(ProviderSubscriptionLifecycleState), [
  "CREATED",
  "UPDATED",
  "CANCELLATION_SCHEDULED",
  "CANCELED",
  "FROZEN",
  "UNFROZEN",
]);
for (const field of [
  "lastProviderLifecycleState\\s+ProviderSubscriptionLifecycleState\\?",
  "lastProviderLifecycleEventId\\s+String\\?",
  "lastProviderLifecycleEventAt\\s+DateTime\\?",
]) {
  assert.match(subscription, new RegExp(field));
}
const generatedSubscription = Prisma.dmmf.datamodel.models.find(({ name }) => name === "Subscription");
for (const field of ["lastProviderLifecycleState", "lastProviderLifecycleEventId", "lastProviderLifecycleEventAt"]) {
  const generatedField = generatedSubscription?.fields.find(({ name }) => name === field);
  assert.equal(generatedField?.isRequired, false);
  assert.equal(generatedField?.isList, false);
}
assert.match(cancellation, /requestKey\s+String\s+@unique\s+@db\.VarChar\(255\)/);
assert.match(cancellation, /@@index\(\[shopId, status, createdAt\]\)/);
assert.match(cancellation, /@@index\(\[status, nextAttemptAt, createdAt\]\)/);
assert.match(cancellation, /@@index\(\[sourceMessageId\]\)/);
assert.match(cancellation, /@@index\(\[approvedByPlatformAdminId, createdAt\]\)/);
assert.match(refund, /purchaseId\s+String\s*\n\s+purchase\s+RecoveryCreditPurchase/);
assert.match(refund, /requestKey\s+String\s+@unique\s+@db\.VarChar\(255\)/);
assert.match(refund, /correctionUsageEventId\s+String\?\s+@unique/);
assert.match(refund, /@@index\(\[shopId, status, createdAt\]\)/);
assert.match(refund, /@@index\(\[purchaseId, status, createdAt\]\)/);
assert.match(refund, /@@index\(\[status, nextAttemptAt, createdAt\]\)/);
assert.match(refund, /@@index\(\[sourceMessageId\]\)/);
assert.match(refund, /@@index\(\[approvedByPlatformAdminId, createdAt\]\)/);
assert.match(refund, /@@index\(\[providerConfirmedByPlatformAdminId, createdAt\]\)/);

includesAll(migration, [
  `ALTER TYPE "billing"."RecoveryCreditPurchaseStatus" ADD VALUE 'REFUNDED'`,
  `ALTER TYPE "billing"."BillingAuditAction" ADD VALUE 'SUBSCRIPTION_CANCELLATION'`,
  `ALTER TYPE "billing"."BillingAuditAction" ADD VALUE 'RECOVERY_CREDIT_REFUND'`,
  `CREATE TYPE "billing"."BillingLifecycleRequestSource" AS ENUM ('MERCHANT_UI', 'MERCHANT_SUPPORT', 'ADMIN')`,
  `CREATE TYPE "billing"."SubscriptionCancellationMode" AS ENUM ('END_OF_CYCLE', 'IMMEDIATE_NO_PRORATION', 'IMMEDIATE_PRORATED', 'IMMEDIATE_SKIP_FINAL_USAGE')`,
  `CREATE TYPE "billing"."SubscriptionCancellationStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'RETRYABLE', 'PROVIDER_ACCEPTED', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'NEEDS_ATTENTION')`,
  `CREATE TYPE "billing"."RecoveryCreditRefundSettlementMode" AS ENUM ('CURRENT_CYCLE_APP_EVENT_CORRECTION', 'PARTNER_DASHBOARD_REFUND')`,
  `CREATE TYPE "billing"."RecoveryCreditRefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PROVIDER_PENDING', 'PROVIDER_ACTION_REQUIRED', 'PROVIDER_CONFIRMED', 'COMPLETED', 'REJECTED', 'WITHDRAWN', 'NEEDS_ATTENTION')`,
  'ADD COLUMN "refundingQuantity" INTEGER NOT NULL DEFAULT 0',
  'CREATE TABLE "billing"."SubscriptionCancellationRequest"',
  'CREATE TABLE "billing"."RecoveryCreditRefund"',
  'RecoveryCreditRefund_purchaseId_key',
  'RecoveryCreditRefund_correctionUsageEventId_key',
  'SubscriptionCancellationRequest_requestKey_key',
  'RecoveryCreditRefund_requestKey_key',
]);
includesAll(reconciliationMigration, [
  'ALTER TABLE "billing"."Subscription" ADD COLUMN "nextReconcileAt" TIMESTAMP(3)',
  'CREATE INDEX "Subscription_nextReconcileAt_idx" ON "billing"."Subscription"("nextReconcileAt")',
]);
includesAll(providerLifecycleMigration, [
  'CREATE TYPE "billing"."ProviderSubscriptionLifecycleState" AS ENUM',
  "'CREATED'",
  "'UPDATED'",
  "'CANCELLATION_SCHEDULED'",
  "'CANCELED'",
  "'FROZEN'",
  "'UNFROZEN'",
  'ALTER TYPE "billing"."SubscriptionProjectionStatus" ADD VALUE \'FROZEN\'',
  'ADD COLUMN "lastProviderLifecycleState" "billing"."ProviderSubscriptionLifecycleState"',
  'ADD COLUMN "lastProviderLifecycleEventId" TEXT',
  'ADD COLUMN "lastProviderLifecycleEventAt" TIMESTAMP(3)',
]);
assert.doesNotMatch(providerLifecycleMigration, /\bUPDATE\b|\bDELETE\b|\bDROP TABLE\b|\bDROP COLUMN\b|BillingPeriod|ShopEntitlementCounter|UsageReservation/);

console.log("Billing lifecycle schema assertions passed.");
