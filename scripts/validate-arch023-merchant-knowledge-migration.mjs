import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { validateMigrationContract } from './fixtures/arch023-merchant-knowledge-migration-contract.mjs';
import { runArch023Cases, seedArch023Cases, verifyConfigurationDefaultsAndRoundTrip } from './fixtures/arch023-merchant-knowledge-cases.mjs';

const root = new URL('..', import.meta.url);
const migrationName = '20260929160000_arch023_merchant_knowledge_schema';
const migration = readFileSync(process.env.ARCH023_MIGRATION_PATH ?? new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url), 'utf8');
const requiredTables = [
  'CommerceStoreCategoryTaxonomyMapping',
  'CommerceShopProfile',
  'MerchantKnowledgePurpose',
  'MerchantKnowledgeDataFormat',
  'MerchantKnowledgePurposeDataFormat',
  'MerchantKnowledgeUploadedAsset',
  'MerchantKnowledgeSource',
  'MerchantKnowledgeSourceRevision',
  'MerchantKnowledgeChunk',
];
const requiredEnums = [
  'MerchantKnowledgeInputKind',
  'MerchantKnowledgeRevisionReason',
  'MerchantKnowledgeRevisionStatus',
  'MerchantKnowledgeUploadedAssetStatus',
];
const checks = [
  'CommerceStoreCategoryTaxonomyMapping_weight_positive',
  'CommerceShopProfile_pending_generation_nonnegative',
  'CommerceShopProfile_pending_tuple_check',
  'CommerceShopProfile_active_category_timestamp_check',
  'MerchantKnowledgeUploadedAsset_available_fields_check',
  'MerchantKnowledgeSource_position_nonnegative',
  'MerchantKnowledgeSource_generation_nonnegative',
  'MerchantKnowledgeSourceRevision_locator_check',
  'MerchantKnowledgeSourceRevision_resolved_url_check',
  'MerchantKnowledgeSourceRevision_generation_positive',
  'MerchantKnowledgeSourceRevision_active_content_check',
  'MerchantKnowledgeChunk_ordinal_nonnegative',
  'MerchantKnowledgeChunk_content_units_positive',
  'MerchantKnowledgeChunk_embedding_dimensions_positive',
  'MerchantKnowledgeChunk_embedding_dimensions_match',
  'MerchantKnowledgeChunk_content_hash_check',
];
const identifiers = [...requiredTables, ...requiredEnums, ...checks];
for (const identifier of identifiers) {
  assert.ok(migration.includes(identifier), `${identifier} missing from migration`);
}
assert.match(migration, /CREATE EXTENSION IF NOT EXISTS vector\s*;/i);
assert.match(migration, /ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
assert.equal((migration.match(/ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '\{\}'::jsonb/g) ?? []).length, 2);
assert.match(migration, /ADD COLUMN "defaultTemplateId" TEXT/);
assert.match(migration, /ADD COLUMN "sourceTemplateEditVersion" INTEGER/);
assert.match(migration, /CommercePromptTemplateCategory_defaultTemplate_fkey[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT/);
assert.match(migration, /FOREIGN KEY \("purposeId", "dataFormatId"\) REFERENCES "commerce"\."MerchantKnowledgePurposeDataFormat"\("purposeId", "dataFormatId"\) ON DELETE RESTRICT ON UPDATE RESTRICT/);
assert.match(migration, /CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_one_active_per_source"[\s\S]*?WHERE "status" = 'ACTIVE'/);
assert.match(migration, /vector_dims\("embedding"\) = "embeddingDimensions"/);

const purposeSeed = migration.match(/INSERT INTO "commerce"\."MerchantKnowledgePurpose"[\s\S]*?ON CONFLICT \("key"\) DO NOTHING;/)?.[0];
assert.ok(purposeSeed, 'Purpose key-conflict seed missing');
const purposeRows = [...purposeSeed.matchAll(/\('([^']+)', '([A-Z_]+)', '([^']+)', true, (\d+)\)/g)].map(match => match.slice(1));
assert.deepEqual(purposeRows, [
  ['mk-purpose-company-information', 'COMPANY_INFORMATION', 'Company information', '10'],
  ['mk-purpose-customer-support', 'CUSTOMER_SUPPORT', 'Customer support', '20'],
  ['mk-purpose-policies', 'POLICIES', 'Policies', '30'],
  ['mk-purpose-faq', 'FAQ', 'FAQ', '40'],
  ['mk-purpose-product-information', 'PRODUCT_INFORMATION', 'Product information', '50'],
  ['mk-purpose-shipping-and-delivery', 'SHIPPING_AND_DELIVERY', 'Shipping and delivery', '60'],
  ['mk-purpose-pricing', 'PRICING', 'Pricing', '70'],
]);

const formatSeed = migration.match(/INSERT INTO "commerce"\."MerchantKnowledgeDataFormat"[\s\S]*?ON CONFLICT \("key"\) DO NOTHING;/)?.[0];
assert.ok(formatSeed, 'Data Format key-conflict seed missing');
for (const key of ['WEB_PAGE', 'CSV', 'XLSX']) assert.ok(formatSeed.includes(`'${key}'`), `${key} seed missing`);
assert.match(formatSeed, /'mk-format-web-page', 'WEB_PAGE', 'Web page', 'REMOTE_URL', NULL, '\["text\/html","text\/plain"\]'::jsonb, true, 10/);
assert.match(formatSeed, /'mk-format-csv', 'CSV', 'CSV spreadsheet', 'UPLOAD', '\.csv', '\["text\/csv","application\/csv"\]'::jsonb, true, 20/);
assert.match(formatSeed, /'mk-format-xlsx', 'XLSX', 'Excel spreadsheet \(\.xlsx\)', 'UPLOAD', '\.xlsx', '\["application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"\]'::jsonb, true, 30/);

const pairsSeed = migration.match(/INSERT INTO "commerce"\."MerchantKnowledgePurposeDataFormat"[\s\S]*?ON CONFLICT \("purposeId", "dataFormatId"\) DO NOTHING;/)?.[0];
assert.ok(pairsSeed, 'Purpose/Data Format pair seed missing');
const pairRows = [...pairsSeed.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map(match => match.slice(1));
assert.deepEqual(pairRows, [
  ['COMPANY_INFORMATION', 'WEB_PAGE'],
  ['CUSTOMER_SUPPORT', 'WEB_PAGE'],
  ['POLICIES', 'WEB_PAGE'],
  ['FAQ', 'WEB_PAGE'],
  ['PRODUCT_INFORMATION', 'WEB_PAGE'],
  ['PRODUCT_INFORMATION', 'CSV'],
  ['PRODUCT_INFORMATION', 'XLSX'],
  ['SHIPPING_AND_DELIVERY', 'WEB_PAGE'],
  ['PRICING', 'WEB_PAGE'],
  ['PRICING', 'CSV'],
  ['PRICING', 'XLSX'],
]);

assert.doesNotMatch(migration, /USING\s+(?:hnsw|ivfflat)|\b(?:HNSW|IVFFLAT)\b/i, 'ANN indexes are out of scope');
assert.doesNotMatch(migration, /CREATE\s+TRIGGER|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i, 'ARCH-023 must not add triggers/functions');
const insertTargets = [...migration.matchAll(/^INSERT INTO "([^"]+)"\."([^"]+)"/gm)].map(match => `${match[1]}.${match[2]}`);
assert.deepEqual(insertTargets, [
  'commerce.MerchantKnowledgePurpose',
  'commerce.MerchantKnowledgeDataFormat',
  'commerce.MerchantKnowledgePurposeDataFormat',
]);
assert.doesNotMatch(migration, /'merchant_knowledge'/i, 'Do not seed a Merchant Knowledge Feature, plan, Capability, Tool, or Release');
assert.doesNotMatch(migration, /DROP\s+(?:TABLE|SCHEMA|COLUMN)|TRUNCATE\s+TABLE/i, 'Migration must be additive');
validateMigrationContract(migration);

console.log('ARCH-023 migration exact static contract passed.');

const modePosition = process.argv.indexOf('--mode');
if (modePosition === -1) process.exit(0);
const mode = process.argv[modePosition + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');
let target;
try {
  target = new URL(process.env.DATABASE_URL ?? '');
} catch {
  throw new Error('Explicit isolated DATABASE_URL required');
}
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL URL required');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Local isolated target required');
assert.equal(target.pathname, `/arch023_test_${mode}`, 'Refusing non-test/shared database name');
assert.equal(target.search, '', 'Connection parameter overrides are not allowed');
assert.equal(target.hash, '', 'URL fragments are not allowed');

const db = new PrismaClient();
let scratch;
const redact = output => output.replaceAll(process.env.DATABASE_URL, '[isolated test URL]');
const migrate = schema => {
  try {
    const output = execFileSync('node', [new URL('../node_modules/prisma/build/index.js', import.meta.url).pathname, 'migrate', 'deploy', '--schema', schema], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
    });
    console.log(redact(output));
  } catch {
    throw new Error(`Migration deploy failed in ${mode} rehearsal; inspect the disposable database migration log`);
  }
};
const snapshot = async tables => {
  const result = {};
  for (const {table_schema: schema, table_name: table} of tables) {
    const qualified = `"${schema.replaceAll('"', '""')}"."${table.replaceAll('"', '""')}"`;
    result[`${schema}.${table}`] = (await db.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\\n' ORDER BY to_jsonb(row_data)::text), '')) AS hash FROM ${qualified} AS row_data`))[0];
  }
  return result;
};
const modifiedTableSnapshots = async () => ({
  billingPlanFeatures: await db.$queryRawUnsafe('SELECT id, "planId", "featureId", enabled FROM billing."BillingPlanFeature" ORDER BY id'),
  merchantPricingPlanFeatures: await db.$queryRawUnsafe('SELECT "merchantPricingPlanId", "featureId", "createdAt" FROM billing."MerchantPricingPlanFeature" ORDER BY "merchantPricingPlanId", "featureId"'),
  categories: await db.$queryRawUnsafe('SELECT id, slug, "displayName", description, enabled, "displayOrder", "editVersion", "createdByAdminId", "updatedByAdminId", "createdAt", "updatedAt" FROM commerce."CommercePromptTemplateCategory" ORDER BY id'),
  agentPromptRevisions: await db.$queryRawUnsafe('SELECT id, "promptId", "revisionNumber", status, "editVersion", "promptText", "contentHash", "sourceTemplateId", "createdAt", "updatedAt", "publishedAt" FROM commerce."CommerceAgentPromptRevision" ORDER BY id'),
});

let temporarySchema;
try {
  const empty = await db.$queryRawUnsafe(`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`);
  assert.equal(empty[0].count, 0, 'Target must be empty; refusing reset/reuse');
  console.log(`ISOLATION ${target.hostname}:${target.port} ${target.pathname.slice(1)} empty database; mode=${mode}`);
  console.log('POSTGRES_VERSION', await db.$queryRawUnsafe('SELECT version()'));

  if (mode === 'upgrade') {
    scratch = mkdtempSync(join(tmpdir(), 'arch023-predecessor-'));
    temporarySchema = join(scratch, 'schema.prisma');
    const predecessor = execFileSync('git', ['show', 'HEAD:prisma/schema.prisma'], {cwd: root, encoding: 'utf8'});
    writeFileSync(temporarySchema, predecessor);
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(new URL('../prisma/migrations', import.meta.url))) {
      if (name !== migrationName) cpSync(new URL(`../prisma/migrations/${name}`, import.meta.url), join(scratch, 'migrations', name), {recursive: true});
    }
    migrate(temporarySchema);
    await seedArch023Cases(db);
    const changedBefore = await modifiedTableSnapshots();
    const existingTables = await db.$queryRawUnsafe(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND table_name <> '_prisma_migrations' AND NOT ((table_schema='billing' AND table_name IN ('BillingPlanFeature','MerchantPricingPlanFeature')) OR (table_schema='commerce' AND table_name IN ('CommercePromptTemplateCategory','CommerceAgentPromptRevision')) ) ORDER BY 1,2`);
    const unchangedBefore = await snapshot(existingTables);
    migrate('prisma/schema.prisma');
    assert.deepEqual(await snapshot(existingTables), unchangedBefore, 'Unmodified existing tables changed during upgrade');
    assert.deepEqual(await modifiedTableSnapshots(), changedBefore, 'Existing rows/values in modified tables changed during upgrade');
    console.log('UPGRADE_PRESERVATION passed for every predecessor table and each table altered by ARCH-023.');
  } else {
    migrate('prisma/schema.prisma');
  }

  const extension = await db.$queryRawUnsafe(`SELECT extname FROM pg_extension WHERE extname='vector'`);
  assert.equal(extension.length, 1, 'pgvector extension must exist');
  const seedCount = await db.$queryRawUnsafe(`SELECT
    (SELECT count(*)::int FROM commerce."MerchantKnowledgePurpose") AS purposes,
    (SELECT count(*)::int FROM commerce."MerchantKnowledgeDataFormat") AS formats,
    (SELECT count(*)::int FROM commerce."MerchantKnowledgePurposeDataFormat") AS pairs`);
  assert.deepEqual(seedCount[0], {purposes: 7, formats: 3, pairs: 11});

  if (mode === 'fresh') await seedArch023Cases(db);
  await verifyConfigurationDefaultsAndRoundTrip(db);
  const provenance = await db.$queryRawUnsafe(`SELECT "defaultTemplateId" FROM commerce."CommercePromptTemplateCategory" WHERE id='arch023-category'`);
  const sourceVersion = await db.$queryRawUnsafe(`SELECT "sourceTemplateEditVersion" FROM commerce."CommerceAgentPromptRevision" WHERE id='arch023-prompt-revision'`);
  assert.equal(provenance[0].defaultTemplateId, null, 'Existing category default must remain NULL');
  assert.equal(sourceVersion[0].sourceTemplateEditVersion, null, 'Existing revision provenance must remain NULL');

  await runArch023Cases(db);
  await db.$executeRawUnsafe(`INSERT INTO commerce."MerchantKnowledgeChunk" ("id","revisionId","ordinal","content","contentUnits","contentHash","embedding","embeddingProvider","embeddingModel","embeddingDimensions","embeddingIndexVersion") VALUES ('arch023-vector-dimension-valid','arch023-revision-active',50,'valid',1,'${'b'.repeat(64)}','[1,2]'::vector,'provider','model',2,'v1')`);
  await assert.rejects(() => db.$executeRawUnsafe(`INSERT INTO commerce."MerchantKnowledgeChunk" ("id","revisionId","ordinal","content","contentUnits","contentHash","embedding","embeddingProvider","embeddingModel","embeddingDimensions","embeddingIndexVersion") VALUES ('arch023-vector-dimension-invalid','arch023-revision-active',51,'invalid',1,'${'c'.repeat(64)}','[1,2]'::vector,'provider','model',3,'v1')`));
  console.log('PASS pgvector matching and mismatching dimensions');
  console.log(`ARCH-023 ${mode} migration rehearsal passed.`);
} finally {
  await db.$disconnect();
  if (scratch) rmSync(scratch, {recursive: true, force: true});
}