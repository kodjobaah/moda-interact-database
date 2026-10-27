import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? null : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or --mode upgrade');
const target = '20261026235000_arch050_initial_recovery_support_notification';
const container = `moda-arch050-db-${randomUUID()}`;
const database = 'arch050_notification_fixture';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
  '-A', '-t', '-U', 'postgres', '-d', database];
const sql = source => docker(psqlArgs, { input: source }).trim();
const scalar = source => sql(source).split('\n').at(-1)?.trim() ?? '';
const number = source => Number(scalar(source));
const shop = id => `INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES ('${id}','${id}.example.invalid',now());`;
function seedLegacy() {
  sql(`${shop('arch050-old')}
    INSERT INTO "shopify"."ShopSettings" ("id","shopId","updatedAt")
      VALUES ('arch050-old-settings','arch050-old',now());
    INSERT INTO "support"."MerchantSupportThread" ("id","shopId","updatedAt")
      VALUES ('arch050-old-thread','arch050-old',now());
    INSERT INTO "support"."MerchantSupportMessage"
      ("id","threadId","kind","state","originalBody","sourceLanguageTag","sourceKey","updatedAt")
      VALUES ('arch050-old-message','arch050-old-thread','SYSTEM','AVAILABLE','Existing notice','en','arch050-source-key',now());`);
}
function assertRejects(label, statement) {
  try { sql(statement); } catch (error) {
    assert.match(String(error.stderr), /ERROR:/, `${label}: expected PostgreSQL rejection`);
    return;
  }
  assert.fail(`${label}: PostgreSQL unexpectedly accepted the statement`);
}
function assertDefaults() {
  assert.equal(number(`SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shopify' AND table_name='ShopSettings'
      AND column_name='notifyOnInitialRecoveryOutreach' AND is_nullable='NO'
      AND column_default='false'`), 1, 'preference is non-null with OFF database default');
  if (mode === 'upgrade') {
    assert.equal(scalar(`SELECT "notifyOnInitialRecoveryOutreach"::text FROM "shopify"."ShopSettings"
      WHERE "id"='arch050-old-settings'`), 'false', 'existing settings row migrates OFF');
  }
  sql(`${shop('arch050-new')}
    INSERT INTO "shopify"."ShopSettings" ("id","shopId","updatedAt")
      VALUES ('arch050-new-settings','arch050-new',now());`);
  assert.equal(scalar(`SELECT "notifyOnInitialRecoveryOutreach"::text FROM "shopify"."ShopSettings"
    WHERE "id"='arch050-new-settings'`), 'false', 'new settings row defaults OFF');
  console.log('PASS existing and new shop settings default OFF');
}
function exerciseRecoveryLink() {
  sql(`${shop('arch050-target')}
    INSERT INTO "commerce"."CheckoutRecovery"
      ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt")
      VALUES ('arch050-recovery','arch050-target','checkout-1',now(),now());
    INSERT INTO "support"."MerchantSupportThread" ("id","shopId","updatedAt")
      VALUES ('arch050-target-thread','arch050-target',now());
    INSERT INTO "support"."MerchantSupportMessage"
      ("id","threadId","kind","state","originalBody","sourceLanguageTag","sourceKey","systemVersion","checkoutRecoveryId","updatedAt")
      VALUES ('arch050-linked-message','arch050-target-thread','SYSTEM','AVAILABLE','Recovery notice','en','arch050-linked-key','1','arch050-recovery',now());`);
  assert.equal(scalar(`SELECT "checkoutRecoveryId" FROM "support"."MerchantSupportMessage"
    WHERE "id"='arch050-linked-message'`), 'arch050-recovery');
  assertRejects('foreign key rejects missing recovery', `UPDATE "support"."MerchantSupportMessage"
    SET "checkoutRecoveryId"='arch050-missing' WHERE "id"='arch050-linked-message';`);
  assertRejects('sourceKey uniqueness remains enforced', `INSERT INTO "support"."MerchantSupportMessage"
    ("id","threadId","kind","state","originalBody","sourceLanguageTag","sourceKey","updatedAt")
    VALUES ('arch050-duplicate-message','arch050-target-thread','SYSTEM','AVAILABLE','Duplicate','en','arch050-linked-key',now());`);
  sql(`DELETE FROM "commerce"."CheckoutRecovery" WHERE "id"='arch050-recovery';`);
  assert.equal(scalar(`SELECT "checkoutRecoveryId" IS NULL FROM "support"."MerchantSupportMessage"
    WHERE "id"='arch050-linked-message'`), 't', 'recovery deletion preserves message and nulls its target');
  assert.equal(number(`SELECT count(*) FROM "support"."MerchantSupportMessage"
    WHERE "id"='arch050-linked-message'`), 1);
  assert.equal(scalar(`SELECT "systemVersion" FROM "support"."MerchantSupportMessage"
    WHERE "id"='arch050-linked-message'`), '1');
  console.log('PASS nullable recovery FK, reference enforcement, ON DELETE SET NULL and sourceKey uniqueness');
}
async function run() {
  let started = false;
  try {
    docker(['run', '-d', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=arch050-test',
      '-e', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', database]);
        ready = true;
        break;
      } catch { await delay(500); }
    }
    assert.ok(ready, 'disposable PostgreSQL container did not become ready');
    const names = readdirSync(new URL('../prisma/migrations/', import.meta.url))
      .filter(name => /^\d{14}_/.test(name)).sort();
    assert.equal(names.at(-1), target, 'unexpected migration ordering');
    for (const name of names) {
      if (name === target && mode === 'upgrade') seedLegacy();
      sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    if (mode === 'upgrade') {
      assert.equal(number(`SELECT count(*) FROM "support"."MerchantSupportMessage"
        WHERE "id"='arch050-old-message' AND "sourceKey"='arch050-source-key'`), 1,
      'existing support message/sourceKey remains intact after migration');
    }
    assertDefaults();
    exerciseRecoveryLink();
    console.log(`PASS ARCH-050-DATABASE-001 PostgreSQL ${mode} (${names.length} migrations)`);
  } finally {
    if (started) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}
await run();
