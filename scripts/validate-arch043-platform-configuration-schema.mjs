import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const schema = readFileSync(new URL('prisma/schema.prisma', root), 'utf8');
const originalMigrationId = '20261017150000_arch043_platform_configuration';
const forwardMigrationId = '20261017194500_arch043_remove_platform_configuration_audit_secret_redacted';
const sql = readFileSync(new URL(`prisma/migrations/${originalMigrationId}/migration.sql`, root), 'utf8');
const forwardSql = readFileSync(new URL(`prisma/migrations/${forwardMigrationId}/migration.sql`, root), 'utf8');
const model = name => {
  const matches = [...schema.matchAll(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'g'))];
  assert.equal(matches.length, 1, `${name} must be defined exactly once`);
  return matches[0][1];
};
const config = model('PlatformConfiguration');
const audit = model('PlatformConfigurationAudit');
for (const [name, fields] of [
  ['PlatformConfiguration', ['id', 'environment', 'key', 'value', 'version', 'updatedBy', 'createdAt', 'updatedAt']],
  ['PlatformConfigurationAudit', ['id', 'environment', 'key', 'expectedVersion', 'resultingVersion', 'beforeValue', 'afterValue', 'actorId', 'reason', 'createdAt']],
]) {
  const body = name === 'PlatformConfiguration' ? config : audit;
  const declaredFields = body.split('\n').map(line => line.trim()).filter(line => /^[a-z][A-Za-z]*\s+\w/.test(line)).map(line => line.split(/\s+/)[0]);
  assert.deepEqual(declaredFields, fields, `${name} must retain the exact approved columns`);
  assert.match(body, /@@schema\("public"\)/);
}
assert.match(config, /@@unique\(\[environment, key\]\)/);
assert.match(audit, /@@unique\(\[environment, key, resultingVersion\]\)/);
assert.match(config, /version\s+Int\s+@default\(1\)/);
assert.match(audit, /beforeValue\s+Json\?/);
assert.match(audit, /afterValue\s+Json(?!\?)/);
const cleanSql = sql.replace(/^--.*$/gm, '');
const tables = [...cleanSql.matchAll(/CREATE TABLE\s+"public"\."([A-Za-z]+)"/g)].map(match => match[1]);
assert.deepEqual(tables, ['PlatformConfiguration', 'PlatformConfigurationAudit']);
assert.doesNotMatch(cleanSql, /\b(?:ALTER|DROP) TABLE\b|\bINSERT INTO\b/, 'migration may not alter existing data or seed values');
for (const key of ['commerce.connectionKeys', 'auth.admin', 'auth.commerce', 'shopify.oauth', 'messaging.meta']) {
  assert.equal(sql.split(`'${key}'`).length - 1, 2, `both tables must guard ${key}`);
}
for (const constraint of ['sealed_secret_only', 'secret_redacted', 'revision_step', 'version_positive',
  'environment_nonblank', 'actor_nonblank']) assert.ok(sql.includes(constraint), `Missing ${constraint}`);
for (const token of ['AES-256-GCM', 'wrappingKeyId', 'authTag', 'ciphertext', 'nonce',
  'jsonb_typeof', 'COALESCE', "'disabled'", 'BEFORE UPDATE OR DELETE', 'BEFORE TRUNCATE']) {
  // JSON tombstone is written as a JSON literal, rather than a separate SQL string.
  if (token === "'disabled'") assert.ok(sql.includes('"kind":"disabled"'));
  else assert.ok(sql.includes(token), `Missing ${token}`);
}
const migrationOrder = readdirSync(new URL('prisma/migrations/', root)).filter(x => /^\d{14}_/.test(x)).sort();
assert.ok(migrationOrder.indexOf(forwardMigrationId) > migrationOrder.indexOf(originalMigrationId),
  'ARCH-043 correction must follow its original migration; later migrations may be added');
// Preserve the immutable baseline migration and verify that the forward migration
// only drops the one previously defined audit JSON shape constraint.
const forwardCommands = forwardSql.replace(/^--.*$/gm, '').trim();
assert.match(forwardCommands, /^ALTER TABLE "public"\."PlatformConfigurationAudit"\s+DROP CONSTRAINT "PlatformConfigurationAudit_secret_redacted";$/);
assert.doesNotMatch(forwardCommands, /DROP TABLE|DROP COLUMN|INSERT INTO|DELETE FROM/i);
console.log('PASS ARCH-043 schema, original migration protections and audit forward migration');
