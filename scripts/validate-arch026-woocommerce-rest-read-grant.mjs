import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const migrationName = '20261010120000_arch026_woocommerce_rest_read_grant';
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = readFileSync(new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url), 'utf8');
const migrations = readdirSync(new URL('../prisma/migrations/', import.meta.url))
  .filter(name => /^\d{14}_/.test(name)).sort();
assert.equal(migrations.at(-1), migrationName, 'migration must follow existing migrations');

function block(kind, name) {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(match, `missing ${kind} ${name}`);
  return match[1];
}

const installation = block('model', 'WooCommerceInstallation');
assert.match(installation, /credentialDigest\s+Bytes/, 'inbound credential must be retained');
assert.match(installation, /@@unique\(\[id, shopId\], map: "WooCommerceInstallation_id_shopId_key"\)/);
assert.match(installation, /restReadGrant\s+WooCommerceRestReadGrant\?/);
assert.match(installation, /restReadAttempts\s+WooCommerceRestReadAttempt\[\]/);

const attempt = block('model', 'WooCommerceRestReadAttempt');
for (const field of ['installationId', 'shopId', 'tokenDigest', 'attemptSequence',
  'credentialVersionSnapshot', 'status', 'expiresAt', 'consumedAt',
  'consumptionTransactionId', 'failureCode']) {
  assert.match(attempt, new RegExp(`^\\s*${field}\\s+`, 'm'));
}
assert.match(attempt, /@relation\(fields: \[installationId, shopId\], references: \[id, shopId\], onDelete: Cascade, onUpdate: Restrict\)/);
assert.match(attempt, /tokenDigest\s+Bytes\s+@unique/);
assert.match(attempt, /attemptSequence\s+BigInt\s+@unique.*@default\(autoincrement\(\)\)/);

const grant = block('model', 'WooCommerceRestReadGrant');
for (const field of ['installationId', 'shopId', 'authorizationAttemptId',
  'authorizationAttemptSequence', 'credentialVersionSnapshot', 'rotationVersion',
  'status', 'credentialCiphertext', 'credentialNonce', 'credentialAuthTag',
  'encryptionKeyId', 'providerKeyId', 'authorizedScope', 'verifiedAt',
  'grantedAt', 'revokedAt', 'invalidatedAt']) {
  assert.match(grant, new RegExp(`^\\s*${field}\\s+`, 'm'));
}
assert.match(grant, /@relation\(fields: \[installationId, shopId\], references: \[id, shopId\], onDelete: Cascade, onUpdate: Restrict\)/);
assert.match(grant, /authorizationAttemptId\s+String\s+@unique/);
assert.match(grant, /installationId\s+String\s+@unique/);
assert.match(grant, /@@unique\(\[installationId, shopId\], map: "WooCommerceRestReadGrant_installationId_shopId_key"\)/,
  'Prisma one-to-one composite relation requires uniqueness on both defining-side fields');
assert.doesNotMatch(grant, /consumerKey(?!Id)|consumerSecret|accessToken|password/i,
  'no cleartext credential column may be introduced');
assert.match(block('enum', 'WooCommerceRestReadGrantStatus'), /ACTIVE[\s\S]*INVALID[\s\S]*REVOKED/);
assert.match(block('enum', 'WooCommerceRestReadAttemptStatus'), /PENDING[\s\S]*SUCCEEDED[\s\S]*FAILED/);

for (const requirement of [
  /BEGIN;[\s\S]*COMMIT;/,
  /FOREIGN KEY \("installationId", "shopId"\)/,
  /REFERENCES "woocommerce"\."WooCommerceInstallation"\("id", "shopId"\)/,
  /CREATE UNIQUE INDEX "WooCommerceRestReadGrant_installationId_shopId_key"\s+ON "woocommerce"\."WooCommerceRestReadGrant"\("installationId", "shopId"\)/,
  /"authorizedScope" = 'read'/,
  /octet_length\("credentialNonce"\) = 12/,
  /octet_length\("credentialAuthTag"\) = 16/,
  /octet_length\("tokenDigest"\) = 32/,
  /INTERVAL '15 minutes'/,
  /CREATE CONSTRAINT TRIGGER "arch026_rest_read_attempt_commit_guard"/,
  /NEW\."consumptionTransactionId" := txid_current\(\)/,
  /attempt_row\."consumptionTransactionId" <> txid_current\(\)/,
  /DEFERRABLE INITIALLY DEFERRED/,
  /"authorizationAttemptSequence" <= OLD\."authorizationAttemptSequence"/,
  /"credentialVersionSnapshot" <> current_version/,
  /CREATE TRIGGER "arch026_rest_read_grant_guard"/,
]) assert.match(sql, requirement);
assert.doesNotMatch(sql, /(?:UPDATE|DELETE)\s+"woocommerce"\."WooCommerceInstallation"/i,
  'migration must not change inbound installation credential records');
assert.doesNotMatch(sql, /(?:UPDATE|DELETE|TRUNCATE)\s+"commerce"\."Shop"/i,
  'migration must not modify existing Shop rows');
assert.doesNotMatch(sql, /INSERT\s+INTO\s+"woocommerce"/i,
  'migration must not seed Woo credentials');
console.log('PASS ARCH-026 Woo REST read-only grant schema/migration static invariants');
