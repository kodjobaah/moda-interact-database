import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260910030000_add_billing_lifecycle_operations/migration.sql",
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
assert.match(cancellation, /requestKey\s+String\s+@unique\s+@db\.VarChar\(255\)/);
assert.match(cancellation, /@@index\(\[shopId, status, createdAt\]\)/);
assert.match(cancellation, /@@index\(\[status, nextAttemptAt, createdAt\]\)/);
assert.match(cancellation, /@@index\(\[sourceMessageId\]\)/);
assert.match(cancellation, /@@index\(\[approvedByPlatformAdminId, createdAt\]\)/);
assert.match(refund, /purchaseId\s+String\s+@unique/);
assert.match(refund, /requestKey\s+String\s+@unique\s+@db\.VarChar\(255\)/);
assert.match(refund, /correctionUsageEventId\s+String\?\s+@unique/);
assert.match(refund, /@@index\(\[shopId, status, createdAt\]\)/);
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

console.log("Billing lifecycle schema assertions passed.");
