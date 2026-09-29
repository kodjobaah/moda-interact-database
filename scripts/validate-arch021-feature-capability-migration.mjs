import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex === -1 ? undefined : process.argv[modeIndex + 1];
assert.ok(mode === undefined || ['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');
const root = new URL('..', import.meta.url);
const migration = '20260929120000_arch021_feature_capability_simplification';
const migrationSql = readFileSync(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8');
const hash = 'a'.repeat(64);
const now = '2026-09-29T00:00:00.000Z';
const responseContract = {version: 'response.v1', instructions: 'Reply using supported facts.', detailsSchema: {type: 'object', properties: {}, required: [], additionalProperties: false}};
const responseHash = createHash('sha256').update(JSON.stringify(responseContract)).digest('hex');
const definition = {
  name: 'read_product', definitionVersion: '1.0.0', description: 'Read a product',
  inputSchema: {type: 'object', properties: {handle: {type: 'string'}}, additionalProperties: false},
  execution: {kind: 'POLICY_OPERATION', operation: 'shopify.searchProducts', operationVersion: '1.0.0', arguments: {query: {input: 'handle'}}},
  responseTemplate: {kind: 'text', text: '{{result.title}}', unavailable: 'Unknown'},
};

const quote = name => `"${name.replaceAll('"', '""')}"`;
const literal = value => {
  if (value === null) return 'NULL';
  if (Buffer.isBuffer(value)) return `decode('${value.toString('hex')}', 'hex')`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
};
const insertSql = (table, row) => `INSERT INTO ${table} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.values(row).map(literal).join(',')})`;
const c = name => `commerce.${quote(name)}`;
const b = name => `billing.${quote(name)}`;
const w = name => `whatsapp.${quote(name)}`;
const db = new PrismaClient();
let scratch;

const run = sql => db.$executeRawUnsafe(sql);
const query = sql => db.$queryRawUnsafe(sql);
const rejects = async (label, sql) => {
  await assert.rejects(() => run(sql), undefined, label);
  console.log(`PASS ${label}`);
};
const deploy = schema => {
  try {
    const output = execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schema], {cwd: root, encoding: 'utf8', env: process.env});
    console.log(output.replaceAll(process.env.DATABASE_URL, '[isolated test URL]'));
  } catch {
    throw new Error('Migration deploy failed; inspect the isolated database migration log.');
  }
};

function validateTarget() {
  assert.ok(process.env.DATABASE_URL, 'Explicit isolated DATABASE_URL required');
  let target;
  try { target = new URL(process.env.DATABASE_URL); } catch { throw new Error('Explicit isolated DATABASE_URL required'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL DATABASE_URL required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Local isolated target required');
  assert.equal(target.pathname, `/arch021_feature_capability_test_${mode}`, 'Refusing non-test/shared database name');
  assert.equal(target.search, '', 'Connection parameter overrides are not allowed');
  assert.equal(target.hash, '', 'URL fragments are not allowed');
  return target;
}

async function seedPreservedRows() {
  const rows = [
    [b('BillingPlan'), {id: 'billing-plan-1', shopifyPlanHandle: 'arch021_db_plan', name: 'Fixture plan', kind: 'FREE', updatedAt: now}],
    [b('Subscription'), {id: 'subscription-1', shopId: 'shop-1', planId: 'billing-plan-1', status: 'NO_CONTRACT', updatedAt: now}],
    [c('CommerceModelCatalogueEntry'), {id: 'model-1', provider: 'OPENAI', providerModelId: 'arch021-fixture-model', displayName: 'Fixture model', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1', updatedAt: now}],
    [c('CommercePromptTemplateCategory'), {id: 'category-1', slug: 'arch021-fixture', displayName: 'Fixture category', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1', updatedAt: now}],
    [c('CommercePromptTemplate'), {id: 'template-1', key: 'arch021_fixture', categoryId: 'category-1', displayName: 'Fixture template', createdByAdminId: 'admin-1', updatedByAdminId: 'admin-1', updatedAt: now}],
    [c('CommerceAgentPrompt'), {id: 'prompt-1', scope: 'PLATFORM'}],
    [c('CommerceAgentPromptRevision'), {id: 'prompt-revision-1', promptId: 'prompt-1', revisionNumber: 1, status: 'PUBLISHED', promptText: 'Preserved prompt', contentHash: hash, publishedAt: now, createdAt: now, updatedAt: now}],
    [c('CommerceAgentConfiguration'), {id: 'agent-configuration-1', environment: 'DEVELOPMENT', scope: 'PLATFORM', modelId: 'model-1', activePromptRevisionId: 'prompt-revision-1', updatedAt: now}],
    [c('CommerceExternalConnection'), {id: 'connection-1', key: 'arch021_fixture', displayName: 'Fixture connection', updatedAt: now}],
    [c('CommerceExternalConnectionRevision'), {id: 'connection-revision-1', connectionId: 'connection-1', revisionNumber: 1, origin: 'https://fixture.invalid', scope: 'PLATFORM', authMode: 'NONE', createdByAdminId: 'admin-1', createdAt: now}],
    [c('CommerceExternalCredential'), {id: 'credential-1', connectionRevisionId: 'connection-revision-1', shopId: 'shop-1', ciphertext: Buffer.from([1, 2, 3]), nonce: Buffer.alloc(12, 2), authTag: Buffer.alloc(16, 3), keyId: 'fixture-key', updatedByAdminId: 'admin-1', updatedAt: now}],
    [c('CommerceTool'), {id: 'tool-1', name: 'read_product', displayName: 'Read product', updatedAt: now}],
    [c('CommerceToolRevision'), {id: 'tool-revision-1', toolId: 'tool-1', revisionNumber: 1, status: 'PUBLISHED', contractVersion: 'commerce.v1', contentHash: hash, createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1', publishedAt: now, definitionVersion: '1.0.0', definition, createdAt: now, updatedAt: now}],
    [c('CommerceAuditEvent'), {id: 'tool-audit-1', actorAdminId: 'admin-1', action: 'PUBLISH_TOOL_REVISION', toolId: 'tool-1', toolRevisionId: 'tool-revision-1', reason: 'Preservation fixture'}],
  ];
  for (const [table, row] of rows) await run(insertSql(table, row));
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(insertSql(b('MerchantPricingPlan'), {id: 'merchant-plan-1', shopifyPlanHandle: 'arch021_db_merchant_plan', displayName: 'Fixture merchant plan', planKind: 'FREE', cataloguePosition: 0, includedRecoveryCredits: 0, allowancePeriod: 'LIFETIME', billingPeriod: 'EVERY_30_DAYS', recurringAmountMinor: 0, currency: 'USD', updatedAt: now}));
    const locales = ['cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant'];
    for (const [index, locale] of locales.entries()) {
      await tx.$executeRawUnsafe(insertSql(b('MerchantPricingPlanTranslation'), {id: `merchant-plan-translation-${index}`, merchantPricingPlanId: 'merchant-plan-1', locale, merchantDescription: `Preservation fixture ${index}`, createdAt: now, updatedAt: now}));
    }
  });
}

async function seedBaseRows() {
  for (const [table, row] of [
    [c('Shop'), {id: 'shop-1', domain: 'arch021-db.invalid', updatedAt: now}],
    ['public."PlatformAdmin"', {id: 'admin-1', email: 'arch021-db@example.invalid', role: 'SUPER_ADMIN', updatedAt: now}],
    [b('Feature'), {id: 'feature-1', key: 'arch021_fixture', displayName: 'Fixture feature', activationMode: 'MERCHANT_OPT_IN', updatedAt: now}],
  ]) await run(insertSql(table, row));
  await seedPreservedRows();
  for (const [table, row] of [
    [c('CheckoutRecovery'), {id: 'recovery-1', shopId: 'shop-1', checkoutToken: 'fixture-checkout', lastExternalActivityAt: now, updatedAt: now}],
    [w('Conversation'), {id: 'conversation-1', shopId: 'shop-1', checkoutRecoveryId: 'recovery-1', type: 'RECOVERY', inboundVersion: 2, updatedAt: now}],
  ]) await run(insertSql(table, row));
}

async function seedLegacyComposition() {
  const capabilities = [
    {id: 'cap-core', key: 'conversation_core', displayName: 'Core', selectionBinding: 'BASE'},
    {id: 'cap-a', key: 'feature_a', displayName: 'Feature A', selectionBinding: 'FEATURE', featureId: 'feature-1'},
    {id: 'cap-b', key: 'feature_b', displayName: 'Feature B', selectionBinding: 'FEATURE', featureId: 'feature-1'},
  ];
  for (const row of capabilities) await run(insertSql(c('CommerceCapability'), row));
  const toolBindings = [{toolId: 'tool-1', toolRevisionId: 'tool-revision-1'}];
  for (const [index, capability] of capabilities.entries()) {
    const id = `cap-revision-${index}`;
    await run(insertSql(c('CommerceCapabilityRevision'), {
      id, capabilityId: capability.id, revisionNumber: 1, status: 'PUBLISHED',
      contractVersion: 'commerce.v1', contentHash: hash, createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1',
      publishedAt: now, createdAt: now, promptTemplate: 'Legacy capability prompt', configuration: {},
      toolBindings: index === 0 ? [] : toolBindings,
    }));
  }
  await run(insertSql(c('CommerceRelease'), {id: 'release-1', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1', responseContract, responseContractHash: responseHash, createdByAdminId: 'admin-1', createdAt: now}));
  for (const [index, capability] of capabilities.entries()) await run(insertSql(c('CommerceReleaseCapability'), {releaseId: 'release-1', capabilityId: capability.id, capabilityRevisionId: `cap-revision-${index}`, position: index}));
  await run(insertSql(c('CommerceReleasePointer'), {environment: 'DEVELOPMENT', releaseId: 'release-1', updatedByAdminId: 'admin-1'}));
  await run(insertSql(c('CommerceAuditEvent'), {id: 'cap-audit-1', actorAdminId: 'admin-1', action: 'CREATE_CAPABILITY', capabilityId: 'cap-a', reason: 'Legacy composition fixture'}));
  await run(insertSql(c('CommerceAuditEvent'), {id: 'release-audit-1', actorAdminId: 'admin-1', action: 'CREATE_RELEASE', releaseId: 'release-1', reason: 'Legacy composition fixture'}));
  await run(insertSql(c('CommerceConversationGrant'), {
    id: 'grant-1', shopId: 'shop-1', conversationId: 'conversation-1', initialInboundVersion: 1,
    releaseId: 'release-1', selectedCapabilityKeys: ['conversation_core', 'feature_a', 'feature_b'],
    grantedTools: [{toolId: 'tool-1', toolRevisionId: 'tool-revision-1', toolName: 'read_product', definitionVersion: '1.0.0', capabilityKeys: ['feature_a', 'feature_b']}],
    runnerVersion: '1.0.0', createdAt: now,
  }));
}

const preservedTables = [
  'billing.Feature', 'billing.BillingPlan', 'billing.Subscription', 'billing.MerchantPricingPlan',
  'commerce.Shop', 'commerce.CheckoutRecovery', 'whatsapp.Conversation',
  'commerce.CommerceTool', 'commerce.CommerceToolRevision',
  'commerce.CommerceExternalConnection', 'commerce.CommerceExternalConnectionRevision', 'commerce.CommerceExternalCredential',
  'commerce.CommerceModelCatalogueEntry', 'commerce.CommercePromptTemplateCategory', 'commerce.CommercePromptTemplate',
  'commerce.CommerceAgentPrompt', 'commerce.CommerceAgentPromptRevision', 'commerce.CommerceAgentConfiguration',
];
const snapshot = async () => {
  const result = {};
  for (const table of preservedTables) {
    const [schema, name] = table.split('.');
    result[table] = (await query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\\n' ORDER BY to_jsonb(row_data)::text),'')) AS hash FROM ${quote(schema)}.${quote(name)} AS row_data`))[0];
  }
  return result;
};

async function assertOldCompositionCleared() {
  for (const [table, expected] of [['CommerceCapability', 0], ['CommerceRelease', 0], ['CommerceReleasePointer', 0], ['CommerceConversationGrant', 0]]) {
    const actual = await query(`SELECT count(*)::int AS n FROM ${c(table)}`);
    assert.equal(actual[0].n, expected, `${table} legacy composition should be empty`);
  }
  assert.equal((await query(`SELECT to_regclass('commerce."CommerceCapabilityRevision"')::text AS name`))[0].name, null, 'Capability revision table must be removed');
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${c('CommerceAuditEvent')} WHERE id IN ('cap-audit-1','release-audit-1')`))[0].n, 0);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${c('CommerceAuditEvent')} WHERE id='tool-audit-1' AND action='PUBLISH_TOOL_REVISION'`))[0].n, 1);
  assert.equal((await query(`SELECT status::text AS status FROM ${c('CommerceToolRevision')} WHERE id='tool-revision-1'`))[0].status, 'PUBLISHED');
}

async function exerciseNewContract() {
  await run(insertSql(c('CommerceFeatureConfiguration'), {featureId: 'feature-1', behaviourPrompt: '', editVersion: 0, createdAt: now, updatedAt: now}));
  assert.equal((await query(`SELECT "behaviourPrompt" FROM ${c('CommerceFeatureConfiguration')} WHERE "featureId"='feature-1'`))[0].behaviourPrompt, '', 'Empty current Feature prompt is valid');
  await rejects('Feature behaviour CAS requires a one-step editVersion', `UPDATE ${c('CommerceFeatureConfiguration')} SET "behaviourPrompt"='stale write' WHERE "featureId"='feature-1'`);
  await run(`UPDATE ${c('CommerceFeatureConfiguration')} SET "behaviourPrompt"='Updated feature guidance', "editVersion"=1 WHERE "featureId"='feature-1'`);
  await rejects('Feature behaviour configuration cannot be deleted', `DELETE FROM ${c('CommerceFeatureConfiguration')} WHERE "featureId"='feature-1'`);
  await run(insertSql(c('CommerceAuditEvent'), {id: 'feature-audit-1', actorAdminId: 'admin-1', action: 'UPDATE_FEATURE_BEHAVIOUR', featureId: 'feature-1', reason: 'Feature behaviour fixture'}));

  for (const [id, key] of [['cap-one', 'capability_one'], ['cap-two', 'capability_two']]) {
    await run(insertSql(c('CommerceCapability'), {id, key, displayName: key, featureId: 'feature-1', toolId: 'tool-1', enabled: true, createdAt: now, updatedAt: now}));
  }
  await rejects('Capability Feature and Tool identities are immutable', `UPDATE ${c('CommerceCapability')} SET "toolId"='tool-2' WHERE id='cap-one'`);

  await run(insertSql(c('CommerceRelease'), {id: 'release-new', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1', responseContract, responseContractHash: responseHash, createdByAdminId: 'admin-1', createdAt: now}));
  await run(insertSql(c('CommerceReleaseFeature'), {releaseId: 'release-new', featureId: 'feature-1', behaviourPrompt: 'Updated feature guidance', createdAt: now}));
  for (const [index, capabilityId] of ['cap-one', 'cap-two'].entries()) {
    await run(insertSql(c('CommerceReleaseCapability'), {releaseId: 'release-new', capabilityId, featureId: 'feature-1', toolId: 'tool-1', toolRevisionId: 'tool-revision-1', position: index}));
  }
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${c('CommerceReleaseFeature')} WHERE "releaseId"='release-new'`))[0].n, 1, 'Capabilities of the same Feature share one release snapshot');
  await rejects('Release Feature snapshot is immutable', `UPDATE ${c('CommerceReleaseFeature')} SET "behaviourPrompt"='changed' WHERE "releaseId"='release-new'`);
  await rejects('Release Feature snapshot cannot be deleted', `DELETE FROM ${c('CommerceReleaseFeature')} WHERE "releaseId"='release-new'`);
  await rejects('Release Capability membership cannot be updated', `UPDATE ${c('CommerceReleaseCapability')} SET "position"=3 WHERE "releaseId"='release-new' AND "capabilityId"='cap-one'`);
  await rejects('Release Capability membership is immutable', `DELETE FROM ${c('CommerceReleaseCapability')} WHERE "releaseId"='release-new' AND "capabilityId"='cap-one'`);

  await run(insertSql(c('CommerceRelease'), {id: 'release-bad-snapshot', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1', responseContract, responseContractHash: responseHash, createdByAdminId: 'admin-1', createdAt: now}));
  await rejects('Release Feature snapshot must capture the current prompt', insertSql(c('CommerceReleaseFeature'), {releaseId: 'release-bad-snapshot', featureId: 'feature-1', behaviourPrompt: 'stale guidance', createdAt: now}));

  await run(insertSql(c('CommerceTool'), {id: 'tool-2', name: 'other_tool', displayName: 'Other tool', updatedAt: now}));
  const otherDefinition = {...definition, name: 'other_tool'};
  await run(insertSql(c('CommerceToolRevision'), {id: 'tool-revision-2', toolId: 'tool-2', revisionNumber: 1, status: 'PUBLISHED', contractVersion: 'commerce.v1', contentHash: hash, createdByAdminId: 'admin-1', publishedByAdminId: 'admin-1', publishedAt: now, definitionVersion: '1.0.0', definition: otherDefinition, createdAt: now, updatedAt: now}));
  await run(insertSql(c('CommerceRelease'), {id: 'release-wrong-tool', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1', responseContract, responseContractHash: responseHash, createdByAdminId: 'admin-1', createdAt: now}));
  await run(insertSql(c('CommerceReleaseFeature'), {releaseId: 'release-wrong-tool', featureId: 'feature-1', behaviourPrompt: 'Updated feature guidance', createdAt: now}));
  await rejects('Release member cannot pair Capability and another Tool', insertSql(c('CommerceReleaseCapability'), {releaseId: 'release-wrong-tool', capabilityId: 'cap-one', featureId: 'feature-1', toolId: 'tool-2', toolRevisionId: 'tool-revision-2', position: 0}));

  await run(insertSql(c('CommerceToolRevision'), {id: 'tool-revision-draft', toolId: 'tool-1', revisionNumber: 2, status: 'DRAFT', contractVersion: 'commerce.v1', createdByAdminId: 'admin-1', definitionVersion: '1.1.0', definition: {...definition, definitionVersion: '1.1.0'}, createdAt: now, updatedAt: now}));
  await run(insertSql(c('CommerceRelease'), {id: 'release-draft-tool', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1', responseContract, responseContractHash: responseHash, createdByAdminId: 'admin-1', createdAt: now}));
  await run(insertSql(c('CommerceReleaseFeature'), {releaseId: 'release-draft-tool', featureId: 'feature-1', behaviourPrompt: 'Updated feature guidance', createdAt: now}));
  await rejects('Release member requires a published Tool revision', insertSql(c('CommerceReleaseCapability'), {releaseId: 'release-draft-tool', capabilityId: 'cap-one', featureId: 'feature-1', toolId: 'tool-1', toolRevisionId: 'tool-revision-draft', position: 0}));

  const types = await query(`SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='commerce' AND typname IN ('CommerceToolRevisionStatus','CommerceCapabilityRevisionStatus','CommerceCapabilitySelectionBinding') ORDER BY typname`);
  assert.deepEqual(types.map(row => row.typname), ['CommerceToolRevisionStatus']);
  const actions = await query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='CommerceAuditAction'`);
  const labels = actions.map(row => row.enumlabel);
  for (const old of ['CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH_REVISION']) assert.ok(!labels.includes(old));
  for (const kept of ['CREATE_CAPABILITY', 'UPDATE_CAPABILITY', 'ENABLE_CAPABILITY', 'DISABLE_CAPABILITY', 'UPDATE_FEATURE_BEHAVIOUR', 'CREATE_TOOL_DRAFT', 'UPDATE_TOOL_DRAFT', 'PUBLISH_TOOL_REVISION']) assert.ok(labels.includes(kept));
}

async function main() {
  if (mode === undefined) {
    assert.match(migrationSql, /DROP TABLE commerce\."CommerceCapabilityRevision"/);
    assert.match(migrationSql, /CommerceReleaseCapability_toolRevisionId_toolId_fkey/);
    console.log('ARCH-021 feature-capability migration structural checks passed. Use --mode fresh|upgrade for PostgreSQL rehearsal.');
    return;
  }
  const target = validateTarget();
  const tables = await query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
  assert.equal(tables[0].n, 0, 'Target must be empty; refusing reset/reuse');
  console.log(`ISOLATION ${target.hostname} ${target.pathname.slice(1)} empty database; mode=${mode}`);
  if (mode === 'upgrade') {
    scratch = mkdtempSync(join(tmpdir(), 'arch021-feature-capability-predecessor-'));
    const schema = join(scratch, 'schema.prisma');
    cpSync(new URL('prisma/schema.prisma', root), schema);
    const migrationDirectory = new URL('prisma/migrations/', root);
    const targetMigrations = join(scratch, 'migrations');
    mkdirSync(targetMigrations);
    for (const name of readdirSync(migrationDirectory)) if (name !== migration) cpSync(new URL(`prisma/migrations/${name}`, root), join(targetMigrations, name), {recursive: true});
    deploy(schema);
    await seedBaseRows();
    await seedLegacyComposition();
    const before = await snapshot();
    for (const [table, row] of Object.entries(before)) assert.ok(row.count > 0, `${table} must be seeded before migration`);
    deploy('prisma/schema.prisma');
    assert.deepEqual(await snapshot(), before, 'Protected records changed during the upgrade');
    console.log(`PRESERVED ${Object.keys(before).length} seeded durable data tables unchanged`);
  } else {
    deploy('prisma/schema.prisma');
    await seedBaseRows();
  }
  await assertOldCompositionCleared();
  await exerciseNewContract();
  console.log(`ARCH-021 feature-capability ${mode}: PostgreSQL migration rehearsal passed.`);
}

try { await main(); }
finally {
  await db.$disconnect();
  if (scratch) rmSync(scratch, {recursive: true, force: true});
}