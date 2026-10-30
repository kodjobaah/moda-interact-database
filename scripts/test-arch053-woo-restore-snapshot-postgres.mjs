import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 1), ['--mode'], 'Use --mode fresh or upgrade');
assert.equal(args.length, 2, 'Use --mode fresh or upgrade with no extra arguments');
const mode = args[1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or upgrade');

const target = '20261030131833_arch053_woo_restore_snapshot';
const container = `moda-arch053-woo-${randomUUID()}`;
const database = 'arch053_woo_restore_snapshot';
const docker = (dockerArgs, options = {}) => execFileSync('docker', dockerArgs, {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  ...options,
});
const psqlArgs = [
  'exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
  '-A', '-t', '-U', 'postgres', '-d', database,
];
const sql = (source) => docker(psqlArgs, { input: source }).trim();
const scalar = (source) => sql(source).split('\n').at(-1)?.trim() ?? '';
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;
const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
const migrationPath = new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url);
const expectedMigration = '-- AlterTable\nALTER TABLE "commerce"."CheckoutRecovery" ADD COLUMN     "wooRestoreSnapshot" JSONB;';

const supportedSnapshot = {
  schemaVersion: 'woo.cart-restore.v1',
  kind: 'supported',
  appliedCouponCodes: ['SAVE10', 'SHIPFREE'],
  lines: [
    { productId: '101', quantity: 2 },
    {
      productId: '202',
      variationId: '205',
      quantity: 1,
      attributes: { attribute_pa_size: 'large' },
    },
  ],
};
const unsupportedSnapshot = {
  schemaVersion: 'woo.cart-restore.v1',
  kind: 'unsupported',
  reason: 'CUSTOM_CART_ITEM_DATA',
  appliedCouponCodes: ['SAVE10'],
};
const displayLineItems = [{ productId: 'display-101', title: 'Display line', quantity: 1 }];
const fixedTime = '2026-10-30T12:00:00.000Z';

function insertShop(id) {
  sql(`INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt")
    VALUES (${sqlString(id)}, ${sqlString(`${id}.example.invalid`)}, ${sqlString(fixedTime)});`);
}

function insertRecovery({ id, shopId, checkoutToken, generation, snapshot, lineItems = displayLineItems, status = 'DETECTED' }) {
  const snapshotColumn = snapshot === undefined ? '' : ', "wooRestoreSnapshot"';
  const snapshotValue = snapshot === undefined ? '' : `, ${jsonSql(snapshot)}`;
  sql(`INSERT INTO "commerce"."CheckoutRecovery"
    ("id", "shopId", "checkoutToken", "generation", "status", "currency", "totalPrice",
     "checkoutUrl", "lineItems", "detectedAt", "lastExternalActivityAt", "createdAt", "updatedAt"${snapshotColumn})
    VALUES (${sqlString(id)}, ${sqlString(shopId)}, ${sqlString(checkoutToken)}, ${generation}, ${sqlString(status)},
      'GBP', 31.25, ${sqlString('https://store.example.invalid/checkout/')}, ${jsonSql(lineItems)},
      ${sqlString(fixedTime)}, ${sqlString(fixedTime)}, ${sqlString(fixedTime)}, ${sqlString(fixedTime)}${snapshotValue});`);
}

function recoveryState(id) {
  return JSON.parse(scalar(`SELECT json_build_object(
    'id', "id", 'shopId', "shopId", 'checkoutToken', "checkoutToken", 'generation', "generation",
    'status', "status"::text, 'currency', "currency", 'totalPrice', "totalPrice",
    'checkoutUrl', "checkoutUrl", 'lineItems', "lineItems", 'detectedAt', "detectedAt",
    'lastExternalActivityAt', "lastExternalActivityAt", 'createdAt', "createdAt", 'updatedAt', "updatedAt"
  )::text FROM "commerce"."CheckoutRecovery" WHERE "id"=${sqlString(id)};`));
}

function snapshotValue(id) {
  const value = scalar(`SELECT "wooRestoreSnapshot"::text FROM "commerce"."CheckoutRecovery"
    WHERE "id"=${sqlString(id)};`);
  return value === '' ? null : JSON.parse(value);
}

function assertSnapshotColumn() {
  assert.equal(Number(scalar(`SELECT count(*) FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='CheckoutRecovery'
      AND column_name='wooRestoreSnapshot' AND data_type='jsonb' AND is_nullable='YES'
      AND column_default IS NULL;`)), 1, 'snapshot column is nullable JSONB with no default');
}

function assertUniqueRejected(statement) {
  try {
    sql(statement);
  } catch (error) {
    assert.match(String(error.stderr), /duplicate key value violates unique constraint/i,
      'duplicate generation must fail because of the existing unique constraint');
    return;
  }
  assert.fail('duplicate (shopId, checkoutToken, generation) was accepted');
}

function seedLegacyRecovery() {
  insertShop('arch053-legacy-shop');
  insertRecovery({
    id: 'arch053-legacy-recovery',
    shopId: 'arch053-legacy-shop',
    checkoutToken: 'arch053-legacy-checkout',
    generation: 4,
    lineItems: [{ productId: 'legacy-101', title: 'Existing line', quantity: 3 }],
  });
  return recoveryState('arch053-legacy-recovery');
}

function assertSnapshotPersistence(shopId) {
  insertShop(shopId);
  insertRecovery({
    id: `${shopId}-no-snapshot`,
    shopId,
    checkoutToken: `${shopId}-no-snapshot-token`,
    generation: 1,
  });
  assert.equal(snapshotValue(`${shopId}-no-snapshot`), null,
    'new recovery without restoration evidence has SQL NULL');

  insertRecovery({
    id: `${shopId}-supported`,
    shopId,
    checkoutToken: `${shopId}-same-checkout`,
    generation: 1,
    snapshot: supportedSnapshot,
    status: 'COMPLETED',
  });
  insertRecovery({
    id: `${shopId}-unsupported`,
    shopId,
    checkoutToken: `${shopId}-same-checkout`,
    generation: 2,
    snapshot: unsupportedSnapshot,
  });
  assert.deepEqual(snapshotValue(`${shopId}-supported`), supportedSnapshot,
    'supported JSONB snapshot round-trips without changing its content');
  assert.deepEqual(snapshotValue(`${shopId}-unsupported`), unsupportedSnapshot,
    'unsupported JSONB evidence round-trips without being treated as a restorable basket');
  assert.deepEqual(JSON.parse(scalar(`SELECT "lineItems"::text FROM "commerce"."CheckoutRecovery"
    WHERE "id"=${sqlString(`${shopId}-supported`)};`)), displayLineItems,
  'restoration evidence does not overwrite the display lineItems column');
  assertUniqueRejected(`INSERT INTO "commerce"."CheckoutRecovery"
    ("id", "shopId", "checkoutToken", "generation", "status", "lastExternalActivityAt", "updatedAt")
    VALUES (${sqlString(`${shopId}-duplicate`)}, ${sqlString(shopId)},
      ${sqlString(`${shopId}-same-checkout`)}, 1, 'COMPLETED', ${sqlString(fixedTime)}, ${sqlString(fixedTime)});`);
  console.log('PASS SQL NULL default, exact supported/unsupported JSONB round trips, independent generations and existing uniqueness');
}

async function run() {
  let containerStarted = false;
  try {
    docker([
      'run', '--detach', '--name', container, '--network', 'none',
      '-e', 'POSTGRES_PASSWORD=arch053-test', '-e', `POSTGRES_DB=${database}`,
      'pgvector/pgvector:pg17',
    ]);
    containerStarted = true;

    let ready = false;
    let lastReadinessError;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', database]);
        ready = true;
        break;
      } catch (error) {
        lastReadinessError = error;
        await delay(500);
      }
    }
    assert.ok(ready, `disposable PostgreSQL container did not become ready: ${lastReadinessError?.message ?? 'no readiness response'}`);

    const allMigrations = readdirSync(migrationDirectory)
      .filter((name) => /^\d{14}_/.test(name)).sort();
    const targetIndex = allMigrations.indexOf(target);
    assert.ok(targetIndex >= 0, `expected migration ${target} to exist`);
    const migrations = allMigrations.slice(0, targetIndex + 1);
    assert.equal(migrations.at(-1), target, 'migration list must stop at the ARCH-053 target');

    const migrationSql = readFileSync(migrationPath, 'utf8').trim();
    assert.equal(migrationSql, expectedMigration,
      'migration must match Prisma’s schema-to-schema diff and contain only the nullable JSONB addition');

    let legacyBefore;
    for (const name of migrations) {
      if (name === target && mode === 'upgrade') legacyBefore = seedLegacyRecovery();
      sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }

    assertSnapshotColumn();
    if (mode === 'upgrade') {
      assert.deepEqual(recoveryState('arch053-legacy-recovery'), legacyBefore,
        'migration preserves legacy recovery fields, including lineItems and checkoutUrl');
      assert.equal(scalar(`SELECT "wooRestoreSnapshot" IS NULL FROM "commerce"."CheckoutRecovery"
        WHERE "id"='arch053-legacy-recovery';`), 't', 'existing row receives SQL NULL');
      console.log('PASS legacy recovery fields preserved and new snapshot remains SQL NULL after upgrade');
    }

    assertSnapshotPersistence(`arch053-${mode}-shop`);
    console.log(`PASS ARCH-053-DATABASE-001 PostgreSQL ${mode} (${migrations.length} migrations through target)`);
  } finally {
    if (containerStarted) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}

await run();
