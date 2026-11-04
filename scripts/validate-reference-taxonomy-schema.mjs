import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261104120000_reference_taxonomy_and_core_product_discovery/migration.sql');
const grantMigration = read('prisma/migrations/20261104162500_arch058_remove_builtin_contract_hash/migration.sql');
const grantValidator = grantMigration.slice(
  grantMigration.indexOf('CREATE OR REPLACE FUNCTION commerce.arch020_grant_tools'),
  grantMigration.indexOf('UPDATE commerce."CommerceConversationGrant"'),
);
const seed = read('prisma/seed.mjs');
const compact = text => text.replace(/\s+/g, ' ').trim();
const model = name => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Missing ${name}`);
  return compact(match[1]);
};
const generation = model('ReferenceTaxonomyGeneration');
const category = model('ReferenceTaxonomyCategory');
for (const field of [
  'id String @id(map: "ReferenceTaxonomyGeneration_pkey") @default(cuid()) @db.Text',
  'environment CommerceEnvironment',
  'source String @db.VarChar(64)', 'taxonomyVersion String @db.VarChar(64)',
  'languageTag String @db.VarChar(35)', 'sourceUrl String @db.Text',
  'sourceSha256 String @db.VarChar(64)', 'embeddingProvider String @db.VarChar(64)',
  'embeddingModel String @db.VarChar(255)', 'embeddingDimensions Int',
  'embeddingIndexVersion String @db.VarChar(64)', 'embeddingTextVersion String @db.VarChar(64)',
  'importFingerprint String @db.VarChar(64)', 'categoryCount Int', 'isActive Boolean @default(false)',
  'completedAt DateTime @db.Timestamptz(3)', 'createdAt DateTime @default(now()) @db.Timestamptz(3)',
  'activatedAt DateTime? @db.Timestamptz(3)', 'categories ReferenceTaxonomyCategory[]',
  '@@unique([id, embeddingDimensions], map: "ReferenceTaxonomyGeneration_id_dimensions_key")',
  '@@unique([environment, source, languageTag, importFingerprint], map: "ReferenceTaxonomyGeneration_import_identity_key")',
  '@@schema("commerce")',
]) assert.ok(generation.includes(field), `Missing generation contract: ${field}`);
for (const field of [
  'generationId String @db.Text', 'categoryId String @db.Text', 'name String @db.Text',
  'fullName String @db.Text', 'parentId String? @db.Text', 'level Int',
  'ancestorIds String[] @default([]) @db.Text', 'embedding Unsupported("vector")', 'embeddingDimensions Int',
  'fields: [generationId, embeddingDimensions], references: [id, embeddingDimensions], onDelete: Cascade, onUpdate: Restrict',
  'fields: [generationId, parentId], references: [generationId, categoryId], onDelete: NoAction, onUpdate: Restrict',
  '@@id([generationId, categoryId], map: "ReferenceTaxonomyCategory_pkey")',
  '@@index([generationId, parentId], map: "ReferenceTaxonomyCategory_generation_parent_idx")',
  '@@schema("commerce")',
]) assert.ok(category.includes(field), `Missing category contract: ${field}`);
assert.doesNotMatch(generation + category, /shopId|@@unique\(\[environment, source, languageTag\]/);
assert.equal((migration.match(/^CREATE TABLE /gm) ?? []).length, 2);
assert.match(migration, /^BEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
assert.match(compact(migration), /LOCK TABLE commerce\."CommerceCapability", commerce\."CommerceTool" IN SHARE MODE/);
assert.match(migration, /WHERE key = 'product_search' FOR UPDATE/);
assert.match(compact(migration), /CREATE UNIQUE INDEX "ReferenceTaxonomyGeneration_active_corpus_key" ON commerce\."ReferenceTaxonomyGeneration" \("environment", "source", "languageTag"\) WHERE "isActive" = true/);
for (const name of [
  'ReferenceTaxonomyGeneration_pkey', 'ReferenceTaxonomyGeneration_nonblank_check',
  'ReferenceTaxonomyGeneration_hashes_check', 'ReferenceTaxonomyGeneration_positive_check',
  'ReferenceTaxonomyGeneration_activation_check', 'ReferenceTaxonomyCategory_pkey',
  'ReferenceTaxonomyCategory_generation_dimensions_fkey', 'ReferenceTaxonomyCategory_parent_fkey',
  'ReferenceTaxonomyCategory_identity_check', 'ReferenceTaxonomyCategory_level_check',
  'ReferenceTaxonomyCategory_embedding_check',
]) assert.ok(migration.includes(`CONSTRAINT "${name}"`), `Missing SQL constraint ${name}`);
assert.doesNotMatch(migration, /CREATE (?:EXTENSION|TRIGGER)|CREATE (?:OR REPLACE )?TABLE IF NOT EXISTS|hnsw|ivfflat/i);
const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([^(]+)/g)].map(match => match[1]);
assert.deepEqual(functions, ['commerce.arch020_grant_tools', 'commerce.arch021_conversation_grant_guard']);
assert.equal((migration.match(/SECURITY INVOKER/g) ?? []).length, 2);
assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 2);
assert.match(migration, /WHERE NOT \(granted \? 'kind'\)/);
assert.match(migration, /'commerce_get_discount_options','commerce_get_discount_details'/);
assert.match(migration, /PRODUCT_DISCOVERY_MEMBERSHIP_CONFLICT/);
assert.match(migration, /PRODUCT_DISCOVERY_FEATURE_MISSING/);
assert.match(migration, /PRODUCT_DISCOVERY_POSTCONDITION_FAILED/);
assert.doesNotMatch(migration, /\bLIKE\b/);
assert.match(compact(migration), /ON CONFLICT \("merchantPricingPlanId", "featureId"\) DO NOTHING/);
assert.match(compact(migration), /ON CONFLICT \("planId", "featureId"\) DO UPDATE SET "enabled" = true/);
const productEntries = seed.split('\n').filter(line => /key: "product_search"/.test(line));
assert.equal(productEntries.length, 1);
assert.match(productEntries[0], /activationMode: "ALWAYS_ENABLED", systemRequired: true, active: true/);
assert.match(grantMigration, /^BEGIN;/);
assert.match(grantMigration, /LOCK TABLE commerce\."CommerceConversationGrant" IN ACCESS EXCLUSIVE MODE/);
assert.match(grantMigration, /DROP TRIGGER arch020_grant_immutable ON commerce\."CommerceConversationGrant"/);
assert.match(grantMigration, /CREATE OR REPLACE FUNCTION commerce\.arch020_grant_tools\(v jsonb\)/);
assert.match(grantMigration, /ARRAY\['kind','toolName','definitionVersion'\]/);
assert.match(grantMigration, /item->>'definitionVersion' IS DISTINCT FROM '2\.0\.0'/);
assert.doesNotMatch(grantValidator, /contractHash/);
assert.match(grantMigration, /jsonb_array_elements\(grant_row\."grantedTools"\) WITH ORDINALITY/);
assert.match(grantMigration, /CREATE TRIGGER arch020_grant_immutable\s+BEFORE UPDATE ON commerce\."CommerceConversationGrant"\s+FOR EACH ROW EXECUTE FUNCTION commerce\.arch020_immutable\(\)/);
assert.match(grantMigration, /ARCH058_BUILT_IN_GRANT_SHAPE_UNRECOGNIZED/);
assert.match(grantMigration, /ARCH058_BUILT_IN_GRANT_POSTCONDITION_FAILED/);
assert.match(grantMigration, /COMMIT;\s*$/);
console.log('PASS reference-taxonomy Prisma/SQL contract, required-feature seed, bounded migration and existing grant function extension');
