import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const enumBody = schema.match(/enum\s+BackgroundRuntimeLeaseName\s*\{([^}]*)\}/)?.[1];
assert.ok(enumBody, 'BackgroundRuntimeLeaseName must exist');
const enumValues = enumBody
  .split('\n')
  .map(line => line.trim())
  .filter(line => /^[A-Z][A-Z0-9_]*$/.test(line));
assert.deepEqual(enumValues, [
  'BILLING_RECONCILIATION',
  'RECOVERY_CAPACITY_REPAIR',
  'TRANSLATION_RECONCILIATION',
  'QUEUE_CONCURRENCY_RECONCILIATION',
  'CHECKOUT_RECOVERY_EXPIRY',
  'MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION',
  'MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP',
  'MERCHANT_KNOWLEDGE_ENTITLEMENT_RECONCILIATION',
  'WOO_COUPON_SYNC_DISPATCH',
]);
assert.match(enumBody, /@@schema\("public"\)/);

const migration = readFileSync(
  new URL('../prisma/migrations/20261013080000_arch036_woo_coupon_dispatch_runtime_lease/migration.sql', import.meta.url),
  'utf8',
).trim();
assert.equal(migration, `ALTER TYPE "public"."BackgroundRuntimeLeaseName"
  ADD VALUE IF NOT EXISTS 'WOO_COUPON_SYNC_DISPATCH';`);

console.log('ARCH-036 Woo coupon dispatcher enum and migration static contract passed.');
