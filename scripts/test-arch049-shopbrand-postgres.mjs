import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { validateSchemaText } from './validate-arch049-shopbrand-schema.mjs';
import { validateMigrationText } from './validate-arch049-shopbrand-migration.mjs';

const modeFlag = process.argv.indexOf('--mode');
const mode = modeFlag < 0 ? undefined : process.argv[modeFlag + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or --mode upgrade');

const migrationDir = new URL('../prisma/migrations/', import.meta.url);
const target = '20261025170000_arch049_shopbrand_commerce_media';
const container = `moda-arch049-db-${randomUUID()}`;
const database = 'arch049_shopbrand_fixture';
let started = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
  });
}
function sql(source) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-A', '-t', '-U', 'postgres', '-d', database], { input: source }).trim();
}
function scalar(query) {
  return sql(query).split('\n').at(-1)?.trim() ?? '';
}
function oneJson(query) {
  return JSON.parse(scalar(`SELECT row_to_json(t) FROM (${query}) AS t;`));
}
function assertRejected(label, statement, sqlState) {
  // Catch only the expected PostgreSQL integrity error, never an arbitrary
  // failure; successful inserts/updates must also fail this assertion.
  sql(`DO $assert$
  DECLARE observed_state text := NULL;
  BEGIN
    BEGIN
      ${statement};
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE;
      IF observed_state <> '${sqlState}' THEN RAISE; END IF;
    END;
    IF observed_state IS NULL THEN
      RAISE EXCEPTION 'Expected SQLSTATE ${sqlState} for ${label}';
    END IF;
  END $assert$;`);
  console.log(`PASS ${label} (${sqlState})`);
}
async function waitUntilReady() {
  for (let retry = 0; retry < 90; retry += 1) {
    try {
      docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', database],
        { stdio: 'ignore' });
      return;
    } catch {
      // The just-started disposable container is not yet accepting connections.
      await delay(500);
    }
  }
  throw new Error('ARCH-049 disposable PostgreSQL container failed readiness checks');
}
function apply(name) {
  const migration = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
  sql(migration);
}
function shop(id) {
  return `INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt")
    VALUES ('${id}', '${id}.example.invalid', now());`;
}
function seedLegacyRows() {
  sql(`${shop('arch049-existing-one')}
    ${shop('arch049-existing-two')}
    INSERT INTO "shopify"."ShopBrand"
      ("id", "shopId", "brandName", "logoUrl", "logoAltText", "logoWidth", "logoHeight",
       "squareLogoUrl", "squareLogoAltText", "coverImageUrl", "fetchedAt", "lastRefreshedAt")
    VALUES
      ('arch049-brand-one', 'arch049-existing-one', 'Example One', 'https://example.invalid/logo.png',
       'Example logo', 480, 360, 'https://example.invalid/square.png', 'Square example',
       'https://example.invalid/cover.png', '2026-06-01T10:23:45.123Z', '2026-06-02T10:23:45.123Z'),
      ('arch049-brand-two', 'arch049-existing-two', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');`);
  assert.equal(scalar('SELECT count(*) FROM "shopify"."ShopBrand";'), '2');
}
function brandData(schema, excludeMedia) {
  return JSON.parse(scalar(`SELECT COALESCE(jsonb_agg(to_jsonb(brand)${excludeMedia ? " - 'whatsAppMedia'" : ''}
    ORDER BY brand."id"), '[]'::jsonb)
    FROM "${schema}"."ShopBrand" brand WHERE brand."id" LIKE 'arch049-brand-%';`));
}
function identity(schema) {
  const relation = `"${schema}"."ShopBrand"`;
  return oneJson(`SELECT
    '${relation}'::regclass::oid::text AS table_oid,
    (SELECT oid::text FROM pg_constraint WHERE conrelid='${relation}'::regclass
       AND conname='ShopBrand_pkey') AS primary_key_oid,
    (SELECT oid::text FROM pg_constraint WHERE conrelid='${relation}'::regclass
       AND conname='ShopBrand_shopId_fkey') AS foreign_key_oid,
    '"${schema}"."ShopBrand_shopId_key"'::regclass::oid::text AS unique_index_oid`);
}
function constraintsAndColumns() {
  assert.equal(scalar(`SELECT to_regclass('shopify."ShopBrand"') IS NULL;`), 't',
    'Former shopify.ShopBrand name must no longer exist');
  assert.equal(scalar(`SELECT to_regclass('commerce."ShopBrand"') IS NOT NULL;`), 't',
    'Existing ShopBrand table must live in commerce');
  assert.deepEqual(oneJson(`SELECT
    data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='ShopBrand' AND column_name='whatsAppMedia'`), {
    data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb",
  }, 'Exact NOT NULL JSONB column and SQL default');
  assert.equal(scalar(`SELECT count(*) FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='ShopBrand';`), '13',
    'ShopBrand retains its 12 original columns plus whatsAppMedia');
  assert.deepEqual(oneJson(`SELECT conname, contype::text AS constraint_type,
    confdeltype::text AS delete_action, confupdtype::text AS update_action,
    confrelid = 'commerce."Shop"'::regclass AS targets_shop
    FROM pg_constraint WHERE conrelid='commerce."ShopBrand"'::regclass
      AND conname='ShopBrand_shopId_fkey'`), {
    conname: 'ShopBrand_shopId_fkey', constraint_type: 'f',
    delete_action: 'c', update_action: 'c', targets_shop: true,
  }, 'ShopBrand.shopId retains its commerce.Shop FK and CASCADE actions');
  assert.equal(scalar(`SELECT count(*) FROM pg_index idx
    JOIN pg_class table_ref ON table_ref.oid = idx.indrelid
    JOIN pg_namespace ns ON ns.oid = table_ref.relnamespace
    JOIN pg_class index_ref ON index_ref.oid = idx.indexrelid
    WHERE ns.nspname='commerce' AND table_ref.relname='ShopBrand'
      AND index_ref.relname='ShopBrand_shopId_key' AND idx.indisunique
      AND pg_get_indexdef(idx.indexrelid) LIKE '%("shopId")%';`), '1',
    'Original shopId unique index remains enforced');
  console.log('PASS commerce table, JSONB default, unchanged FK actions and unique index');
}
function exerciseWrites() {
  sql(`${shop('arch049-created')}
    INSERT INTO "commerce"."ShopBrand" ("id", "shopId", "lastRefreshedAt")
    VALUES ('arch049-created-brand', 'arch049-created', now());`);
  assert.equal(scalar(`SELECT "whatsAppMedia"::text FROM "commerce"."ShopBrand"
    WHERE "id"='arch049-created-brand';`), '{}',
    'New ShopBrand inserts must default to empty JSON object');
  assertRejected('FK rejects nonexistent shop', `INSERT INTO "commerce"."ShopBrand"
    ("id", "shopId", "lastRefreshedAt")
    VALUES ('arch049-unowned-brand','arch049-missing',now())`, '23503');
  assertRejected('unique index rejects second brand for shop', `INSERT INTO "commerce"."ShopBrand"
    ("id", "shopId", "lastRefreshedAt")
    VALUES ('arch049-duplicate-brand','arch049-created',now())`, '23505');
  assertRejected('JSONB cannot be null', `UPDATE "commerce"."ShopBrand"
    SET "whatsAppMedia"=NULL WHERE "id"='arch049-created-brand'`, '23502');
  assertRejected('JSONB must be syntactically valid', `UPDATE "commerce"."ShopBrand"
    SET "whatsAppMedia"='{invalid-json}'::jsonb WHERE "id"='arch049-created-brand'`, '22P02');

  // The database stores JSONB; media eligibility/dimensions/status/R2 policy
  // deliberately remain the responsibility of application transactions.
  sql(`UPDATE "commerce"."ShopBrand"
    SET "whatsAppMedia"='{"unknownRole":{"status":"UNRECOGNISED","width":-42,"r2Key":""}}'::jsonb
    WHERE "id"='arch049-created-brand';`);
  assert.equal(scalar(`SELECT "whatsAppMedia"->'unknownRole'->>'status'
    FROM "commerce"."ShopBrand" WHERE "id"='arch049-created-brand';`), 'UNRECOGNISED',
    'Business-invalid but structurally valid JSON must remain database-storable');
  sql(`UPDATE "commerce"."ShopBrand" SET "whatsAppMedia"='[]'::jsonb
    WHERE "id"='arch049-created-brand';`);
  assert.equal(scalar(`SELECT "whatsAppMedia"::text FROM "commerce"."ShopBrand"
    WHERE "id"='arch049-created-brand';`), '[]',
    'No business JSON shape CHECK constraint is allowed');
  sql(`UPDATE "commerce"."Shop" SET "id"='arch049-created-renamed'
    WHERE "id"='arch049-created';`);
  assert.equal(scalar(`SELECT "shopId" FROM "commerce"."ShopBrand"
    WHERE "id"='arch049-created-brand';`), 'arch049-created-renamed',
    'Shop identity update must cascade to its ShopBrand');
  sql(`DELETE FROM "commerce"."Shop" WHERE "id"='arch049-created-renamed';`);
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopBrand" WHERE "id"='arch049-created-brand';`), '0',
    'Shop deletion must cascade to its ShopBrand');
  console.log('PASS defaults, FK, uniqueness, UPDATE/DELETE cascade and application-owned media rules');
}

async function main() {
  validateSchemaText(readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'));
  validateMigrationText(readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8'));
  const migrations = readdirSync(migrationDir)
    .filter(name => /^\d{14}_/.test(name)).sort();
  assert.ok(migrations.includes(target), 'Fixed ARCH-049 migration is missing');
  assert.ok(migrations.every(name => name === target || /^\d{14}_/.test(name)), 'Invalid migration identifier');
  try {
    docker(['run', '--detach', '--name', container, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=arch049-test-only', '--env', `POSTGRES_DB=${database}`,
      'pgvector/pgvector:pg17']);
    started = true;
    await waitUntilReady();
    let originalRows;
    let originalIdentity;
    for (const name of migrations) {
      if (name === target) {
        if (mode === 'upgrade') {
          seedLegacyRows();
          originalRows = brandData('shopify', false);
          originalIdentity = identity('shopify');
        }
        apply(name);
        constraintsAndColumns();
        if (mode === 'upgrade') {
          assert.deepEqual(brandData('commerce', true), originalRows,
            'Migration must preserve every original ShopBrand column and row exactly');
          assert.deepEqual(identity('commerce'), originalIdentity,
            'Migration must preserve existing table, PK, FK and unique-index OIDs');
          assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopBrand"
            WHERE "whatsAppMedia"='{}'::jsonb;`), '2',
            'Existing rows gain exactly the empty media default');
          console.log('PASS upgraded legacy rows, every source value and original table/index/constraint identities');
        }
        exerciseWrites();
      } else {
        apply(name);
      }
    }
    // Later migrations (if any) must not invalidate the relocated table.
    constraintsAndColumns();
    if (mode === 'upgrade') {
      assert.deepEqual(brandData('commerce', true), originalRows,
        'Later migrations must not mutate pre-ARCH-049 data');
      assert.deepEqual(identity('commerce'), originalIdentity,
        'Later migrations must not rebuild ShopBrand or its constraints');
    }
    console.log(`PASS ARCH-049-DATABASE-001 PostgreSQL ${mode} (${migrations.length} migrations including later migrations)`);
  } finally {
    if (started) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}

await main();
