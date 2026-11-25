import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Always create a disposable database. Never read DATABASE_URL or connect to
// the merchant's database. Check both fresh and populated upgrade paths.
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]), 'Usage: --mode fresh|upgrade');
const mode = args[1];
const migration = '20261125190000_recovery_delivery_retry_runtime_config';
const directory = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-retry-config-${randomUUID()}`;
const database = 'retry_config_fixture';
const docker = (command, options = {}) => execFileSync('docker', command, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
const sql = statement => docker(['exec', '-i', '-e', 'PGPASSWORD=fixture-only', '-e', 'PGCONNECT_TIMEOUT=2',
  container, 'psql', '-X', '-qAt', '-w', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
  { input: statement, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function apply(name) {
  sql(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function expectState(statement, state) {
  sql(`DO $test$ DECLARE actual text; BEGIN
    BEGIN ${statement.replace(/;\s*$/, '')};
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;
    IF actual IS DISTINCT FROM '${state}' THEN RAISE EXCEPTION 'Expected SQLSTATE %, received %', '${state}', actual; END IF;
  END $test$;`);
}
const table = 'public."BackgroundRuntimeConfig"';
const columns = '"recoveryDeliveryTemporaryRetryDelayMinutes", "recoveryDeliveryRateLimitRetryDelayMinutes", "recoveryDeliveryMarketingRetryDelayMinutes", "recoveryDeliveryMaxRetries"';
const defaults = '5|15|1440|3';
const row = () => JSON.parse(sql(`SELECT to_jsonb(t) FROM ${table} t WHERE "id"='default';`));
let started = false;
try {
  docker(['run', '--detach', '--name', container, '--network', 'none', '--env', 'POSTGRES_PASSWORD=fixture-only', '--env', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if (sql('SELECT 1;') === '1') { ready = true; break; } } catch { /* permanent server not ready */ }
    await delay(500);
  }
  assert.ok(ready, 'Disposable PostgreSQL failed to start');
  const names = readdirSync(directory).filter(name => /^\d{14}_/.test(name) && name <= migration).sort();
  assert.ok(names.includes(migration));
  for (const name of names.filter(name => name !== migration)) apply(name);
  let before;
  if (mode === 'upgrade') {
    sql(`UPDATE ${table} SET "checkoutRecoveryLifetimeDays"=180,"version"=17 WHERE "id"='default';`);
    before = row();
  }
  apply(migration);
  assert.equal(sql(`SELECT ${columns} FROM ${table} WHERE "id"='default';`), defaults);
  if (before) {
    const after = row();
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], key);
  }
  for (const [key, invalid] of [['recoveryDeliveryTemporaryRetryDelayMinutes', 0], ['recoveryDeliveryRateLimitRetryDelayMinutes', 0], ['recoveryDeliveryMarketingRetryDelayMinutes', 1439], ['recoveryDeliveryMaxRetries', -1]]) {
    expectState(`UPDATE ${table} SET "${key}"=${invalid} WHERE "id"='default'`, '23514');
    expectState(`UPDATE ${table} SET "${key}"=NULL WHERE "id"='default'`, '23502');
  }
  sql(`UPDATE ${table} SET "recoveryDeliveryTemporaryRetryDelayMinutes"=7,"recoveryDeliveryRateLimitRetryDelayMinutes"=29,"recoveryDeliveryMarketingRetryDelayMinutes"=2880,"recoveryDeliveryMaxRetries"=0 WHERE "id"='default';`);
  assert.equal(sql(`SELECT ${columns} FROM ${table} WHERE "id"='default';`), '7|29|2880|0');
  assert.equal(sql('SELECT count(*) FROM commerce."RecoveryOutreachRetryIntent";'), '0');
  console.log(`PASS recovery delivery retry runtime configuration PostgreSQL ${mode}`);
} finally {
  if (started) { docker(['rm', '--force', '--volumes', container]); console.log(`CLEANUP ${container}`); }
}
