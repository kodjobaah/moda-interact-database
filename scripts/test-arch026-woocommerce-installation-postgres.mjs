import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
const targetMigration = '20261002090000_arch026_woocommerce_installation_identity';
const requestedModeIndex = process.argv.indexOf('--mode');
const mode = requestedModeIndex < 0 ? undefined : process.argv[requestedModeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass an explicit --mode fresh|upgrade');
const databaseName = 'arch026_installation_fixture';
const containerName = `moda-arch026-database001-${randomUUID()}`;
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

function expectRejected(label, statement, sqlState = '23514') {
  psql(`DO $assertion$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state <> '${sqlState}' THEN RAISE; END IF;
  END;
  IF caught_state IS NULL THEN RAISE EXCEPTION 'Expected SQLSTATE ${sqlState}: ${label}'; END IF;
END
$assertion$;`);
  console.log(`PASS ${label} (SQLSTATE ${sqlState})`);
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

function migrationNames() {
  return readdirSync(migrationDirectory)
    .filter(name => /^\d{14}_.+$/.test(name))
    .sort();
}

function applyMigration(name) {
  const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
  psql(sql);
  console.log(`APPLIED ${name}`);
}

function unrelatedSchemaSnapshot() {
  return jsonQuery(`SELECT jsonb_build_object(
    'columns', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY table_schema, table_name, ordinal_position)
      FROM information_schema.columns row_data WHERE table_schema IN ('billing','shopify','whatsapp','support','public')), '[]'::jsonb),
    'indexes', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY schemaname, tablename, indexname)
      FROM pg_indexes row_data WHERE schemaname IN ('billing','shopify','whatsapp','support','public')), '[]'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_object('schema', namespace.nspname, 'table', relation.relname,
      'name', constraint_row.conname, 'type', constraint_row.contype, 'definition', pg_get_constraintdef(constraint_row.oid, true))
      ORDER BY namespace.nspname, relation.relname, constraint_row.conname)
      FROM pg_constraint constraint_row JOIN pg_class relation ON relation.oid=constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname IN ('billing','shopify','whatsapp','support','public')), '[]'::jsonb),
    'enums', COALESCE((SELECT jsonb_agg(jsonb_build_object('schema', namespace.nspname, 'type', type_row.typname,
      'labels', labels.enum_labels) ORDER BY namespace.nspname, type_row.typname)
      FROM pg_type type_row JOIN pg_namespace namespace ON namespace.oid=type_row.typnamespace
      JOIN LATERAL (SELECT array_agg(enum.enumlabel ORDER BY enum.enumsortorder) AS enum_labels
        FROM pg_enum enum WHERE enum.enumtypid=type_row.oid) labels ON true
      WHERE namespace.nspname IN ('billing','shopify','whatsapp','support','public') AND labels.enum_labels IS NOT NULL), '[]'::jsonb)
  )::text;`);
}

function assertObjectOwnership() {
  const ownership = jsonQuery(`SELECT jsonb_build_object(
    'woocommerceSchema', to_regnamespace('woocommerce') IS NOT NULL,
    'wooTable', to_regclass('woocommerce."WooCommerceInstallation"') IS NOT NULL,
    'wooEnum', to_regtype('woocommerce."WooCommerceInstallationStatus"') IS NOT NULL,
    'wooFunction', to_regprocedure('woocommerce.arch026_woocommerce_installation_guard()') IS NOT NULL,
    'wooTrigger', (SELECT count(*) FROM pg_trigger trigger_row JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='woocommerce' AND relation.relname='WooCommerceInstallation'
        AND trigger_row.tgname='arch026_woocommerce_installation_guard' AND NOT trigger_row.tgisinternal),
    'commerceDuplicates', (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='commerce' AND relation.relname='WooCommerceInstallation')
  )::text;`);
  assert.deepEqual(ownership, {
    woocommerceSchema: true,
    wooTable: true,
    wooEnum: true,
    wooFunction: true,
    wooTrigger: 1,
    commerceDuplicates: 0,
  });
  assert.deepEqual(jsonQuery(`SELECT jsonb_build_object(
    'wooShops', (SELECT count(*) FROM commerce."Shop" WHERE "platform"='WOOCOMMERCE'),
    'installations', (SELECT count(*) FROM woocommerce."WooCommerceInstallation")
  )::text;`), {wooShops: 0, installations: 0}, 'migration must not seed Woo Shop or installation rows');
  assert.equal(jsonQuery(`SELECT count(*)::int FROM pg_type type_row
    JOIN pg_namespace namespace ON namespace.oid=type_row.typnamespace
    WHERE namespace.nspname='commerce' AND type_row.typname='WooCommerceInstallationStatus'`), 0,
  'Woo enum must not be duplicated in commerce');
}

function seedUpgradeRows() {
  psql(`INSERT INTO commerce."Shop" ("id", "domain", "shopifyShopId", "status", "installedAt", "uninstalledAt", "reinstallPendingAt", "createdAt", "updatedAt")
VALUES
  ('arch026-shop-complete', 'complete.arch026.invalid', 'gid://shopify/Shop/26001', 'ACTIVE', '2026-09-01T00:00:00Z', NULL, NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('arch026-shop-incomplete', 'incomplete.arch026.invalid', 'gid://shopify/Shop/26002', 'UNINSTALLED', '2026-08-01T00:00:00Z', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z', '2026-08-01T00:00:00Z', '2026-09-03T00:00:00Z'),
  ('arch026-shop-no-settings', 'no-settings.arch026.invalid', NULL, 'ACTIVE', '2026-07-01T00:00:00Z', NULL, NULL, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
INSERT INTO shopify."ShopSettings" ("id", "shopId", "onboardingCompleted", "updatedAt")
VALUES
  ('arch026-settings-complete', 'arch026-shop-complete', true, '2026-09-01T00:00:00Z'),
  ('arch026-settings-incomplete', 'arch026-shop-incomplete', false, '2026-09-03T00:00:00Z');`);
}

function assertUpgradeBackfill() {
  const shops = jsonQuery(`SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)::text FROM (
    SELECT shop."id", shop."domain", shop."shopifyShopId", shop."status"::text AS status,
      shop."installedAt", shop."uninstalledAt", shop."reinstallPendingAt", shop."platform"::text AS platform,
      shop."onboardingCompleted"
    FROM commerce."Shop" shop WHERE shop."id" LIKE 'arch026-shop-%'
  ) AS row_data;`);
  assert.deepEqual(shops, [
    {id: 'arch026-shop-complete', domain: 'complete.arch026.invalid', shopifyShopId: 'gid://shopify/Shop/26001', status: 'ACTIVE',
      installedAt: '2026-09-01T00:00:00', uninstalledAt: null, reinstallPendingAt: null, platform: 'SHOPIFY', onboardingCompleted: true},
    {id: 'arch026-shop-incomplete', domain: 'incomplete.arch026.invalid', shopifyShopId: 'gid://shopify/Shop/26002', status: 'UNINSTALLED',
      installedAt: '2026-08-01T00:00:00', uninstalledAt: '2026-09-02T00:00:00', reinstallPendingAt: '2026-09-03T00:00:00', platform: 'SHOPIFY', onboardingCompleted: false},
    {id: 'arch026-shop-no-settings', domain: 'no-settings.arch026.invalid', shopifyShopId: null, status: 'ACTIVE',
      installedAt: '2026-07-01T00:00:00', uninstalledAt: null, reinstallPendingAt: null, platform: 'SHOPIFY', onboardingCompleted: false},
  ]);
  const legacy = jsonQuery(`SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."shopId")::text FROM (
    SELECT "shopId", "onboardingCompleted" FROM shopify."ShopSettings" WHERE "shopId" LIKE 'arch026-shop-%'
  ) AS row_data;`);
  assert.deepEqual(legacy, [
    {shopId: 'arch026-shop-complete', onboardingCompleted: true},
    {shopId: 'arch026-shop-incomplete', onboardingCompleted: false},
  ], 'legacy Shopify onboarding values and rows must remain intact');
  console.log('PASS Shopify identity/lifecycle preservation and shared onboarding backfill');
}

function runBehaviorCases() {
  const validDigest = "decode(repeat('ab', 32), 'hex')";
  psql(`INSERT INTO commerce."Shop" ("id", "domain", "platform", "shopifyShopId", "updatedAt")
    VALUES ('arch026-shop-null-gid', 'shopify-null.arch026.invalid', 'SHOPIFY', NULL, CURRENT_TIMESTAMP);
INSERT INTO commerce."Shop" ("id", "domain", "platform", "shopifyShopId", "updatedAt")
    VALUES ('arch026-shop-woo', 'woo.arch026.invalid', 'WOOCOMMERCE', NULL, CURRENT_TIMESTAMP);
INSERT INTO commerce."Shop" ("id", "domain", "updatedAt")
    VALUES ('arch026-shop-default', 'default.arch026.invalid', CURRENT_TIMESTAMP);`);
  assert.deepEqual(jsonQuery(`SELECT jsonb_build_object('platform', "platform"::text, 'onboardingCompleted', "onboardingCompleted")::text
    FROM commerce."Shop" WHERE "id"='arch026-shop-default';`), {platform: 'SHOPIFY', onboardingCompleted: false});
  expectRejected('Woo Shop cannot carry Shopify GID', `INSERT INTO commerce."Shop" ("id","domain","platform","shopifyShopId","updatedAt") VALUES ('arch026-invalid-platform','bad-platform.arch026.invalid','WOOCOMMERCE','gid://shopify/Shop/1',CURRENT_TIMESTAMP)`);
  console.log('PASS Shopify Shop with NULL Shopify GID remains valid; fresh defaults are SHOPIFY/false');

  expectRejected('installation Shop FK enforced', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES ('arch026-bad-fk','arch026-missing-shop','https://fk.arch026.invalid',${validDigest},CURRENT_TIMESTAMP)`, '23503');
  expectRejected('blank canonical URL rejected', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES ('arch026-blank-url','arch026-shop-woo','   ',${validDigest},CURRENT_TIMESTAMP)`);
  expectRejected('31-byte credential digest rejected', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES ('arch026-short-digest','arch026-shop-woo','https://short.arch026.invalid',decode(repeat('ab',31),'hex'),CURRENT_TIMESTAMP)`);
  expectRejected('zero credential version rejected', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","credentialVersion","updatedAt") VALUES ('arch026-zero-version','arch026-shop-woo','https://version.arch026.invalid',${validDigest},0,CURRENT_TIMESTAMP)`);
  expectRejected('ACTIVE with revokedAt rejected', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","revokedAt","updatedAt") VALUES ('arch026-active-revoked','arch026-shop-woo','https://active-revoked.arch026.invalid',${validDigest},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  expectRejected('REVOKED without revokedAt rejected', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","status","credentialDigest","updatedAt") VALUES ('arch026-revoked-open','arch026-shop-woo','https://revoked-open.arch026.invalid','REVOKED',${validDigest},CURRENT_TIMESTAMP)`);

  psql(`INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt")
    VALUES ('arch026-installation','arch026-shop-woo','https://store.arch026.invalid',${validDigest},CURRENT_TIMESTAMP);`);
  expectRejected('one installation per Shop enforced', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES ('arch026-duplicate-shop','arch026-shop-woo','https://second.arch026.invalid',${validDigest},CURRENT_TIMESTAMP)`, '23505');
  psql(`INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES ('arch026-shop-other','other.arch026.invalid','WOOCOMMERCE',CURRENT_TIMESTAMP);`);
  expectRejected('canonical URL uniqueness enforced', `INSERT INTO woocommerce."WooCommerceInstallation" ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES ('arch026-duplicate-url','arch026-shop-other','https://store.arch026.invalid',${validDigest},CURRENT_TIMESTAMP)`, '23505');
  expectRejected('installation id immutable', `UPDATE woocommerce."WooCommerceInstallation" SET "id"='arch026-installation-changed' WHERE "id"='arch026-installation'`);
  expectRejected('installation Shop identity immutable', `UPDATE woocommerce."WooCommerceInstallation" SET "shopId"='arch026-shop-other' WHERE "id"='arch026-installation'`);

  psql(`UPDATE woocommerce."WooCommerceInstallation"
    SET "canonicalSiteUrl"='https://store-renewed.arch026.invalid',
        "credentialDigest"=decode(repeat('cd',32),'hex'), "credentialVersion"=2,
        "credentialIssuedAt"=CURRENT_TIMESTAMP, "status"='REVOKED', "revokedAt"=CURRENT_TIMESTAMP,
        "updatedAt"=CURRENT_TIMESTAMP
    WHERE "id"='arch026-installation';`);
  assert.deepEqual(jsonQuery(`SELECT jsonb_build_object('url', "canonicalSiteUrl", 'version', "credentialVersion", 'status', "status"::text, 'hasRevokedAt', "revokedAt" IS NOT NULL)::text
    FROM woocommerce."WooCommerceInstallation" WHERE "id"='arch026-installation';`), {
    url: 'https://store-renewed.arch026.invalid', version: 2, status: 'REVOKED', hasRevokedAt: true,
  });
  psql(`UPDATE woocommerce."WooCommerceInstallation" SET "status"='ACTIVE', "revokedAt"=NULL WHERE "id"='arch026-installation';`);
  psql(`DELETE FROM commerce."Shop" WHERE "id"='arch026-shop-woo';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM woocommerce."WooCommerceInstallation" WHERE "id"='arch026-installation';`), 0,
    'Shop deletion must cascade to Woo installation');
  console.log('PASS identity guard, mutable lifecycle fields, and Shop cascade deletion');
}

async function main() {
  try {
    docker(['run', '--detach', '--name', containerName, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=fixture-only', '--env', `POSTGRES_DB=${databaseName}`, 'pgvector/pgvector:pg17']);
    containerStarted = true;
    await awaitPostgres();
    console.log(`ISOLATION container=${containerName} image=pgvector/pg17 network=none mode=${mode}`);

    const names = migrationNames();
    assert.equal(names.at(-1), targetMigration, 'ARCH-026 migration must be the latest ordered migration');
    for (const name of names) {
      if (name === targetMigration) break;
      applyMigration(name);
    }

    let beforeUnrelated;
    if (mode === 'upgrade') {
      seedUpgradeRows();
      beforeUnrelated = unrelatedSchemaSnapshot();
    }
    applyMigration(targetMigration);
    if (mode === 'upgrade') {
      assert.deepEqual(unrelatedSchemaSnapshot(), beforeUnrelated,
        'ARCH-026 must not mutate billing, Shopify, WhatsApp, support or public schema objects');
      assertUpgradeBackfill();
      console.log('PASS unrelated schema snapshot preserved');
    }

    assertObjectOwnership();
    const shopIndex = jsonQuery(`SELECT count(*)::int FROM pg_indexes WHERE schemaname='commerce' AND indexname='Shop_platform_status_idx';`);
    assert.equal(shopIndex, 1, 'Shop platform/status index must exist');
    const billingChanges = jsonQuery(`SELECT count(*)::int FROM information_schema.columns WHERE table_schema='billing' AND column_name IN ('platform','onboardingCompleted','canonicalSiteUrl','credentialDigest');`);
    assert.equal(billingChanges, 0, 'ARCH-026 must not add provider identity or credential columns to billing');
    runBehaviorCases();
    console.log(`ARCH-026 ${mode} PostgreSQL migration rehearsal passed.`);
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