import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';

const root = new URL('..', import.meta.url);
const migrationName = '20260930120000_arch024_model_availability_openrouter';
const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory).filter(name => name !== 'migration_lock.toml').sort();
const requestedModeIndex = process.argv.indexOf('--mode');
const requestedMode = requestedModeIndex < 0 ? undefined : process.argv[requestedModeIndex + 1];
assert.ok(requestedMode === undefined || ['fresh', 'upgrade'].includes(requestedMode), 'Pass --mode fresh|upgrade');
const modes = requestedMode ? [requestedMode] : ['fresh', 'upgrade'];
const table = (schema, name) => `"${schema}"."${name}"`;
const fixtureTime = '2026-09-30T12:00:00.000Z';
const testUrl = mode => {
  const key = `ARCH024_${mode.toUpperCase()}_DATABASE_URL`;
  let target;
  try { target = new URL(process.env[key] ?? ''); } catch { throw new Error(`${key} must be an explicit isolated PostgreSQL URL`); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), `${key} must use PostgreSQL`);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), `${key} must target localhost`);
  assert.equal(target.pathname, `/arch024_model_availability_test_${mode}`, `${key} must name the fixed ARCH-024 ${mode} test database`);
  assert.equal(target.search, '', `${key} must not contain connection parameter overrides`);
  assert.equal(target.hash, '', `${key} must not contain a URL fragment`);
  return target.toString();
};

const migrate = (url, schemaPath) => {
  try {
    const output = execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env, DATABASE_URL: url},
    });
    console.log(output.replaceAll(url, '[isolated test URL]'));
  } catch (error) {
    if (error.stdout) console.error(String(error.stdout).replaceAll(url, '[isolated test URL]'));
    if (error.stderr) console.error(String(error.stderr).replaceAll(url, '[isolated test URL]'));
    throw new Error(`Prisma migration deploy failed for the isolated ${schemaPath.includes(migrationName) ? 'ARCH-024 target' : 'schema'} rehearsal`);
  }
};

const copyMigrationSet = (scratch, predicate) => {
  const schemaPath = join(scratch, 'schema.prisma');
  cpSync(new URL('../prisma/schema.prisma', import.meta.url), schemaPath);
  const targetDirectory = join(scratch, 'migrations');
  mkdirSync(targetDirectory, {recursive: true});
  for (const name of migrationNames) {
    if (predicate(name)) cpSync(new URL(`../prisma/migrations/${name}`, import.meta.url), join(targetDirectory, name), {recursive: true});
  }
  return schemaPath;
};

const query = (db, sql) => db.$queryRawUnsafe(sql);
const run = (db, sql) => db.$executeRawUnsafe(sql);
const rejects = async (db, name, sql) => {
  await assert.rejects(() => db.$transaction(tx => tx.$executeRawUnsafe(sql)), undefined, name);
  console.log(`PASS ${name}`);
};

async function seedCore(db) {
  await run(db, `INSERT INTO ${table('commerce', 'Shop')} ("id", "domain", "updatedAt") VALUES ('arch024-shop', 'arch024.invalid', '${fixtureTime}') ON CONFLICT ("id") DO NOTHING`);
  await run(db, `INSERT INTO ${table('public', 'PlatformAdmin')} ("id", "email", "updatedAt") VALUES ('arch024-admin', 'arch024@example.invalid', '${fixtureTime}') ON CONFLICT ("id") DO NOTHING`);
}

async function seedPricePlan(db) {
  const locales = ['cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant'];
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`INSERT INTO ${table('billing', 'MerchantPricingPlan')} (
    "id", "shopifyPlanHandle", "displayName", "planKind", "cataloguePosition", "includedRecoveryCredits",
    "allowancePeriod", "billingPeriod", "recurringAmountMinor", "currency", "updatedAt"
    ) VALUES ('arch024-price-plan', 'arch024-free', 'ARCH-024 fixture plan', 'FREE', 0, 0, 'LIFETIME', 'EVERY_30_DAYS', 0, 'USD', '${fixtureTime}')`);
    for (const [index, locale] of locales.entries()) await tx.$executeRawUnsafe(`INSERT INTO ${table('billing', 'MerchantPricingPlanTranslation')} (
      "id", "merchantPricingPlanId", "locale", "merchantDescription", "createdAt", "updatedAt"
    ) VALUES ('arch024-price-translation-${index}', 'arch024-price-plan', '${locale}', 'ARCH-024 fixture description', '${fixtureTime}', '${fixtureTime}')`);
  });
}

async function seedBilling(db) {
  await seedPricePlan(db);
  await run(db, `INSERT INTO ${table('billing', 'BillingPlan')} ("id", "shopifyPlanHandle", "name", "kind", "updatedAt")
    VALUES ('arch024-billing-plan', 'arch024-billing', 'ARCH-024 billing fixture', 'FREE', '${fixtureTime}')`);
}

async function snapshotUnaffectedSchema(db) {
  const excluded = `('CommerceModelAvailability','CommerceModelCatalogueEntry','CommerceOpenRouterCredential','CommerceAuditEvent','MerchantPricingPlan','_prisma_migrations')`;
  const columns = await query(db, `SELECT table_schema, table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_name NOT IN ${excluded}
    ORDER BY table_schema, table_name, ordinal_position`);
  const indexes = await query(db, `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog','information_schema') AND tablename NOT IN ${excluded}
    ORDER BY schemaname, tablename, indexname`);
  const constraints = await query(db, `SELECT ns.nspname AS schema_name, rel.relname AS table_name, con.conname, con.contype,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
    WHERE ns.nspname NOT IN ('pg_catalog','information_schema') AND rel.relname NOT IN ${excluded}
    ORDER BY ns.nspname, rel.relname, con.conname`);
  const enums = await query(db, `SELECT ns.nspname AS schema_name, typ.typname, array_agg(enum.enumlabel ORDER BY enum.enumsortorder) AS labels
    FROM pg_type typ JOIN pg_namespace ns ON ns.oid=typ.typnamespace JOIN pg_enum enum ON enum.enumtypid=typ.oid
    WHERE ns.nspname NOT IN ('pg_catalog','information_schema') AND typ.typname NOT IN ('CommerceModelProvider','CommerceAuditAction','CommerceModelAvailabilityScope')
    GROUP BY ns.nspname, typ.typname ORDER BY ns.nspname, typ.typname`);
  return {columns, indexes, constraints, enums};
}

async function captureBillingRows(db) {
  const pricePlans = await query(db, `SELECT "id", "shopifyPlanHandle", "displayName", "planKind"::text AS "planKind",
    "cataloguePosition", "includedRecoveryCredits", "allowancePeriod"::text AS "allowancePeriod",
    "billingPeriod"::text AS "billingPeriod", "recurringAmountMinor", "currency", "isActive"
    FROM ${table('billing', 'MerchantPricingPlan')} ORDER BY "id"`);
  const billingPlans = await query(db, `SELECT "id", "shopifyPlanHandle", "name", "kind"::text AS "kind", "active"
    FROM ${table('billing', 'BillingPlan')} ORDER BY "id"`);
  return {pricePlans, billingPlans};
}

async function assertCoreSchema(db) {
  for (const [schema, name] of [
    ['commerce', 'CommerceModelAvailability'], ['commerce', 'CommerceModelCatalogueEntry'],
    ['commerce', 'CommerceOpenRouterCredential'], ['commerce', 'CommerceAgentConfiguration'],
    ['commerce', 'CommerceAuditEvent'], ['billing', 'MerchantPricingPlan'], ['billing', 'BillingPlan'],
  ]) assert.equal((await query(db, `SELECT to_regclass('${schema}."${name}"')::text AS name`))[0].name, `${schema}."${name}"`);
  const bootstrap = await query(db, `SELECT count(*)::int AS count FROM ${table('commerce', 'CommerceModelAvailability')} WHERE "scope"='PLATFORM'`);
  assert.equal(bootstrap[0].count, 1, 'exactly one bootstrap Platform Availability is required');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${table('commerce', 'CommerceModelAvailability')} WHERE "id"='arch024-platform-model-availability'`))[0].count, 1);
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${table('commerce', 'CommerceOpenRouterCredential')}`))[0].count, 0, 'migration must not seed credentials');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${table('commerce', 'CommerceModelCatalogueEntry')} WHERE "availabilityId" IS NULL`))[0].count, 0);
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${table('commerce', 'CommerceModelCatalogueEntry')} model
    LEFT JOIN ${table('commerce', 'CommerceModelAvailability')} availability ON availability."id"=model."availabilityId"
    WHERE availability."id" IS NULL`))[0].count, 0, 'each catalogue entry must reference exactly one Availability');
  assert.equal((await query(db, `SELECT to_regtype('commerce."CommerceModelProvider"') IS NULL AS absent`))[0].absent, true);
  const priceModel = await query(db, `SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema='billing' AND table_name='MerchantPricingPlan' AND column_name='commerceModelId'`);
  assert.deepEqual(priceModel, [{column_name: 'commerceModelId', is_nullable: 'YES'}]);
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM pg_constraint fk
    JOIN pg_class src ON src.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace
    JOIN pg_class dst ON dst.oid=fk.confrelid WHERE ns.nspname='billing' AND src.relname='MerchantPricingPlan'
      AND dst.relname='BillingPlan'`))[0].count, 0, 'MerchantPricingPlan must not reference BillingPlan');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema='billing' AND table_name='BillingPlan' AND column_name='commerceModelId'`))[0].count, 0);
  const agentColumns = await query(db, `SELECT column_name FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='CommerceAgentConfiguration' ORDER BY ordinal_position`);
  assert.ok(agentColumns.some(row => row.column_name === 'modelId'), 'existing Agent Configuration model pointer must remain');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname='commerce'
    AND indexname IN ('CommerceAgentConfiguration_one_platform_per_environment','CommerceAgentConfiguration_one_shop_per_environment')`))[0].count, 2);
}

async function insertModel(db, {id, availabilityId, provider = 'openai', providerModelId = id, configuration = "'{}'::jsonb", version = 1, displayName = 'Fixture model', description = "''"}) {
  await run(db, `INSERT INTO ${table('commerce', 'CommerceModelCatalogueEntry')} (
    "id", "availabilityId", "provider", "providerModelId", "displayName", "description", "configurationSchemaVersion", "configuration", "createdByAdminId", "updatedByAdminId"
  ) VALUES ('${id}', '${availabilityId}', '${provider}', '${providerModelId}', '${displayName.replaceAll("'", "''")}', ${description}, ${version}, ${configuration}, 'arch024-admin', 'arch024-admin')`);
}

async function insertCredential(db, {id, environment = 'TEST', nonce = "decode('000102030405060708090a0b','hex')", authTag = "decode('000102030405060708090a0b0c0d0e0f','hex')", ciphertext = "decode('aa','hex')", keyId = 'key-v1', editVersion = 1}) {
  await run(db, `INSERT INTO ${table('commerce', 'CommerceOpenRouterCredential')} (
    "id", "environment", "ciphertext", "nonce", "authTag", "keyId", "editVersion", "updatedByAdminId"
  ) VALUES ('${id}', '${environment}', ${ciphertext}, ${nonce}, ${authTag}, '${keyId.replaceAll("'", "''")}', ${editVersion}, 'arch024-admin')`);
}

async function insertAudit(db, {id, action, availabilityId, modelId, environment}) {
  const columns = ['"id"', '"actorAdminId"', '"action"', '"reason"'];
  const values = [`'${id}'`, `'arch024-admin'`, `'${action}'`, `'ARCH-024 database rehearsal'`];
  if (availabilityId !== undefined) { columns.push('"modelAvailabilityId"'); values.push(availabilityId === null ? 'NULL' : `'${availabilityId}'`); }
  if (modelId !== undefined) { columns.push('"modelCatalogueEntryId"'); values.push(modelId === null ? 'NULL' : `'${modelId}'`); }
  if (environment !== undefined) { columns.push('"environment"'); values.push(environment === null ? 'NULL' : `'${environment}'`); }
  await run(db, `INSERT INTO ${table('commerce', 'CommerceAuditEvent')} (${columns.join(', ')}) VALUES (${values.join(', ')})`);
}

async function runBehaviorCases(db, mode) {
  console.log(`ARCH-024 ${mode}: running database behavior cases`);
  const beforeModels = await query(db, `SELECT "id", "commerceModelId" FROM ${table('billing', 'MerchantPricingPlan')} ORDER BY "id"`);
  assert.ok(beforeModels.every(row => row.commerceModelId === null), 'existing Price Plans must remain unassigned; no model inference is allowed');
  const preBilling = await captureBillingRows(db);
  assert.equal(preBilling.pricePlans.some(row => row.id === 'arch024-price-plan'), mode === 'upgrade');

  await seedCore(db);
  await assertCoreSchema(db);
  const availability = table('commerce', 'CommerceModelAvailability');
  const catalogue = table('commerce', 'CommerceModelCatalogueEntry');
  const pricePlans = table('billing', 'MerchantPricingPlan');
  const audit = table('commerce', 'CommerceAuditEvent');

  await rejects(db, 'second Platform Availability rejected', `INSERT INTO ${availability} ("id","scope") VALUES ('arch024-platform-duplicate','PLATFORM')`);
  await run(db, `INSERT INTO ${availability} ("id","scope","shopId") VALUES ('arch024-shop-availability','SHOP','arch024-shop')`);
  await rejects(db, 'second Shop Availability rejected', `INSERT INTO ${availability} ("id","scope","shopId") VALUES ('arch024-shop-duplicate','SHOP','arch024-shop')`);
  await rejects(db, 'PLATFORM with shopId rejected', `INSERT INTO ${availability} ("id","scope","shopId") VALUES ('arch024-bad-platform','PLATFORM','arch024-shop')`);
  await rejects(db, 'SHOP without shopId rejected', `INSERT INTO ${availability} ("id","scope") VALUES ('arch024-bad-shop','SHOP')`);
  await rejects(db, 'Availability identity mutation rejected', `UPDATE ${availability} SET "scope"='PLATFORM',"shopId"=NULL WHERE "id"='arch024-shop-availability'`);
  await rejects(db, 'Availability delete rejected', `DELETE FROM ${availability} WHERE "id"='arch024-shop-availability'`);

  await rejects(db, 'catalogue Availability is non-null', `INSERT INTO ${catalogue} ("id","provider","providerModelId","displayName","createdByAdminId","updatedByAdminId") VALUES ('arch024-no-availability','openai','missing','Missing Availability','arch024-admin','arch024-admin')`);
  await rejects(db, 'catalogue Availability FK enforced', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","createdByAdminId","updatedByAdminId") VALUES ('arch024-bad-availability','arch024-no-such-availability','openai','missing','Missing Availability','arch024-admin','arch024-admin')`);
  await insertModel(db, {id: 'arch024-model-platform', availabilityId: 'arch024-platform-model-availability', providerModelId: 'same-model'});
  await rejects(db, 'duplicate model identity within Availability rejected', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","createdByAdminId","updatedByAdminId") VALUES ('arch024-model-duplicate','arch024-platform-model-availability','openai','same-model','Duplicate','arch024-admin','arch024-admin')`);
  await insertModel(db, {id: 'arch024-model-shop-copy', availabilityId: 'arch024-shop-availability', providerModelId: 'same-model'});
  await insertModel(db, {id: 'arch024-model-move', availabilityId: 'arch024-platform-model-availability', providerModelId: 'move-model'});
  await run(db, `UPDATE ${catalogue} SET "availabilityId"='arch024-shop-availability' WHERE "id"='arch024-model-move'`);
  assert.equal((await query(db, `SELECT "availabilityId" FROM ${catalogue} WHERE "id"='arch024-model-move'`))[0].availabilityId, 'arch024-shop-availability');
  await rejects(db, 'catalogue provider identity mutation rejected', `UPDATE ${catalogue} SET "provider"='anthropic' WHERE "id"='arch024-model-platform'`);
  await rejects(db, 'catalogue providerModelId identity mutation rejected', `UPDATE ${catalogue} SET "providerModelId"='changed' WHERE "id"='arch024-model-platform'`);
  await rejects(db, 'non-canonical provider rejected', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","createdByAdminId","updatedByAdminId") VALUES ('arch024-model-upper','arch024-platform-model-availability','Anthropic','upper','Upper','arch024-admin','arch024-admin')`);
  await insertModel(db, {id: 'arch024-model-anthropic', availabilityId: 'arch024-platform-model-availability', provider: 'anthropic', providerModelId: 'claude-test'});
  await rejects(db, 'JSON array configuration rejected', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","configuration","createdByAdminId","updatedByAdminId") VALUES ('arch024-config-array','arch024-platform-model-availability','openai','config-array','Array','[]'::jsonb,'arch024-admin','arch024-admin')`);
  await rejects(db, 'JSON scalar configuration rejected', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","configuration","createdByAdminId","updatedByAdminId") VALUES ('arch024-config-scalar','arch024-platform-model-availability','openai','config-scalar','Scalar','7'::jsonb,'arch024-admin','arch024-admin')`);
  await rejects(db, 'configuration schema version zero rejected', `INSERT INTO ${catalogue} ("id","availabilityId","provider","providerModelId","displayName","configurationSchemaVersion","createdByAdminId","updatedByAdminId") VALUES ('arch024-config-version-zero','arch024-platform-model-availability','openai','version-zero','Version zero',0,'arch024-admin','arch024-admin')`);
  await insertModel(db, {id: 'arch024-model-pricing', availabilityId: 'arch024-platform-model-availability', providerModelId: 'pricing-model', configuration: "'{\"temperature\":0.2}'::jsonb"});
  assert.equal((await query(db, `SELECT jsonb_typeof("configuration") AS kind FROM ${catalogue} WHERE "id"='arch024-model-pricing'`))[0].kind, 'object');

  const platformConfig = table('commerce', 'CommerceAgentConfiguration');
  await run(db, `INSERT INTO ${platformConfig} ("id","environment","scope","updatedAt") VALUES ('arch024-platform-config','TEST','PLATFORM','${fixtureTime}')`);
  await run(db, `INSERT INTO ${platformConfig} ("id","environment","scope","shopId","updatedAt") VALUES ('arch024-shop-config','TEST','SHOP','arch024-shop','${fixtureTime}')`);
  await rejects(db, 'Platform configuration uniqueness remains intact', `INSERT INTO ${platformConfig} ("id","environment","scope","updatedAt") VALUES ('arch024-platform-config-duplicate','TEST','PLATFORM','${fixtureTime}')`);
  await rejects(db, 'Shop configuration uniqueness remains intact', `INSERT INTO ${platformConfig} ("id","environment","scope","shopId","updatedAt") VALUES ('arch024-shop-config-duplicate','TEST','SHOP','arch024-shop','${fixtureTime}')`);
  await run(db, `UPDATE ${platformConfig} SET "modelId"='arch024-model-pricing' WHERE "id"='arch024-platform-config'`);

  if (preBilling.pricePlans.some(row => row.id === 'arch024-price-plan')) {
    const expected = preBilling.pricePlans.find(row => row.id === 'arch024-price-plan');
    const actual = (await query(db, `SELECT "id", "shopifyPlanHandle", "displayName", "planKind"::text AS "planKind",
      "cataloguePosition", "includedRecoveryCredits", "allowancePeriod"::text AS "allowancePeriod", "billingPeriod"::text AS "billingPeriod",
      "recurringAmountMinor", "currency", "isActive" FROM ${pricePlans} WHERE "id"='arch024-price-plan'`))[0];
    assert.deepEqual(actual, expected, 'pre-existing Price Plan fields changed during the breaking migration');
  } else await seedPricePlan(db);
  await run(db, `UPDATE ${pricePlans} SET "commerceModelId"='arch024-model-pricing' WHERE "id"='arch024-price-plan'`);
  await run(db, `UPDATE ${catalogue} SET "enabled"=false,"editVersion"="editVersion"+1 WHERE "id"='arch024-model-pricing'`);
  await run(db, `UPDATE ${catalogue} SET "availabilityId"='arch024-shop-availability' WHERE "id"='arch024-model-pricing'`);
  await run(db, `UPDATE ${availability} SET "enabled"=false,"editVersion"="editVersion"+1 WHERE "id"='arch024-shop-availability'`);
  assert.equal((await query(db, `SELECT "commerceModelId" FROM ${pricePlans} WHERE "id"='arch024-price-plan'`))[0].commerceModelId, 'arch024-model-pricing', 'disablement or reassignment must not rewrite the Price Plan model FK');
  assert.equal((await query(db, `SELECT "modelId" FROM ${platformConfig} WHERE "id"='arch024-platform-config'`))[0].modelId, 'arch024-model-pricing', 'Availability changes must not clear explicit Agent Configuration selections');

  const credential = table('commerce', 'CommerceOpenRouterCredential');
  await rejects(db, 'invalid 11-byte nonce rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-bad-nonce','LOCAL',decode('aa','hex'),decode('000102030405060708090a','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'key-v1','arch024-admin')`);
  await rejects(db, 'invalid 15-byte auth tag rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-bad-tag','LOCAL',decode('aa','hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e','hex'),'key-v1','arch024-admin')`);
  await rejects(db, 'empty ciphertext rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-empty-ciphertext','LOCAL',decode('','hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'key-v1','arch024-admin')`);
  await rejects(db, 'ciphertext exceeding 8192 bytes rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-large-ciphertext','LOCAL',decode(repeat('aa',8193),'hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'key-v1','arch024-admin')`);
  await rejects(db, 'blank credential key ID rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-blank-key','LOCAL',decode('aa','hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'   ','arch024-admin')`);
  await rejects(db, 'non-positive credential edit version rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","editVersion","updatedByAdminId") VALUES ('arch024-zero-edit','LOCAL',decode('aa','hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'key-v1',0,'arch024-admin')`);
  await insertCredential(db, {id: 'arch024-credential-valid'});
  await rejects(db, 'duplicate credential per environment rejected', `INSERT INTO ${credential} ("id","environment","ciphertext","nonce","authTag","keyId","updatedByAdminId") VALUES ('arch024-credential-duplicate','TEST',decode('aa','hex'),decode('000102030405060708090a0b','hex'),decode('000102030405060708090a0b0c0d0e0f','hex'),'key-v1','arch024-admin')`);
  assert.equal(await run(db, `UPDATE ${credential} SET "ciphertext"=decode('bb','hex'),"editVersion"="editVersion"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='arch024-credential-valid' AND "editVersion"=1`), 1, 'CAS-style credential replacement should update exactly one row');

  const availabilityActions = ['CREATE_MODEL_AVAILABILITY', 'UPDATE_MODEL_AVAILABILITY', 'ENABLE_MODEL_AVAILABILITY', 'DISABLE_MODEL_AVAILABILITY'];
  for (const [index, action] of availabilityActions.entries()) {
    await rejects(db, `${action} audit target required`, `INSERT INTO ${audit} ("id","actorAdminId","action","reason") VALUES ('arch024-audit-missing-${index}','arch024-admin','${action}','missing target')`);
    await insertAudit(db, {id: `arch024-audit-valid-${index}`, action, availabilityId: 'arch024-platform-model-availability'});
  }
  await rejects(db, 'assignment audit requires catalogue target', `INSERT INTO ${audit} ("id","actorAdminId","action","reason","modelAvailabilityId") VALUES ('arch024-audit-assignment-missing-model','arch024-admin','ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY','missing model','arch024-platform-model-availability')`);
  await rejects(db, 'assignment audit requires Availability target', `INSERT INTO ${audit} ("id","actorAdminId","action","reason","modelCatalogueEntryId") VALUES ('arch024-audit-assignment-missing-availability','arch024-admin','ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY','missing availability','arch024-model-platform')`);
  await insertAudit(db, {id: 'arch024-audit-assignment-valid', action: 'ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY', availabilityId: 'arch024-platform-model-availability', modelId: 'arch024-model-platform'});
  for (const [index, action] of ['SET_OPENROUTER_CREDENTIAL', 'REPLACE_OPENROUTER_CREDENTIAL', 'REMOVE_OPENROUTER_CREDENTIAL'].entries()) {
    await rejects(db, `${action} audit environment required`, `INSERT INTO ${audit} ("id","actorAdminId","action","reason") VALUES ('arch024-audit-credential-missing-${index}','arch024-admin','${action}','missing environment')`);
    await insertAudit(db, {id: `arch024-audit-credential-valid-${index}`, action, environment: 'TEST'});
  }
  await run(db, `INSERT INTO ${table('commerce', 'CommerceStudioMerchantAccess')} ("id","shopId","email","createdByPlatformAdminId") VALUES ('arch024-merchant-access','arch024-shop','merchant@arch024.invalid','arch024-admin')`);
  await run(db, `INSERT INTO ${audit} ("id","actorAdminId","action","reason","merchantAccessId") VALUES ('arch024-audit-existing-branch','arch024-admin','GRANT_MERCHANT_STUDIO_ACCESS','unrelated existing audit branch','arch024-merchant-access')`);
  await run(db, `DELETE FROM ${credential} WHERE "id"='arch024-credential-valid' AND "editVersion"=2`);
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${credential}`))[0].count, 0, 'credential removal should leave no credential row');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${catalogue} WHERE "id"='arch024-model-pricing'`))[0].count, 1, 'credential removal must not delete catalogue definitions');
  assert.equal((await query(db, `SELECT count(*)::int AS count FROM ${platformConfig} WHERE "id" IN ('arch024-platform-config','arch024-shop-config')`))[0].count, 2, 'credential removal must not alter Agent Configuration rows');
  await assertCoreSchema(db);
  console.log(`ARCH-024 ${mode}: behavior matrix passed`);
}

async function runMode(mode) {
  const url = testUrl(mode);
  const db = new PrismaClient({datasources: {db: {url}}});
  let scratch;
  try {
    const empty = await query(db, `SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
    assert.equal(empty[0].count, 0, `ARCH-024 ${mode} target must be empty; refusing reset or reuse`);
    console.log(`ISOLATION localhost ${new URL(url).pathname.slice(1)} empty; mode=${mode}`);

    let preBilling;
    if (mode === 'upgrade') {
      scratch = mkdtempSync(join(tmpdir(), 'arch024-upgrade-'));
      const predecessorSchema = copyMigrationSet(scratch, name => name < migrationName);
      migrate(url, predecessorSchema);
      await seedCore(db);
      await seedBilling(db);
      preBilling = await captureBillingRows(db);
      const beforeSchema = await snapshotUnaffectedSchema(db);
      const throughTargetSchema = copyMigrationSet(join(scratch, 'through-target'), name => name <= migrationName);
      migrate(url, throughTargetSchema);
      assert.deepEqual(await snapshotUnaffectedSchema(db), beforeSchema, 'ARCH-024 changed unrelated pre-existing tables, indexes, constraints, or enum definitions');
      const afterTargetBilling = await captureBillingRows(db);
      assert.deepEqual(afterTargetBilling.billingPlans, preBilling.billingPlans, 'ARCH-024 changed unrelated BillingPlan rows');
      assert.deepEqual(afterTargetBilling.pricePlans, preBilling.pricePlans, 'ARCH-024 changed existing Price Plan fields');
      const assigned = await query(db, `SELECT "commerceModelId" FROM ${table('billing', 'MerchantPricingPlan')} WHERE "id"='arch024-price-plan'`);
      assert.deepEqual(assigned, [{commerceModelId: null}], 'ARCH-024 must add the Price Plan association as NULL without inference');
      await assertCoreSchema(db);
      console.log('UPGRADE_PRESERVATION unrelated schema and billing fixtures passed');
      await runBehaviorCases(db, mode);
      migrate(url, 'prisma/schema.prisma');
    } else {
      migrate(url, 'prisma/schema.prisma');
      await assertCoreSchema(db);
      await runBehaviorCases(db, mode);
    }
    console.log(`ARCH-024 ${mode}: PostgreSQL rehearsal passed.`);
  } finally {
    await db.$disconnect();
    if (scratch) rmSync(scratch, {recursive: true, force: true});
  }
}

for (const mode of modes) await runMode(mode);
console.log(`ARCH-024 migration validation passed (${modes.join(', ')}).`);