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

const sqlState = error => error?.meta?.code ?? error?.code ?? String(error?.message ?? '').match(/\b23\d{3}\b/)?.[0];

const mustReject = async (operation, expectedState, label) => {
  try {
    await operation();
  } catch (error) {
    assert.equal(sqlState(error), expectedState, `${label}: unexpected SQLSTATE`);
    return;
  }
  assert.fail(`${label}: operation unexpectedly succeeded`);
};

const createRevision = async (connectionId, id, revisionNumber) => {
  await db.$executeRawUnsafe(
    `INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ($1, $2, $3, 'https://revision.example.test', 'PLATFORM', 'NONE', 'upgrade-admin')`,
    id, connectionId, revisionNumber,
  );
};

const credentialInsert = (id, revisionId, shopId, nonce = '000000000000000000000000', authTag = '00000000000000000000000000000000', ciphertext = '01') => db.$executeRawUnsafe(
  `INSERT INTO commerce."CommerceExternalCredential" (id, "connectionRevisionId", "shopId", ciphertext, nonce, "authTag", "keyId", "updatedByAdminId") VALUES ($1, $2, $3, decode($4, 'hex'), decode($5, 'hex'), decode($6, 'hex'), 'key-1', 'upgrade-admin')`,
  id, revisionId, shopId, ciphertext, nonce, authTag,
);

const seedBaseline = async () => {
  await db.$executeRawUnsafe(`INSERT INTO commerce."Shop" (id, domain, "updatedAt") VALUES ('upgrade-shop', 'upgrade.example.test', CURRENT_TIMESTAMP)`);
  await db.$executeRawUnsafe(`INSERT INTO public."PlatformAdmin" (id, email, "updatedAt") VALUES ('upgrade-admin', 'upgrade@example.test', CURRENT_TIMESTAMP)`);
  if (mode !== 'upgrade') return null;

  await db.$executeRawUnsafe(`INSERT INTO whatsapp."Conversation" (id, type, "updatedAt") VALUES ('upgrade-conversation', 'PRODUCT_SUPPORT', CURRENT_TIMESTAMP)`);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceTool" (id, name, "displayName") VALUES ('legacy-tool', 'legacy_tool', 'Legacy Tool')`);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceToolRevision" (id, "toolId", "revisionNumber", "contractVersion", "createdByAdminId", "definitionVersion", definition) VALUES ('legacy-tool-revision', 'legacy-tool', 1, 'commerce.v1', 'upgrade-admin', '1.0.0', '{}'::jsonb)`);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceRelease" (id, "runnerCompatibility", "contractVersion", "responseContract", "responseContractHash", "createdByAdminId") VALUES ('legacy-release', 'runner-v1', 'commerce.v1', '{}'::jsonb, repeat('a', 64), 'upgrade-admin')`);
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceConversationGrant" (id, "shopId", "conversationId", "initialInboundVersion", "releaseId", "selectedCapabilityKeys", "grantedTools", "runnerVersion") VALUES ('legacy-grant', 'upgrade-shop', 'upgrade-conversation', 1, 'legacy-release', '["legacy.capability"]'::jsonb, '["legacy-tool"]'::jsonb, 'runner-v1')`);

  return {
    shop: await db.$queryRawUnsafe(`SELECT id, domain, "updatedAt" FROM commerce."Shop" WHERE id = 'upgrade-shop'`),
    admin: await db.$queryRawUnsafe(`SELECT id, email, "updatedAt" FROM public."PlatformAdmin" WHERE id = 'upgrade-admin'`),
    tool: await db.$queryRawUnsafe(`SELECT id, name, "displayName", enabled FROM commerce."CommerceTool" WHERE id = 'legacy-tool'`),
    toolRevision: await db.$queryRawUnsafe(`SELECT id, "toolId", "revisionNumber", "contractVersion", "definitionVersion", definition FROM commerce."CommerceToolRevision" WHERE id = 'legacy-tool-revision'`),
    grant: await db.$queryRawUnsafe(`SELECT id, "shopId", "conversationId", "releaseId", "selectedCapabilityKeys", "grantedTools", "runnerVersion" FROM commerce."CommerceConversationGrant" WHERE id = 'legacy-grant'`),
  };
};

try {
  const tablesBefore = await db.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  `);
  assert.equal(tablesBefore[0].count, 0, 'Target must be an empty disposable database');

  let baselineSnapshot;
  if (mode === 'upgrade') {
    scratch = mkdtempSync(join(tmpdir(), 'arch020-external-connections-'));
    cpSync(new URL('prisma/schema.prisma', root), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(new URL('prisma/migrations', root))) {
      if (name !== migration) cpSync(new URL(`prisma/migrations/${name}`, root), join(scratch, 'migrations', name), { recursive: true });
    }
    deploy(join(scratch, 'schema.prisma'));
    baselineSnapshot = await seedBaseline();
    deploy('prisma/schema.prisma');
    const after = {
      shop: await db.$queryRawUnsafe(`SELECT id, domain, "updatedAt" FROM commerce."Shop" WHERE id = 'upgrade-shop'`),
      admin: await db.$queryRawUnsafe(`SELECT id, email, "updatedAt" FROM public."PlatformAdmin" WHERE id = 'upgrade-admin'`),
      tool: await db.$queryRawUnsafe(`SELECT id, name, "displayName", enabled FROM commerce."CommerceTool" WHERE id = 'legacy-tool'`),
      toolRevision: await db.$queryRawUnsafe(`SELECT id, "toolId", "revisionNumber", "contractVersion", "definitionVersion", definition FROM commerce."CommerceToolRevision" WHERE id = 'legacy-tool-revision'`),
      grant: await db.$queryRawUnsafe(`SELECT id, "shopId", "conversationId", "releaseId", "selectedCapabilityKeys", "grantedTools", "runnerVersion" FROM commerce."CommerceConversationGrant" WHERE id = 'legacy-grant'`),
    };
    assert.deepEqual(after, baselineSnapshot, 'upgrade migration changed existing Shop/Admin/tool/grant rows');
    console.log('UPGRADE_PRESERVATION existing Shop/PlatformAdmin/tool/grant rows unchanged');
  } else {
    deploy('prisma/schema.prisma');
    await seedBaseline();
  }

  const connectionId = 'external-connection';
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnection" (id, key, "displayName") VALUES ($1, 'inventory_api', 'Inventory API')`, connectionId);
  await createRevision(connectionId, 'external-revision', 1);
  await credentialInsert('platform-credential', 'external-revision', null);
  await mustReject(() => credentialInsert('duplicate-platform', 'external-revision', null), '23505', 'duplicate platform credential');

  await createRevision(connectionId, 'nonce-revision', 2);
  await mustReject(() => credentialInsert('bad-nonce', 'nonce-revision', null, '00'), '23514', 'invalid nonce length');
  await createRevision(connectionId, 'shop-revision', 3);
  await credentialInsert('shop-credential', 'shop-revision', 'upgrade-shop');
  await mustReject(() => credentialInsert('duplicate-shop', 'shop-revision', 'upgrade-shop'), '23505', 'duplicate shop credential');
  await createRevision(connectionId, 'tag-revision', 4);
  await mustReject(() => credentialInsert('bad-tag', 'tag-revision', null, undefined, '00'), '23514', 'invalid auth tag length');
  await createRevision(connectionId, 'ciphertext-revision', 5);
  await mustReject(() => credentialInsert('bad-ciphertext', 'ciphertext-revision', null, undefined, undefined, ''), '23514', 'invalid ciphertext length');

  await mustReject(() => db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ('missing-admin-revision', $1, 90, 'https://invalid.example.test', 'PLATFORM', 'NONE', 'missing-admin')`, connectionId), '23503', 'missing admin foreign key');
  await createRevision(connectionId, 'missing-shop-revision', 6);
  await mustReject(() => credentialInsert('missing-shop-credential', 'missing-shop-revision', 'missing-shop'), '23503', 'missing shop foreign key');

  await createRevision(connectionId, 'immutable-revision', 7);
  await mustReject(() => db.$executeRawUnsafe(`UPDATE commerce."CommerceExternalConnectionRevision" SET origin = 'https://changed.example.test' WHERE id = 'immutable-revision'`), '23000', 'immutable revision update');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnectionRevision" WHERE id = 'immutable-revision'`), '23000', 'immutable revision delete');
  await db.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionAudit" (id, "actorAdminId", "operationId", action, "requestDigest", "connectionId", reason, result) VALUES ('external-audit', 'upgrade-admin', 'operation-1', 'CREATE_CONNECTION', repeat('a', 64), $1, 'created', '{}'::jsonb)`, connectionId);
  await mustReject(() => db.$executeRawUnsafe(`UPDATE commerce."CommerceExternalConnectionAudit" SET reason = 'changed' WHERE id = 'external-audit'`), '23000', 'immutable audit update');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnectionAudit" WHERE id = 'external-audit'`), '23000', 'immutable audit delete');
  await mustReject(() => db.$executeRawUnsafe(`DELETE FROM commerce."CommerceExternalConnection" WHERE id = $1`, connectionId), '23503', 'referenced connection delete');

  await mustReject(() => db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnection" (id, key, "displayName") VALUES ('rolled-back', 'rolled_back', 'Rollback')`);
    await tx.$executeRawUnsafe(`INSERT INTO commerce."CommerceExternalConnectionRevision" (id, "connectionId", "revisionNumber", origin, scope, "authMode", "createdByAdminId") VALUES ('rolled-back-revision', 'missing-connection', 1, 'https://invalid.example.test', 'PLATFORM', 'NONE', 'upgrade-admin')`);
  }), '23503', 'failed transaction must reject with foreign-key SQLSTATE');
  const rollbackRows = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM commerce."CommerceExternalConnection" WHERE id = 'rolled-back'`);
  assert.equal(rollbackRows[0].count, 0, 'failed transaction left a partial connection row');
  const rollbackRevisionRows = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM commerce."CommerceExternalConnectionRevision" WHERE id = 'rolled-back-revision'`);
  assert.equal(rollbackRevisionRows[0].count, 0, 'failed transaction left a partial revision row');

  console.log(`ARCH-020 external connections ${mode}: constraint, FK, immutability, preservation, and rollback cases passed`);
} finally {
  await db.$disconnect();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
