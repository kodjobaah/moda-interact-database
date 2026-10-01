import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const enumBody = schema.match(/enum\s+BackgroundRuntimeLeaseName\s*\{([^}]*)\}/)?.[1];
assert.ok(enumBody, 'BackgroundRuntimeLeaseName must exist in the Prisma schema');
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
], 'Existing enum labels must remain unchanged and only the exact two labels may be added');

const migrationName = '20261001010000_arch023_merchant_knowledge_runtime_leases';
const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
assert.ok(readdirSync(migrationRoot).includes(migrationName), 'Fixed migration directory must exist');
const migration = readFileSync(new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url))
  .toString()
  .replaceAll('\r\n', '\n')
  .trim();
assert.equal(migration, `ALTER TYPE "public"."BackgroundRuntimeLeaseName"
  ADD VALUE IF NOT EXISTS 'MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION';

ALTER TYPE "public"."BackgroundRuntimeLeaseName"
  ADD VALUE IF NOT EXISTS 'MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP';`);
assert.equal((migration.match(/\bALTER\s+TYPE\b/gi) ?? []).length, 2);
assert.doesNotMatch(migration, /\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|INDEX|CONSTRAINT|COLUMN)\b/i);
assert.doesNotMatch(migration, /BackgroundRuntimeConfig|BackgroundRuntimeLease"\s+(?:ADD|DROP|ALTER)/i);

console.log('ARCH-023 Merchant Knowledge runtime lease static contract passed.');