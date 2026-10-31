import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? null : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or upgrade');

const target = '20261031110000_arch016_remove_recovery_lifetime_check';
const prior = '20260916150000_arch016_recovery_policy_discounts_outreach_generations';
const container = `moda-arch016-recovery-${randomUUID()}`;
const database = 'arch016_recovery_lifetime_fixture';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
  '-A', '-t', '-U', 'postgres', '-d', database];
const sql = source => docker(psqlArgs, { input: source }).trim();
const scalar = source => sql(source).split('\n').at(-1)?.trim() ?? '';
const number = source => Number(scalar(source));

function assertIndependentConstraintRejectsInvalidVersion() {
  try {
    sql(`UPDATE "public"."BackgroundRuntimeConfig" SET "version"=-1 WHERE "id"='${mode === 'upgrade' ? 'default' : 'arch016-fresh-default'}'`);
  } catch (error) {
    assert.match(String(error.stderr), /ERROR:/, 'independent version check must reject a negative version');
    console.log('PASS independent version constraint remains enforced');
    return;
  }
  assert.fail('independent version constraint unexpectedly accepted a negative version');
}

function assertLifetimeColumn() {
  assert.equal(scalar(`SELECT data_type || '|' || is_nullable || '|' || column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='BackgroundRuntimeConfig'
      AND column_name='checkoutRecoveryLifetimeDays'`), 'integer|NO|21',
  'recovery lifetime remains INTEGER NOT NULL DEFAULT 21');
  assert.equal(number(`SELECT count(*) FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='BackgroundRuntimeConfig'
      AND c.conname='ck_arch016_checkout_recovery_lifetime'`), 0,
  'the historical lifetime CHECK is absent after migration');
  assert.equal(number(`SELECT count(*) FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='BackgroundRuntimeConfig'
      AND c.conname='ck_arch014_background_runtime_config_version'`), 1,
  'the independent ARCH-014 version constraint remains present');
}

function assertValuesPersist(rowId) {
  for (const value of [0, 1, 21, 90, 91, 180, 365, 2147483647]) {
    sql(`UPDATE "public"."BackgroundRuntimeConfig"
      SET "checkoutRecoveryLifetimeDays"=${value} WHERE "id"='${rowId}'`);
    assert.equal(scalar(`SELECT "checkoutRecoveryLifetimeDays"
      FROM "public"."BackgroundRuntimeConfig" WHERE "id"='${rowId}'`), String(value),
    `recovery lifetime ${value} persists and reads back`);
  }
  console.log('PASS all requested non-negative INTEGER lifetime values persist and read back');
}

async function run() {
  let runAttempted = false;
  let cleanupError;
  try {
    runAttempted = true;
    docker(['run', '-d', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=arch016-test',
      '-e', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
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
    const priorIndex = names.indexOf(prior);
    const targetIndex = names.indexOf(target);
    assert.ok(priorIndex >= 0 && targetIndex > priorIndex, 'recovery lifetime removal must follow the historical ARCH-016 migration');
    assert.equal(names.at(-1), target, 'recovery lifetime removal must be the final ordered migration');
    const migration = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8').trim();
    assert.equal(migration, 'ALTER TABLE "public"."BackgroundRuntimeConfig"\n    DROP CONSTRAINT "ck_arch016_checkout_recovery_lifetime";',
      'forward migration drops only the named lifetime constraint');

    let upgradeBefore;
    for (const name of names) {
      if (mode === 'upgrade' && name === target) {
        sql(`UPDATE "public"."BackgroundRuntimeConfig"
          SET "version"=37,"checkoutRecoveryLifetimeDays"=21 WHERE "id"='default'`);
        upgradeBefore = scalar(`SELECT json_build_array("id","version","checkoutRecoveryLifetimeDays")
          FROM "public"."BackgroundRuntimeConfig" WHERE "id"='default'`);
        assert.ok(upgradeBefore, 'upgrade fixture must contain its existing singleton row');
        console.log('SEEDED existing singleton id/version/value immediately before target migration');
      }
      sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
      if (name === target) console.log(`APPLIED ${name}`);
    }

    assertLifetimeColumn();
    let rowId = 'default';
    if (mode === 'fresh') {
      sql(`INSERT INTO "public"."BackgroundRuntimeConfig" ("id","updatedAt")
        VALUES ('arch016-fresh-default',now())`);
      rowId = 'arch016-fresh-default';
      assert.equal(scalar(`SELECT "checkoutRecoveryLifetimeDays" FROM "public"."BackgroundRuntimeConfig"
        WHERE "id"='${rowId}'`), '21', 'fresh row receives the 21-day default');
      console.log('PASS fresh singleton default is 21 days');
    } else {
      const upgradeAfter = scalar(`SELECT json_build_array("id","version","checkoutRecoveryLifetimeDays")
        FROM "public"."BackgroundRuntimeConfig" WHERE "id"='default'`);
      assert.equal(upgradeAfter, upgradeBefore, 'upgrade preserves singleton ID, version, and lifetime value');
      console.log('PASS upgrade preserves existing singleton ID, version 37, and 21-day value');
    }
    assertIndependentConstraintRejectsInvalidVersion();
    assertValuesPersist(rowId);
    console.log(`PASS ARCH-016 recovery lifetime PostgreSQL ${mode}; ${names.length} migrations applied in order`);
  } finally {
    if (runAttempted) {
      try {
        docker(['rm', '-f', container]);
        console.log(`CLEANUP PASS removed disposable container ${container}`);
      } catch (error) {
        cleanupError = error;
        console.error(`CLEANUP FAIL for ${container}: ${error.stderr?.trim() ?? error.message}`);
      }
    }
  }
  if (cleanupError) throw cleanupError;
}

await run();