import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const migrationsPath = new URL('../prisma/migrations/', import.meta.url);
const target = '20261008110000_arch027_woocommerce_billing_persistence';
const migration = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../prisma/migrations/20260912000000_arch010_first_production_baseline/migration.sql', import.meta.url), 'utf8');
const names = readdirSync(migrationsPath).filter(name => /^\d{14}_.+$/.test(name)).sort();
const arch027 = names.filter(name => /arch027_woocommerce_billing_persistence/.test(name));
const refundOptionalAuditMigration = '20261011110000_arch027_woocommerce_refund_optional_audit_money';
const refundOptionalAuditSql = readFileSync(
  new URL(`../prisma/migrations/${refundOptionalAuditMigration}/migration.sql`, import.meta.url), 'utf8',
);

assert.deepEqual(arch027, [target], 'exactly one ARCH-027 database migration is allowed');
assert.ok(target > '20261002090000_arch026_woocommerce_installation_identity', 'ARCH-027 migration must follow ARCH-026');
assert.ok(names.includes(target), 'accepted ARCH-027 migration must remain present in the ordered chain');

const createdTables = [...migration.matchAll(/CREATE TABLE\s+"([^"]+)"\."([^"]+)"/g)].map(([, schema, table]) => `${schema}.${table}`);
assert.deepEqual(createdTables, [
  'billing.BillingOperation',
  'woocommerce.WooCommerceBillingWebhookReceipt',
], 'only the two task-authorized tables may be created');
const createdEnums = [...migration.matchAll(/CREATE TYPE\s+"([^"]+)"\."([^"]+)"\s+AS ENUM/g)].map(([, schema, type]) => `${schema}.${type}`);
assert.deepEqual(createdEnums, ['billing.BillingOperationKind', 'billing.BillingOperationState']);

const alteredTables = [...migration.matchAll(/ALTER TABLE\s+"([^"]+)"\."([^"]+)"/g)].map(([, schema, table]) => `${schema}.${table}`);
assert.deepEqual([...new Set(alteredTables)].sort(), [
  'billing.BillingPeriodEntitlementCounter',
  'billing.RecoveryCreditPurchase',
  'billing.RecoveryCreditRefund',
  'billing.Subscription',
].sort(), 'only the explicitly authorized existing billing tables may be altered');

for (const required of [
  'BillingPeriodEntitlementCounter_currentAllowanceQuantity_check',
  'Subscription_providerSubscriptionId_idx',
  'Subscription_providerCoverageEndAt_idx',
  'RecoveryCreditPurchase_provider_evidence_shape_check',
  'RecoveryCreditPurchase_confirmed_valuation_complete',
  'RecoveryCreditRefund_provider_evidence_shape_check',
  'RecoveryCreditRefund_woocommerce_settlement_check',
  'BillingOperation_kind_shape_check',
  'BillingOperation_state_provider_reference_check',
  'BillingOperation_shopId_requestKey_key',
  'WooCommerceBillingWebhookReceipt_topic_payloadSha256_key',
  'arch027_billing_operation_guard',
  'arch027_woocommerce_billing_webhook_receipt_guard',
  'arch027_recovery_credit_purchase_refund_attempt_guard',
  'arch027_recovery_credit_purchase_reference_guard',
  'arch027_recovery_credit_refund_provider_guard',
]) assert.ok(migration.includes(required), `${required} missing from migration`);

assert.match(baseline, /ADD CONSTRAINT "BillingPeriodEntitlementCounter_capacity"/);
assert.doesNotMatch(migration, /DROP CONSTRAINT[^;]*BillingPeriodEntitlementCounter_capacity/i,
  'the high-water counter capacity constraint must remain unchanged');
assert.match(migration, /ON DELETE CASCADE ON UPDATE RESTRICT/);
assert.match(migration, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
assert.match(migration, /ON DELETE SET NULL ON UPDATE RESTRICT/);
assert.match(migration, /UNIQUE \("topic", "payloadSha256"\)/);
assert.match(migration, /"status" <> 'COMPLETED'[\s\S]*?"providerAmount" IS NOT NULL[\s\S]*?"providerCurrency" IS NOT NULL/);

// The accepted DATABASE-001 migration remains unchanged. The forward correction
// removes only the two mandatory monetary fields. It also closes PostgreSQL's
// CHECK-UNKNOWN loophole for nullable required credit/action fields.
assert.ok(names.includes(refundOptionalAuditMigration), 'DATABASE-002 refund correction migration must exist');
assert.ok(refundOptionalAuditMigration > target, 'refund correction must follow accepted DATABASE-001');
assert.match(refundOptionalAuditSql, /ALTER TABLE "billing"\."RecoveryCreditRefund"\s+DROP CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check",\s+ADD CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check"\s+CHECK\s*\(/);
assert.equal((refundOptionalAuditSql.match(/^ALTER TABLE\b/gm) ?? []).length, 1, 'only one table may be altered');
assert.doesNotMatch(refundOptionalAuditSql, /\b(?:CREATE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i, 'contract correction must not rewrite data');
const originalWooCheck = migration.match(/ADD CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check"\s+CHECK\s*\([\s\S]*?\n\s*\);/);
const replacementWooCheck = refundOptionalAuditSql.match(/ADD CONSTRAINT "RecoveryCreditRefund_woocommerce_settlement_check"\s+CHECK\s*\([\s\S]*?\n\s*\);/);
assert.ok(originalWooCheck && replacementWooCheck, 'old and effective Woo checks must be present');
const expectedWooCheck = originalWooCheck[0]
  .replace(/\s+AND "providerAmount" IS NOT NULL/, '')
  .replace(/\s+AND "providerCurrency" IS NOT NULL/, '')
  .replace('"finalCreditQuantity" > 0', '"finalCreditQuantity" IS NOT NULL AND "finalCreditQuantity" > 0')
  .replace(`"providerActionKind" = 'REFUND'`, `"providerActionKind" IS NOT NULL AND "providerActionKind" = 'REFUND'`);
const compact = text => text.replace(/\s+/g, ' ').trim();
assert.equal(compact(replacementWooCheck[0]), compact(expectedWooCheck),
  'DATABASE-002 may relax money but must fail closed on nullable completed-refund evidence');
assert.match(refundOptionalAuditSql, /"finalCreditQuantity" IS NOT NULL\s+AND "finalCreditQuantity" > 0/);
assert.match(refundOptionalAuditSql, /"providerActionKind" IS NOT NULL\s+AND "providerActionKind" = 'REFUND'/);
// Rehearsals must provision their own isolated PostgreSQL 17 databases.
// External ARCH027_* URLs must not be required or used as a test destination.
const rehearsalHarness = readFileSync(new URL('./test-arch027-woocommerce-billing-postgres.mjs', import.meta.url), 'utf8');
assert.match(rehearsalHarness, /fresh: 'arch027_fresh_fixture'/);
assert.match(rehearsalHarness, /upgrade: 'arch027_upgrade_fixture'/);
assert.match(rehearsalHarness, /\['fresh', 'upgrade'\]/);
assert.match(rehearsalHarness, /--network', 'none'/);
assert.match(rehearsalHarness, /pgvector\/pgvector:pg17/);
assert.match(rehearsalHarness, /process\.env\.ARCH027_FRESH_DATABASE_URL\s*=/);
assert.match(rehearsalHarness, /process\.env\.ARCH027_UPGRADE_DATABASE_URL\s*=/);
assert.match(rehearsalHarness, /docker\(\['rm', '--force', '--volumes', containerName\]\)/);

assert.match(migration, /purchase provider change would mismatch existing refunds/);
assert.match(migration, /purchase Shop change would mismatch its billing operation/);
assert.doesNotMatch(migration, /UNIQUE\s*\([^)]*providerContractId/i,
  'webhook dedupe must not depend on nullable provider contract identity');
assert.doesNotMatch(migration, /CREATE SCHEMA/i, 'the accepted WooCommerce schema must be reused');
assert.doesNotMatch(migration, /\bINSERT\s+INTO\b/i, 'migration must not seed billing business rows');
assert.doesNotMatch(migration, /WooCommerceBillingOffer|MerchantPricingProviderOffer|BillingEntitlementPeriod|ProviderWebhook/i);
assert.doesNotMatch(migration, /ALTER TABLE\s+"(?:commerce|shopify|public)"|CREATE TABLE\s+"(?:commerce|shopify|public)"/i);
assert.doesNotMatch(migration, /CREATE TABLE\s+"billing"\."(?:BillingPlan|BillingPeriod|UsageEvent|UsageReservation|MerchantPricingPlan|MerchantPricingUsageEvent|MerchantPricingUsageTier)"/i);
assert.doesNotMatch(migration, /CREATE TABLE\s+"woocommerce"\."WooCommerceInstallation"/i);
assert.doesNotMatch(migration, /"subscriptionId"\s+TEXT|"requestedQuantity"/i,
  'BillingOperation must not gain a duplicate subscription identity or charge quantity');

console.log('ARCH-027 WooCommerce billing migration scope checks passed.');