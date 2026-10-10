import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260930120000_arch024_model_availability_openrouter/migration.sql');
const predecessor = read('prisma/migrations/20260923150000_arch021_agent_configuration/migration.sql');
const erd = read('docs/generated/prisma-erd.puml');
const block = (source, kind, name) => source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const model = name => block(schema, 'model', name);
const requireFields = (body, fields, owner) => {
  assert.ok(body, `${owner} missing`);
  for (const field of fields) assert.match(body, new RegExp(`^\\s*${field}\\s`, 'm'), `${owner}.${field} missing`);
};

assert.match(schema, /enum CommerceModelAvailabilityScope \{\s+PLATFORM\s+SHOP\s+@@schema\("commerce"\)\s+\}/);
requireFields(model('CommerceModelAvailability'), [
  'id', 'scope', 'shopId', 'enabled', 'editVersion', 'createdByAdminId', 'updatedByAdminId', 'createdAt', 'updatedAt',
  'shop', 'createdBy', 'updatedBy', 'entries', 'auditEvents',
], 'CommerceModelAvailability');
requireFields(model('CommerceModelCatalogueEntry'), [
  'id', 'availabilityId', 'provider', 'providerModelId', 'displayName', 'description',
  'configurationSchemaVersion', 'configuration', 'enabled', 'editVersion', 'createdByAdminId', 'updatedByAdminId',
  'availability', 'createdBy', 'updatedBy', 'configurations', 'merchantPricingPlans', 'auditEvents',
], 'CommerceModelCatalogueEntry');
requireFields(model('CommerceOpenRouterCredential'), [
  'id', 'environment', 'ciphertext', 'nonce', 'authTag', 'keyId', 'editVersion', 'updatedByAdminId', 'createdAt', 'updatedAt', 'updatedBy',
], 'CommerceOpenRouterCredential');
requireFields(model('CommerceAuditEvent'), ['modelAvailabilityId', 'modelAvailability'], 'CommerceAuditEvent');
requireFields(model('MerchantPricingPlan'), ['commerceModelId', 'commerceModel'], 'MerchantPricingPlan');
assert.doesNotMatch(model('BillingPlan'), /^\s*commerceModelId\s/m, 'BillingPlan must not have a Commerce model association');
assert.doesNotMatch(schema, /^enum CommerceModelProvider\s/m, 'closed CommerceModelProvider enum must be removed');
assert.match(model('CommerceModelCatalogueEntry'), /provider\s+String\s+@db\.VarChar\(64\)/);
assert.match(model('CommerceModelCatalogueEntry'), /@@unique\(\[availabilityId, provider, providerModelId\]\)/);
assert.match(model('CommerceModelCatalogueEntry'), /configurationSchemaVersion\s+Int\s+@default\(1\)/);
assert.match(model('CommerceModelCatalogueEntry'), /configuration\s+Json\s+@default\("\{\}"\)\s+@db\.JsonB/);
assert.match(model('CommerceModelCatalogueEntry'), /merchantPricingPlans\s+MerchantPricingPlan\[\]\s+@relation\("MerchantPricingPlanCommerceModel"\)/);
assert.match(model('MerchantPricingPlan'), /commerceModel\s+CommerceModelCatalogueEntry\?\s+@relation\("MerchantPricingPlanCommerceModel", fields: \[commerceModelId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/);
assert.match(model('CommerceModelAvailability'), /shopId\s+String\?\s+@unique\s+@db\.Text/);
assert.match(model('CommerceModelAvailability'), /@@index\(\[scope, enabled, id\]\)/);
assert.match(model('CommerceOpenRouterCredential'), /environment\s+CommerceEnvironment\s+@unique/);
for (const relation of [
  /commerceModelAvailability\s+CommerceModelAvailability\?/,
  /createdCommerceModelAvailabilities\s+CommerceModelAvailability\[\]/,
  /updatedCommerceModelAvailabilities\s+CommerceModelAvailability\[\]/,
  /updatedCommerceOpenRouterCredentials\s+CommerceOpenRouterCredential\[\]/,
]) assert.match(schema, relation, `${relation} inverse relation missing`);
for (const action of [
  'CREATE_MODEL_AVAILABILITY', 'UPDATE_MODEL_AVAILABILITY', 'ENABLE_MODEL_AVAILABILITY', 'DISABLE_MODEL_AVAILABILITY',
  'ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY', 'SET_OPENROUTER_CREDENTIAL', 'REPLACE_OPENROUTER_CREDENTIAL', 'REMOVE_OPENROUTER_CREDENTIAL',
]) assert.match(schema, new RegExp(`^\\s*${action}\\s*$`, 'm'), `${action} missing`);

for (const table of ['CommerceModelAvailability', 'CommerceOpenRouterCredential']) {
  assert.match(migration, new RegExp(`CREATE TABLE "commerce"\\."${table}"`), `${table} migration missing`);
  assert.match(erd, new RegExp(`entity "${table}"`), `${table} missing from generated ERD`);
}
assert.match(migration, /'arch024-platform-model-availability', 'PLATFORM', NULL, true, 1, NULL, NULL[\s\S]*?ON CONFLICT \("id"\) DO NOTHING/);
for (const name of [
  'CommerceModelAvailability_scope_shop_check', 'CommerceModelAvailability_edit_version_check',
  'CommerceModelAvailability_one_platform', 'CommerceModelAvailability_shopId_key', 'CommerceModelAvailability_scope_enabled_id_idx',
  'CommerceModelCatalogueEntry_provider_check', 'CommerceModelCatalogueEntry_provider_model_id_check',
  'CommerceModelCatalogueEntry_configuration_schema_version_check', 'CommerceModelCatalogueEntry_configuration_object_check',
  'CommerceModelCatalogueEntry_availabilityId_fkey',
  'CommerceOpenRouterCredential_environment_key', 'CommerceOpenRouterCredential_nonce_length_check',
  'CommerceOpenRouterCredential_auth_tag_length_check', 'CommerceOpenRouterCredential_ciphertext_length_check',
  'CommerceOpenRouterCredential_key_id_check', 'CommerceOpenRouterCredential_edit_version_check',
  'MerchantPricingPlan_commerceModelId_fkey', 'MerchantPricingPlan_commerceModelId_idx',
  'CommerceAuditEvent_modelAvailabilityId_createdAt_id_idx', 'CommerceAuditEvent_modelAvailabilityId_fkey',
  'arch024_model_availability_guard', 'arch024_model_catalogue_guard',
]) assert.ok(migration.includes(name), `${name} missing from migration`);
assert.match(migration, /provider" ~ '\^\[a-z0-9\]\[a-z0-9\._-\]\{0,63\}\$'/);
assert.match(migration, /octet_length\("nonce"\) = 12/);
assert.match(migration, /octet_length\("authTag"\) = 16/);
assert.match(migration, /octet_length\("ciphertext"\) BETWEEN 1 AND 8192/);
for (const retained of [
  'CommerceModelCatalogueEntry_display_name_check',
  'CommerceModelCatalogueEntry_description_length_check',
  'CommerceModelCatalogueEntry_edit_version_check',
]) assert.ok(predecessor.includes(retained), `${retained} must be retained from ARCH-021`);
assert.match(migration, /CREATE UNIQUE INDEX "CommerceModelAvailability_one_platform"[^;]+WHERE "scope" = 'PLATFORM' AND "shopId" IS NULL/s);
assert.match(migration, /ALTER COLUMN "provider" TYPE VARCHAR\(64\) USING lower\("provider"::text\)/);
assert.match(migration, /DROP TYPE "commerce"\."CommerceModelProvider"/);
assert.doesNotMatch(migration, /ALTER TABLE "billing"\."BillingPlan"|"BillingPlan"[\s\S]{0,200}commerceModelId/i);
assert.doesNotMatch(migration, /REFERENCES "billing"\."BillingPlan"/);
assert.doesNotMatch(migration, /CommerceModelAvailabilityAssignment|CommerceModelSelection|CommerceModelRuntime|CommerceModelClient/);
assert.doesNotMatch(migration, /CREATE TABLE "commerce"\."CommerceOpenRouterCredential"[\s\S]*?INSERT INTO/);
assert.match(migration, /DROP CONSTRAINT "arch020_audit_targets"[\s\S]*?ADD CONSTRAINT "arch020_audit_targets"/);
for (const preserved of [
  'CREATE_CAPABILITY', 'UPDATE_FEATURE_BEHAVIOUR', 'CREATE_RELEASE', 'ACTIVATE_RELEASE', 'CREATE_TOOL',
  'CREATE_MODEL_CATALOGUE_ENTRY', 'SET_PLATFORM_MODEL_SELECTION', 'CREATE_PROMPT_TEMPLATE_CATEGORY',
  'UPSERT_AGENT_CONFIGURATION', 'GRANT_MERCHANT_STUDIO_ACCESS',
]) assert.ok(migration.includes(`'${preserved}'`), `existing audit target ${preserved} not retained`);

console.log('ARCH-024 model availability static schema, migration and ERD checks passed.');