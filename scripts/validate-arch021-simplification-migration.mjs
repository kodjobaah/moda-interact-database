import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex === -1 ? undefined : process.argv[modeIndex + 1];
assert.ok(mode === undefined || ['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');
let target;
if (mode !== undefined) {
  assert.ok(process.env.DATABASE_URL, 'Explicit isolated DATABASE_URL required');
  try { target = new URL(process.env.DATABASE_URL); } catch { throw new Error('Explicit isolated DATABASE_URL required'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL DATABASE_URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Local isolated target required');
  assert.equal(target.pathname, `/arch021_simplification_test_${mode}`, 'Refusing non-test/shared database name');
  assert.equal(target.search, '', 'Connection parameter overrides are not allowed');
  assert.equal(target.hash, '', 'URL fragments are not allowed');
}

const root = new URL('..', import.meta.url);
const migration = '20260924103000_arch021_simplify_agent_configuration';
const migrationPath = `prisma/migrations/${migration}/migration.sql`;
const migrationSql = readFileSync(new URL(`../${migrationPath}`, import.meta.url), 'utf8');
const db = new PrismaClient();
const c = name => `commerce."${name}"`;
const tableRef = name => name === 'PlatformAdmin' ? 'public."PlatformAdmin"' : c(name);
const lit = value => value === null ? 'NULL' : typeof value === 'boolean' ? String(value) : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table, row) => `INSERT INTO ${tableRef(table)} (${Object.keys(row).map(key => `"${key}"`).join(',')}) VALUES (${Object.values(row).map(lit).join(',')})`;
const now = '2026-09-24T00:00:00.000Z';
const hash = 'a'.repeat(64);

function preflight() {
  const position = text => { const value = migrationSql.indexOf(text); assert.notEqual(value, -1, `${text} missing`); return value; };
  const firstDrop = position('DROP TABLE "commerce"."CommercePlatformModelSelection"');
  assert.ok(position('CREATE TABLE "commerce"."CommerceAgentConfiguration"') < position('INSERT INTO "commerce"."CommerceAgentConfiguration"'));
  assert.ok(position('CREATE TABLE "commerce"."CommerceStudioMerchantAccess"') < position('UPDATE "commerce"."CommerceAuditEvent"'));
  for (const text of ['UPDATE "commerce"."CommercePromptTemplate" AS template', 'UPDATE "commerce"."CommerceAgentPromptRevision" AS revision', 'UPDATE "commerce"."CommerceAuditEvent"']) assert.ok(position(text) < firstDrop);
  assert.match(migrationSql, /FULL OUTER JOIN "commerce"\."CommerceShopPromptPointer"/);
  assert.match(migrationSql, /ORDER BY revision\."revisionNumber" DESC/);
  assert.match(migrationSql, /status" = 'PUBLISHED'/);
  assert.match(migrationSql, /operationId" = "id"/);
  for (const table of ['CommercePlatformModelSelection', 'CommerceShopModelSelection', 'CommercePlatformPromptPointer', 'CommerceShopPromptPointer', 'CommercePromptTemplateRevision']) assert.equal((migrationSql.match(new RegExp(`DROP TABLE "commerce"\."${table}"`, 'g')) || []).length, 1);
  assert.doesNotMatch(migrationSql, /DROP TABLE "commerce"\."(CommerceModelCatalogueEntry|CommercePromptTemplateCategory|CommercePromptTemplate|CommerceAgentPrompt|CommerceAgentPromptRevision|CommerceAuditEvent)"/);
  assert.match(migrationSql, /CommerceAgentConfiguration_guard_trigger/);
  assert.match(migrationSql, /CommerceStudioMerchantAccess_identity_guard_trigger/);
  assert.match(migrationSql, /OLD\."providerSubject" IS NOT NULL/);
  assert.match(migrationSql, /NEW\."providerSubject" IS NULL OR NEW\."providerSubject" IS DISTINCT FROM OLD\."providerSubject"/);
}

const deploy = schema => {
  try {
    const output = execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schema], {cwd: root, encoding: 'utf8', env: process.env});
    console.log(output.replaceAll(process.env.DATABASE_URL, '[isolated test URL]'));
  } catch { throw new Error('Migration deploy failed; inspect the isolated database migration log'); }
};
const run = sql => db.$executeRawUnsafe(sql);
const query = sql => db.$queryRawUnsafe(sql);
const rejects = async (name, sql) => { await assert.rejects(() => db.$transaction(tx => tx.$executeRawUnsafe(sql)), undefined, name); console.log(`PASS ${name}`); };

async function seedPredecessor() {
  for (const [table, row] of [
    ['Shop', {id: 'shop-1', domain: 'arch021.invalid', updatedAt: now}],
    ['PlatformAdmin', {id: 'admin-1', email: 'arch021@example.invalid', role: 'SUPER_ADMIN', updatedAt: now}],
    ['CommerceModelCatalogueEntry', {id: 'model-1', provider: 'OPENAI', providerModelId: 'gpt-arch021', displayName: 'Fixture model', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommercePromptTemplateCategory', {id: 'category-1', slug: 'checkout', displayName: 'Checkout', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommercePromptTemplate', {id: 'template-1', key: 'checkout_greeting', categoryId: 'category-1', displayName: 'Greeting', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommercePromptTemplateRevision', {id: 'template-1-r1', templateId: 'template-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Published template text', contentHash: hash, createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1', publishedAt: now}],
    ['CommercePromptTemplateRevision', {id: 'template-1-r2', templateId: 'template-1', revisionNumber: 2, promptText: 'Draft template text', createdByAdminId: 'admin-1'}],
    ['CommerceAgentPrompt', {id: 'platform-prompt-1', scope: 'PLATFORM', createdByAdminId: 'admin-1'}],
    ['CommerceAgentPrompt', {id: 'shop-prompt-1', scope: 'SHOP', shopId: 'shop-1', createdByAdminId: 'admin-1'}],
    ['CommerceAgentPromptRevision', {id: 'platform-revision-1', promptId: 'platform-prompt-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Platform prompt', contentHash: hash, sourceTemplateRevisionId: 'template-1-r1', createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1', publishedAt: now}],
    ['CommerceAgentPromptRevision', {id: 'shop-revision-1', promptId: 'shop-prompt-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Shop prompt', contentHash: hash, createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1', publishedAt: now}],
    ['CommercePlatformModelSelection', {environment: 'DEVELOPMENT', modelId: 'model-1', editVersion: 4, updatedByAdminId: 'admin-1'}],
    ['CommerceShopModelSelection', {environment: 'DEVELOPMENT', shopId: 'shop-1', modelId: 'model-1', generationId: 'model-generation-1', editVersion: 5, updatedByAdminId: 'admin-1'}],
    ['CommercePlatformPromptPointer', {environment: 'DEVELOPMENT', promptId: 'platform-prompt-1', promptRevisionId: 'platform-revision-1', editVersion: 6, updatedByAdminId: 'admin-1'}],
    ['CommerceShopPromptPointer', {environment: 'DEVELOPMENT', shopId: 'shop-1', promptId: 'shop-prompt-1', promptRevisionId: 'shop-revision-1', generationId: 'prompt-generation-1', editVersion: 7, updatedByAdminId: 'admin-1'}],
    ['CommerceAuditEvent', {id: 'audit-1', actorAdminId: 'admin-1', action: 'CREATE_MODEL_CATALOGUE_ENTRY', modelCatalogueEntryId: 'model-1', environment: 'DEVELOPMENT', reason: 'fixture'}],
  ]) await run(insert(table, row));
}

async function seedFinal() {
  for (const [table, row] of [
    ['Shop', {id: 'shop-1', domain: 'arch021.invalid', updatedAt: now}],
    ['PlatformAdmin', {id: 'admin-1', email: 'arch021@example.invalid', role: 'SUPER_ADMIN', updatedAt: now}],
    ['CommerceModelCatalogueEntry', {id: 'model-1', provider: 'OPENAI', providerModelId: 'gpt-arch021', displayName: 'Fixture model', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommercePromptTemplateCategory', {id: 'category-1', slug: 'checkout', displayName: 'Checkout', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommercePromptTemplate', {id: 'template-1', key: 'checkout_greeting', categoryId: 'category-1', displayName: 'Greeting', promptText: 'Published template text', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1'}],
    ['CommerceAgentPrompt', {id: 'platform-prompt-1', scope: 'PLATFORM'}],
    ['CommerceAgentPrompt', {id: 'shop-prompt-1', scope: 'SHOP', shopId: 'shop-1'}],
    ['CommerceAgentPromptRevision', {id: 'platform-revision-1', promptId: 'platform-prompt-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Platform prompt', contentHash: hash, sourceTemplateId: 'template-1', publishedAt: now}],
    ['CommerceAgentPromptRevision', {id: 'shop-revision-1', promptId: 'shop-prompt-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Shop prompt', contentHash: hash, publishedAt: now}],
    ['CommerceAgentConfiguration', {id: 'platform-config-1', environment: 'DEVELOPMENT', scope: 'PLATFORM', modelId: 'model-1', activePromptRevisionId: 'platform-revision-1'}],
    ['CommerceAgentConfiguration', {id: 'shop-config-1', environment: 'DEVELOPMENT', scope: 'SHOP', shopId: 'shop-1', modelId: 'model-1', activePromptRevisionId: 'shop-revision-1'}],
    ['CommerceStudioMerchantAccess', {id: 'access-1', shopId: 'shop-1', email: 'merchant@example.invalid', providerSubject: 'provider-subject-1', createdByPlatformAdminId: 'admin-1'}],
    ['CommerceAuditEvent', {id: 'audit-1', actorAdminId: 'admin-1', action: 'UPSERT_AGENT_CONFIGURATION', agentConfigurationId: 'platform-config-1', environment: 'DEVELOPMENT', operationId: 'audit-1', reason: 'fixture'}],
  ]) await run(insert(table, row));
}

async function assertFinalSchema() {
  const oldTables = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema='commerce' AND table_name IN ('CommercePlatformModelSelection','CommerceShopModelSelection','CommercePlatformPromptPointer','CommerceShopPromptPointer','CommercePromptTemplateRevision')`);
  assert.equal(oldTables.length, 0, 'obsolete Phase-2 tables must be absent');
  for (const table of ['CommerceAgentConfiguration', 'CommerceStudioMerchantAccess', 'CommercePromptTemplate', 'CommerceAgentPromptRevision']) assert.equal((await query(`SELECT to_regclass(${lit(`commerce."${table}"`)})::text AS name`))[0].name, `commerce."${table}"`);
  const configurations = await query(`SELECT "scope","shopId","modelId","activePromptRevisionId","modelEditVersion","promptEditVersion" FROM ${c('CommerceAgentConfiguration')} ORDER BY "scope"`);
  if (mode === 'upgrade') assert.deepEqual(configurations, [{scope: 'PLATFORM', shopId: null, modelId: 'model-1', activePromptRevisionId: 'platform-revision-1', modelEditVersion: 4, promptEditVersion: 6}, {scope: 'SHOP', shopId: 'shop-1', modelId: 'model-1', activePromptRevisionId: 'shop-revision-1', modelEditVersion: 5, promptEditVersion: 7}]);
  assert.equal((await query(`SELECT "promptText" FROM ${c('CommercePromptTemplate')} WHERE id='template-1'`))[0].promptText, 'Published template text');
  assert.equal((await query(`SELECT "sourceTemplateId" FROM ${c('CommerceAgentPromptRevision')} WHERE id='platform-revision-1'`))[0].sourceTemplateId, 'template-1');
  assert.equal((await query(`SELECT "operationId" FROM ${c('CommerceAuditEvent')} WHERE id='audit-1'`))[0].operationId, 'audit-1');
  await rejects('prompt configuration scope guard', insert('CommerceAgentConfiguration', {id: 'bad-config', environment: 'TEST', scope: 'PLATFORM', activePromptRevisionId: 'shop-revision-1'}));
  await run(insert('CommerceAgentPromptRevision', {id: 'draft-revision', promptId: 'platform-prompt-1', revisionNumber: 2, promptText: 'Draft'}));
  await rejects('prompt configuration published guard', insert('CommerceAgentConfiguration', {id: 'draft-config', environment: 'TEST', scope: 'PLATFORM', activePromptRevisionId: 'draft-revision'}));
  await rejects('merchant provider identity guard', `UPDATE ${c('CommerceStudioMerchantAccess')} SET "providerSubject"='changed' WHERE id='access-1'`);
  await rejects('merchant provider nonblank guard', insert('CommerceStudioMerchantAccess', {id: 'access-empty', shopId: 'shop-1', email: 'other@example.invalid', providerSubject: '   ', createdByPlatformAdminId: 'admin-1'}));
  await rejects('audit UPDATE immutability', `UPDATE ${c('CommerceAuditEvent')} SET reason='changed' WHERE id='audit-1'`);
  await rejects('audit DELETE immutability', `DELETE FROM ${c('CommerceAuditEvent')} WHERE id='audit-1'`);
}

preflight();
if (mode === undefined) {
  console.log('ARCH-021 simplification migration structural checks passed. Use --mode fresh|upgrade for executable rehearsal.');
  process.exit(0);
}
let scratch;
try {
  const empty = await query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
  assert.equal(empty[0].n, 0, 'Target must be empty; refusing reset/reuse');
  console.log(`ISOLATION ${target.hostname} ${target.pathname.slice(1)} empty database; mode=${mode}`);
  if (mode === 'upgrade') {
    scratch = mkdtempSync(join(tmpdir(), 'arch021-simplification-predecessor-'));
    const schema = join(scratch, 'schema.prisma');
    cpSync(new URL('prisma/schema.prisma', root), schema);
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(new URL('prisma/migrations', root))) if (name !== migration) cpSync(new URL(`prisma/migrations/${name}`, root), join(scratch, 'migrations', name), {recursive: true});
    deploy(schema);
    await seedPredecessor();
    await rejects('pre-simplification audit UPDATE immutability', `UPDATE ${c('CommerceAuditEvent')} SET reason='changed' WHERE id='audit-1'`);
    await rejects('pre-simplification audit DELETE immutability', `DELETE FROM ${c('CommerceAuditEvent')} WHERE id='audit-1'`);
  }
  deploy('prisma/schema.prisma');
  if (mode === 'fresh') await seedFinal();
  if (mode === 'upgrade') await run(insert('CommerceStudioMerchantAccess', {id: 'access-1', shopId: 'shop-1', email: 'merchant@example.invalid', providerSubject: 'provider-subject-1', createdByPlatformAdminId: 'admin-1'}));
  await assertFinalSchema();
  console.log(`ARCH-021 simplification ${mode}: executable rehearsal passed.`);
} finally {
  await db.$disconnect();
  if (scratch) rmSync(scratch, {recursive: true, force: true});
}
