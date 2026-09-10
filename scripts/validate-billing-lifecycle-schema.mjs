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
includesAll(enumBlock("BillingLifecycleRequestSource"), ["MERCHANT_UI", "MERCHANT_SUPPORT", "ADMIN"]);
includesAll(enumBlock("SubscriptionCancellationMode"), [
  "END_OF_CYCLE",
  "IMMEDIATE_NO_PRORATION",
  "IMMEDIATE_PRORATED",
  "IMMEDIATE_SKIP_FINAL_USAGE",
]);
includesAll(enumBlock("SubscriptionCancellationStatus"), [
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
includesAll(enumBlock("RecoveryCreditRefundSettlementMode"), [
  "CURRENT_CYCLE_APP_EVENT_CORRECTION",
  "PARTNER_DASHBOARD_REFUND",
]);
includesAll(enumBlock("RecoveryCreditRefundStatus"), [
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
  'CREATE TYPE "billing"."BillingLifecycleRequestSource"',
  'CREATE TYPE "billing"."SubscriptionCancellationMode"',
  'CREATE TYPE "billing"."SubscriptionCancellationStatus"',
  'CREATE TYPE "billing"."RecoveryCreditRefundSettlementMode"',
  'CREATE TYPE "billing"."RecoveryCreditRefundStatus"',
  'ADD COLUMN "refundingQuantity" INTEGER NOT NULL DEFAULT 0',
  'CREATE TABLE "billing"."SubscriptionCancellationRequest"',
  'CREATE TABLE "billing"."RecoveryCreditRefund"',
  'RecoveryCreditRefund_purchaseId_key',
  'RecoveryCreditRefund_correctionUsageEventId_key',
  'SubscriptionCancellationRequest_requestKey_key',
  'RecoveryCreditRefund_requestKey_key',
]);

console.log("Billing lifecycle schema assertions passed.");
