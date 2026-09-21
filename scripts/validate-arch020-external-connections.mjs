import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex === -1 ? 'fresh' : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');

let target;
try { target = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Explicit isolated DATABASE_URL required'); }
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Local isolated target required');
assert.equal(target.pathname, `/arch020_connections_test_${mode}`, 'Refusing non-test/shared database name');
assert.equal(target.search, '', 'Connection parameter overrides are not allowed');
assert.equal(target.hash, '');

const root = new URL('..', import.meta.url);
const migration = '20260921160000_arch020_external_connections';
const db = new PrismaClient();
let scratch;

const deploy = schema => execFileSync(
  'npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schema],
  { cwd: root, encoding: 'utf8', env: process.env },
);
const mustReject = async (operation, label) => {
  await assert.rejects(operation, undefined, label);
};

try {
  const tablesBefore = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  `);
  assert.equal(tablesBefore[0].count, 0, 'Target must be an empty disposable database');

  if (mode === 'upgrade') {
    scratch = mkdtempSync(join(tmpdir(), 'arch020-external-connections-'));
    cpSync(new URL('prisma/schema.prisma', root), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(new URL('prisma/migrations', root))) {
      if (name !== migration) cpSync(new URL(`prisma/migrations/${name}`, root), join(scratch, 'migrations', name), { recursive: true });
    }
    deploy(join(scratch, 'schema.prisma'));
    await db.$executeRawUnsafe(`INSERT INTO commerce."Shop" (id, domain) VALUES ('upgrade-shop', 'upgrade.example.test')`);
    await db.$executeRawUnsafe(`INSERT INTO public."PlatformAdmin" (id, email) VALUES ('upgrade-admin', 'upgrade@example.test')`);
    const existing = await db.$queryRawUnsafe(`SELECT 'commerce' AS table_schema, 'Shop' AS table_name, count(*)::int AS count FROM commerce."Shop" UNION ALL SELECT 'public', 'PlatformAdmin', count(*)::int FROM public."PlatformAdmin" ORDER BY 1, 2`);
    deploy('prisma/schema.prisma');
    const after = await db.$queryRawUnsafe(`SELECT 'commerce' AS table_schema, 'Shop' AS table_name, count(*)::int AS count FROM commerce."Shop" UNION ALL SELECT 'public', 'PlatformAdmin', count(*)::int FROM public."PlatformAdmin" ORDER BY 1, 2`);
    assert.deepEqual(after, existing.map(({ table_schema, table_name, count }) => ({ table_schema, table_name, count })));
    console.log('UPGRADE_PRESERVATION existing Shop/PlatformAdmin rows unchanged');
  } else {
    deploy('prisma/schema.prisma');
    await db.$executeRawUnsafe(`INSERT INTO commerce."Shop" (id, domain) VALUES ('upgrade-shop', 'upgrade.example.test')`);
    await db.$executeRawUnsafe(`INSERT INTO public."PlatformAdmin" (id, email) VALUES ('upgrade-admin', 'upgrade@example.test')`);
  }

  const connectionId = 'external-connection';
  const revisionId = 'external-revision';
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnection" (id, key, "displayName") VALUES ($1, 'inventory_api', 'Inventory API')`, connectionId);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ($1, $2, 1, 'https://inventory.example.test', 'PLATFORM', 'BEARER', 'upgrade-admin')`, revisionId, connectionId);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('platform-credential', $1, decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId);
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('duplicate-platform', $1, decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'duplicate platform credential must fail');
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('bad-nonce', $1, decode('01', 'hex'), decode('00', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'invalid nonce length must fail');
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", "shopId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('shop-credential', $1, 'upgrade-shop', decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId);
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", "shopId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('duplicate-shop', $1, 'upgrade-shop', decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'duplicate shop credential must fail');
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('bad-tag', $1, decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'invalid auth tag length must fail');
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('bad-ciphertext', $1, decode('', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'invalid ciphertext length must fail');
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ('missing-admin-revision', $1, 2, 'https://invalid.example.test', 'PLATFORM', 'NONE', 'missing-admin')`, connectionId), 'missing admin foreign key must fail');
  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", "shopId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ('missing-shop-credential', $1, 'missing-shop', decode('01', 'hex'), decode('000000000000000000000000', 'hex'), decode('00000000000000000000000000000000', 'hex'), 'key-1', 'upgrade-admin')`, revisionId), 'missing shop foreign key must fail');
  await mustReject(() => db.$executeRawUnsafe(`UPDATE commerce."CommerceExternalConnectionRevision" SET origin = 'https://changed.example.test' WHERE id = $1`, revisionId), 'immutable revision update must fail');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnectionRevision" WHERE id = $1`, revisionId), 'immutable revision delete must fail');
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionAudit" (id, "actorAdminId", "operationId", action, "requestDigest", "connectionId", reason, result) VALUES ('external-audit', 'upgrade-admin', 'operation-1', 'CREATE_CONNECTION', repeat('a', 64), $1, 'created', '{}'::jsonb)`, connectionId);
  await mustReject(() => db.$executeRawUnsafe(`UPDATE commerce."CommerceExternalConnectionAudit" SET reason = 'changed' WHERE id = 'external-audit'`), 'immutable audit update must fail');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnectionAudit" WHERE id = 'external-audit'`), 'immutable audit delete must fail');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnection" WHERE id = $1`, connectionId), 'referenced connection delete must fail');

  await mustReject(() => db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnection" (id, key, "displayName") VALUES ('rolled-back', 'rolled_back', 'Rollback')`);
    await tx.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ('rolled-back-revision', 'missing-connection', 1, 'https://invalid.example.test', 'PLATFORM', 'NONE', 'upgrade-admin')`);
  }), 'failed transaction must roll back all rows');
  const rollbackRows = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM commerce."CommerceExternalConnection" WHERE id = 'rolled-back'`);
  assert.equal(rollbackRows[0].count, 0);

  console.log(`ARCH-020 external connections ${mode}: constraint, FK, immutability, and rollback cases passed`);
} finally {
  await db.$disconnect();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
