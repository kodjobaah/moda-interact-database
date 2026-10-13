import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261013183000_arch038_unified_model_policies/migration.sql');
const block = (kind, name) => schema.match(new RegExp(String.raw`${kind} ${name} \{([\s\S]*?)\n\}`))?.[1] ?? '';
const policy = block('model', 'CommerceModelPolicy');
const audit = block('model', 'CommerceAuditEvent');
assert.ok(policy, 'CommerceModelPolicy Prisma model must exist');
for (const field of ['id', 'environment', 'context', 'scope', 'merchantPricingPlanId', 'shopId', 'budget', 'budgetSchemaVersion', 'editVersion', 'createdByAdminId', 'updatedByAdminId', 'createdAt', 'updatedAt']) {
  assert.match(policy, new RegExp(String.raw`^\s*${field}\s`, 'm'), `Missing model field ${field}`);
}
assert.match(policy, /budget\s+Json\s+@db\.JsonB/);
assert.match(block('enum', 'CommerceModelPolicyContext'), /LIVE\s+PREVIEW/);
assert.match(block('enum', 'CommerceModelPolicyScope'), /PLATFORM\s+PRICE_PLAN\s+SHOP/);
for (const target of [
  ['Shop', 'commerceModelPolicies'], ['MerchantPricingPlan', 'commerceModelPolicies'],
  ['PlatformAdmin', 'createdCommerceModelPolicies'], ['PlatformAdmin', 'updatedCommerceModelPolicies'],
  ['CommerceAuditEvent', 'modelPolicyId'],
]) {
  assert.match(block('model', target[0]), new RegExp(String.raw`^\s*${target[1]}\s`, 'm'));
}
assert.match(audit, /@@index\(\[modelPolicyId, createdAt, id\]\)/);
for (const name of ['SET_LIVE_PLATFORM_BUDGET', 'SET_LIVE_PLAN_BUDGET_OVERRIDE', 'SET_LIVE_SHOP_BUDGET_OVERRIDE', 'SET_PREVIEW_PLATFORM_BUDGET', 'SET_PREVIEW_SHOP_BUDGET_OVERRIDE']) {
  assert.match(block('enum', 'CommerceAuditAction'), new RegExp(String.raw`^\s*${name}\s*$`, 'm'));
  assert.ok(migration.includes(name), `${name} must be migrated`);
}
for (const fragment of [
  'CREATE TABLE "commerce"."CommerceModelPolicy"',
  'CommerceModelPolicy_owner_check', 'CommerceModelPolicy_budget_check',
  'arch038_valid_model_budget', 'CommerceModelPolicy_platform_unique',
  'CommerceModelPolicy_plan_unique', 'CommerceModelPolicy_shop_unique',
  'CommerceModelPolicy_merchantPricingPlanId_fkey', 'CommerceModelPolicy_shopId_fkey',
  'CommerceModelPolicy_createdByAdminId_fkey', 'CommerceModelPolicy_updatedByAdminId_fkey',
  'arch038_model_policy_guard', 'CommerceAuditEvent_modelPolicyId_createdAt_id_idx',
  'FROM unnest(enum_range', 'DROP CONSTRAINT "arch020_audit_targets"',
]) assert.ok(migration.includes(fragment), `Missing migration fragment: ${fragment}`);
assert.match(migration, /REFERENCES "commerce"\."Shop"/);
assert.doesNotMatch(migration, /REFERENCES "public"\."Shop"/);
assert.doesNotMatch(migration, /ALTER TABLE "billing"\."BillingPlan"/);
assert.doesNotMatch(migration, /ALTER TABLE "commerce"\."CommerceModelAvailability"/);
console.log('PASS ARCH-038 unified model policy schema/migration static checks');
