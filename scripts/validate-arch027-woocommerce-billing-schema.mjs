import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const erd = read('docs/generated/prisma-erd.puml');
const block = (source, kind, name) => source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const model = name => block(schema, 'model', name);
const enumBody = name => block(schema, 'enum', name);

function requireFields(body, fields, owner) {
  assert.ok(body, `${owner} missing`);
  for (const field of fields) assert.match(body, new RegExp(`^\\s*${field}\\s`, 'm'), `${owner}.${field} missing`);
}

function enumValues(name, expected) {
  const body = enumBody(name);
  assert.ok(body, `${name} missing`);
  assert.deepEqual(body.match(/^\s+[A-Z][A-Z_]+\s*$/gm)?.map(value => value.trim()), expected, `${name} values differ`);
  assert.match(body, /@@schema\("billing"\)/);
}

enumValues('BillingOperationKind', ['SUBSCRIPTION_CREATE', 'PLAN_SWITCH', 'ONE_TIME_CHARGE', 'CANCEL']);
enumValues('BillingOperationState', ['INITIATING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'OUTCOME_UNKNOWN', 'FAILED']);

const operation = model('BillingOperation');
requireFields(operation, [
  'id', 'shopId', 'shop', 'kind', 'state', 'requestKey', 'requestFingerprint',
  'merchantPricingPlanId', 'merchantPricingPlan', 'merchantPricingUsageEventId',
  'merchantPricingUsageEvent', 'quotedAmountMinor', 'quotedCurrency', 'quotedBillingPeriod',
  'recoveryCreditPurchaseId', 'recoveryCreditPurchase', 'providerReference', 'confirmationUrl',
  'lastErrorCode', 'createdAt', 'updatedAt', 'wooReceipts',
], 'BillingOperation');
assert.match(operation, /shopId\s+String\s+@db\.Text[\s\S]*?shop\s+Shop\s+@relation\(fields: \[shopId\], references: \[id\], onDelete: Cascade, onUpdate: Restrict\)/);
assert.match(operation, /requestKey\s+String\s+@db\.VarChar\(255\)/);
assert.match(operation, /requestFingerprint\s+Bytes/);
assert.match(operation, /quotedCurrency\s+String\?\s+@db\.Char\(3\)/);
assert.match(operation, /recoveryCreditPurchaseId\s+String\?\s+@unique\s+@db\.Text/);
assert.match(operation, /@@unique\(\[shopId, requestKey\]\)/);
for (const index of [
  '@@index([shopId, state, createdAt])', '@@index([providerReference, createdAt])',
  '@@index([merchantPricingPlanId])', '@@index([merchantPricingUsageEventId])',
]) assert.ok(operation.includes(index), `BillingOperation missing ${index}`);
assert.match(operation, /@@schema\("billing"\)/);
assert.doesNotMatch(operation, /\b(subscriptionId|subscription|provider|requestedQuantity)\s/,
  'BillingOperation must not duplicate a subscription, provider or charge quantity');

const receipt = model('WooCommerceBillingWebhookReceipt');
requireFields(receipt, [
  'id', 'topic', 'providerContractId', 'billingOperationId', 'billingOperation',
  'payloadSha256', 'normalizedPayload', 'receivedAt', 'processedAt', 'processingError',
], 'WooCommerceBillingWebhookReceipt');
assert.match(receipt, /billingOperationId\s+String\?\s+@db\.Text/);
assert.match(receipt, /billingOperation\s+BillingOperation\?\s+@relation\(fields: \[billingOperationId\], references: \[id\], onDelete: SetNull, onUpdate: Restrict\)/);
assert.match(receipt, /@@unique\(\[topic, payloadSha256\]\)/);
for (const index of [
  '@@index([providerContractId, receivedAt])', '@@index([billingOperationId, receivedAt])',
  '@@index([processedAt, receivedAt])',
]) assert.ok(receipt.includes(index), `WooCommerceBillingWebhookReceipt missing ${index}`);
assert.match(receipt, /@@schema\("woocommerce"\)/);

const shop = model('Shop');
assert.match(shop, /subscription\s+Subscription\?/);
assert.match(model('Subscription'), /shopId\s+String\s+@unique/);
assert.match(model('Subscription'), /providerSubscriptionId\s+String\?/);
assert.match(model('Subscription'), /providerCoverageEndAt\s+DateTime\?/);
assert.match(model('Subscription'), /@@index\(\[providerSubscriptionId\]\)/);
assert.match(model('Subscription'), /@@index\(\[providerCoverageEndAt\]\)/);
assert.match(shop, /billingOperations\s+BillingOperation\[\]/);

const counter = model('BillingPeriodEntitlementCounter');
assert.match(counter, /currentAllowanceQuantity\s+Int\?/);
assert.match(counter, /grantedQuantity\s+Int\s+@default\(0\)/);

const purchase = model('RecoveryCreditPurchase');
assert.match(purchase, /billingPeriodId\s+String\?/);
assert.match(purchase, /billingPeriod\s+BillingPeriod\?/);
assert.match(purchase, /provider\s+String\s+@default\("SHOPIFY"\)\s+@db\.VarChar\(32\)/);
assert.match(purchase, /providerReference\s+String\?\s+@db\.VarChar\(512\)/);
assert.match(purchase, /refundAttemptedAt\s+DateTime\?/);
for (const field of [
  'shopifyPlanHandleSnapshot', 'shopifyEventHandleSnapshot', 'providerSubscriptionIdSnapshot',
  'providerUsageQuantityBeforeSnapshot', 'providerUsageCostBeforeSnapshot',
  'providerUsageCostCurrencyBeforeSnapshot', 'usageEventId',
]) assert.match(purchase, new RegExp(`^\\s*${field}\\s+[^\\n]*\\?`, 'm'), `${field} must be nullable`);
assert.match(purchase, /usageEvent\s+UsageEvent\?/);
assert.match(purchase, /billingOperation\s+BillingOperation\?/);

const refund = model('RecoveryCreditRefund');
assert.match(refund, /provider\s+String\s+@default\("SHOPIFY"\)\s+@db\.VarChar\(32\)/);
for (const field of ['billingPeriodIdSnapshot', 'providerSubscriptionIdSnapshot', 'planHandleSnapshot', 'eventHandleSnapshot']) {
  assert.match(refund, new RegExp(`^\\s*${field}\\s+String\\?`, 'm'), `${field} must be nullable`);
}

const installation = model('WooCommerceInstallation');
assert.doesNotMatch(installation, /billing|subscription|providerContract|charge/i,
  'WooCommerceInstallation must remain installation identity only');
for (const name of [
  'BillingPlan', 'BillingPeriod', 'UsageEvent', 'UsageReservation',
  'MerchantPricingUsageTier',
]) assert.ok(model(name), `${name} must remain in the schema`);

const erdOperation = erd.match(/entity "BillingOperation" as \w+ \{([\s\S]*?)\n\}/)?.[1] ?? '';
const erdReceipt = erd.match(/entity "WooCommerceBillingWebhookReceipt" as \w+ \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.ok(erdOperation, 'BillingOperation missing from generated ERD');
assert.ok(erdReceipt, 'WooCommerceBillingWebhookReceipt missing from generated ERD');
assert.match(erdOperation, /requestFingerprint\s*:\s*Bytes/);
assert.match(erdReceipt, /payloadSha256\s*:\s*Bytes/);

console.log('ARCH-027 WooCommerce billing static Prisma schema and ERD checks passed.');