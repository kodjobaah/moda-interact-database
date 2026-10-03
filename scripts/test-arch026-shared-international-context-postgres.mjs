import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
const targetMigration = '20261003140000_arch026_shared_international_context';
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass an explicit --mode fresh|upgrade');
const databaseName = 'arch026_international_context_fixture';
const containerName = `moda-arch026-database002-${randomUUID()}`;
let containerStarted = false;

function docker(args, options = {}) {
  try {
    return execFileSync('docker', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options});
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Docker command failed${detail ? `: ${detail}` : ''}`, {cause: error});
  }
}

function psql(sql, {capture = false} = {}) {
  return docker([
    'exec', '-i', containerName, 'psql', '-X', '-q',
    ...(capture ? ['-A', '-t'] : []), '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName,
  ], {input: sql});
}

function jsonQuery(sql) {
  return JSON.parse(psql(sql, {capture: true}).trim());
}

function expectRejected(label, statement) {
  psql(`DO $assertion$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state <> '23514' THEN RAISE; END IF;
  END;
  IF caught_state IS NULL THEN RAISE EXCEPTION 'Expected SQLSTATE 23514: ${label}'; END IF;
END
$assertion$;`);
  console.log(`PASS ${label} (SQLSTATE 23514)`);
}

async function awaitPostgres() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      execFileSync('docker', ['exec', containerName, 'psql', '-X', '-q', '-U', 'postgres', '-d', databaseName, '-c', 'SELECT 1'], {stdio: 'ignore'});
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error('Invocation-owned PostgreSQL container did not become ready');
}

const migrationNames = () => readdirSync(migrationDirectory).filter(name => /^\d{14}_.+$/.test(name)).sort();
function applyMigration(name) {
  psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  console.log(`APPLIED ${name}`);
}

function seedUpgradeFixtures() {
  psql(`INSERT INTO commerce."Shop" ("id", "domain", "updatedAt") VALUES
  ('arch026-intl-full', 'intl-full.arch026.invalid', CURRENT_TIMESTAMP),
  ('arch026-intl-partial', 'intl-partial.arch026.invalid', CURRENT_TIMESTAMP),
  ('arch026-intl-no-settings', 'intl-no-settings.arch026.invalid', CURRENT_TIMESTAMP);
INSERT INTO shopify."ShopSettings" ("id", "shopId", "defaultLanguageTag", "defaultTimeZone", "defaultCountryCode", "updatedAt") VALUES
  ('arch026-intl-settings-full', 'arch026-intl-full', 'pt-BR', 'Europe/London', 'GB', CURRENT_TIMESTAMP),
  ('arch026-intl-settings-partial', 'arch026-intl-partial', NULL, 'Pacific/Auckland', NULL, CURRENT_TIMESTAMP);`);
}

function assertUpgradeBackfill() {
  const shops = jsonQuery(`SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)::text FROM (
    SELECT shop."id", shop."defaultLanguageTag", shop."defaultTimeZone", shop."defaultCountryCode", shop."storeLocale"
    FROM commerce."Shop" shop WHERE shop."id" LIKE 'arch026-intl-%'
  ) AS row_data;`);
  assert.deepEqual(shops, [
    {id: 'arch026-intl-full', defaultLanguageTag: 'pt-BR', defaultTimeZone: 'Europe/London', defaultCountryCode: 'GB', storeLocale: null},
    {id: 'arch026-intl-no-settings', defaultLanguageTag: null, defaultTimeZone: null, defaultCountryCode: null, storeLocale: null},
    {id: 'arch026-intl-partial', defaultLanguageTag: null, defaultTimeZone: 'Pacific/Auckland', defaultCountryCode: null, storeLocale: null},
  ]);
  const legacy = jsonQuery(`SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."shopId")::text FROM (
    SELECT "shopId", "defaultLanguageTag", "defaultTimeZone", "defaultCountryCode"
    FROM shopify."ShopSettings" WHERE "shopId" LIKE 'arch026-intl-%'
  ) AS row_data;`);
  assert.deepEqual(legacy, [
    {shopId: 'arch026-intl-full', defaultLanguageTag: 'pt-BR', defaultTimeZone: 'Europe/London', defaultCountryCode: 'GB'},
    {shopId: 'arch026-intl-partial', defaultLanguageTag: null, defaultTimeZone: 'Pacific/Auckland', defaultCountryCode: null},
  ], 'legacy Shopify context must remain intact');
  console.log('PASS legacy international-context backfill preserves nulls and leaves storeLocale unset');
}

function assertColumnsAndConstraint() {
  const columns = jsonQuery(`SELECT jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type,
    'maxLength', character_maximum_length, 'nullable', is_nullable) ORDER BY ordinal_position)::text
    FROM information_schema.columns WHERE table_schema='commerce' AND table_name='Shop'
      AND column_name IN ('storeLocale','defaultLanguageTag','defaultTimeZone','defaultCountryCode');`);
  assert.deepEqual(columns, [
    {name: 'storeLocale', type: 'character varying', maxLength: 128, nullable: 'YES'},
    {name: 'defaultLanguageTag', type: 'character varying', maxLength: 64, nullable: 'YES'},
    {name: 'defaultTimeZone', type: 'character varying', maxLength: 255, nullable: 'YES'},
    {name: 'defaultCountryCode', type: 'character varying', maxLength: 2, nullable: 'YES'},
  ]);
  const constraint = jsonQuery(`SELECT jsonb_build_object(
      'count', count(*)::int,
      'usesCCollation', bool_and(pg_get_constraintdef(constraint_row.oid) LIKE '%COLLATE "C"%')
    )::text FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid=constraint_row.conrelid
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='commerce' AND relation.relname='Shop'
      AND constraint_row.conname='Shop_default_country_code_check' AND constraint_row.contype='c';`);
  assert.deepEqual(constraint, {count: 1, usesCCollation: true},
    'nullable country-code check must exist once and use C collation for ASCII ranges');
}

function runBehaviorCases() {
  psql(`INSERT INTO commerce."Shop" ("id", "domain", "updatedAt")
    VALUES ('arch026-intl-defaults', 'intl-defaults.arch026.invalid', CURRENT_TIMESTAMP);`);
  assert.deepEqual(jsonQuery(`SELECT jsonb_build_object(
    'storeLocale', "storeLocale", 'defaultLanguageTag', "defaultLanguageTag",
    'defaultTimeZone', "defaultTimeZone", 'defaultCountryCode', "defaultCountryCode"
  )::text FROM commerce."Shop" WHERE "id"='arch026-intl-defaults';`), {
    storeLocale: null, defaultLanguageTag: null, defaultTimeZone: null, defaultCountryCode: null,
  }, 'new Shops must not receive invented international-context defaults');
  psql(`INSERT INTO commerce."Shop" ("id", "domain", "defaultCountryCode", "updatedAt") VALUES
  ('arch026-intl-valid-country', 'country-valid.arch026.invalid', 'US', CURRENT_TIMESTAMP),
  ('arch026-intl-null-country', 'country-null.arch026.invalid', NULL, CURRENT_TIMESTAMP);`);
  expectRejected('lowercase country code rejected', `INSERT INTO commerce."Shop" ("id","domain","defaultCountryCode","updatedAt") VALUES ('arch026-intl-lower-country','country-lower.arch026.invalid','gb',CURRENT_TIMESTAMP)`);
  expectRejected('one-character country code rejected', `INSERT INTO commerce."Shop" ("id","domain","defaultCountryCode","updatedAt") VALUES ('arch026-intl-short-country','country-short.arch026.invalid','U',CURRENT_TIMESTAMP)`);
  expectRejected('non-ASCII country code rejected', `INSERT INTO commerce."Shop" ("id","domain","defaultCountryCode","updatedAt") VALUES ('arch026-intl-nonascii-country','country-nonascii.arch026.invalid','ÅB',CURRENT_TIMESTAMP)`);
  console.log('PASS uppercase ISO-style country and NULL remain valid');
}

async function main() {
  try {
    docker(['run', '--detach', '--name', containerName, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=fixture-only', '--env', `POSTGRES_DB=${databaseName}`, 'pgvector/pgvector:pg17']);
    containerStarted = true;
    await awaitPostgres();
    console.log(`ISOLATION container=${containerName} image=pgvector/pg17 network=none mode=${mode}`);

    const names = migrationNames();
    assert.equal(names.at(-1), targetMigration, 'ARCH-026-DATABASE-002 migration must be the latest ordered migration');
    for (const name of names) {
      if (name === targetMigration) break;
      applyMigration(name);
    }
    if (mode === 'upgrade') seedUpgradeFixtures();
    applyMigration(targetMigration);
    assertColumnsAndConstraint();
    if (mode === 'upgrade') assertUpgradeBackfill();
    runBehaviorCases();
    console.log(`ARCH-026 shared international-context ${mode} PostgreSQL rehearsal passed.`);
  } finally {
    if (containerStarted) {
      docker(['rm', '--force', containerName]);
      console.log(`CLEANUP removed invocation-owned container ${containerName}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});