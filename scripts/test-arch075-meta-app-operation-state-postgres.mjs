import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const prisma = require.resolve('prisma/build/index.js');
const run = promisify(execFile);
const name = `moda-arch075-app-state-${randomUUID()}`;
const temporary = mkdtempSync(join(tmpdir(), 'moda-arch075-app-state-'));
const fixture = join(temporary, 'prisma');
const migrations = new URL('../prisma/migrations/', import.meta.url);
const target = readdirSync(migrations).find(entry => entry.endsWith('_arch075_meta_app_operation_state'));
assert.ok(target, 'exact task migration exists');
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sqlArgs = db => ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db];
const sql = (db, input) => docker(sqlArgs(db), input).trim();
const table = 'whatsapp."MetaTemplateAppOperationState"';
let cases = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); cases++; };
function reject(db, statement, reason) {
  assert.throws(() => sql(db, statement), error => String(error.stderr).includes(reason)); cases++;
}
const insert = (appId, fields = '', values = '') => `INSERT INTO ${table} (environment,"appId"${fields}) VALUES ('PRODUCTION','${appId}'${values})`;
const acquire = owner => `WITH changed AS (UPDATE ${table} SET "leaseOwnerToken"='${owner}',"leaseGeneration"="leaseGeneration"+1,"leaseAcquiredAt"=clock_timestamp(),"leaseUntil"=clock_timestamp()+interval '120 seconds',"updatedAt"=clock_timestamp() WHERE environment='PRODUCTION' AND "appId"='500' AND ("cooldownUntil" IS NULL OR "cooldownUntil"<=clock_timestamp()) AND ("leaseOwnerToken" IS NULL OR "leaseUntil"<=clock_timestamp()) RETURNING 1) SELECT count(*) FROM changed;`;
async function checks(db) {
  check(sql(db, 'SELECT domain FROM commerce."Shop" WHERE id=\'legacy-shop\''), 'legacy.fixture.example');
  sql(db, insert('1'));
  check(sql(db, `SELECT "consecutiveThrottleCount"||':'||"leaseGeneration"||':'||("leaseOwnerToken" IS NULL)::text FROM ${table} WHERE "appId"='1'`), '0:0:true');
  reject(db, insert('1'), 'MetaTemplateAppOperationState_pkey');
  sql(db, `INSERT INTO ${table}(environment,"appId") VALUES ('TEST','1')`);
  check(sql(db, `SELECT count(*) FROM ${table} WHERE "appId"='1'`), '2');
  for (const id of ['', 'abc', '1 2', '1/2', '12345678901234567890123456789012345']) reject(db, insert(id), id.length > 32 ? 'value too long' : 'MetaTemplateAppOperationState_appId_check');
  for (const count of [-1, 32]) reject(db, insert(`10${count === -1 ? 1 : 2}`, ',"consecutiveThrottleCount"', `,${count}`), 'MetaTemplateAppOperationState_throttle_count_check');
  reject(db, insert('20', ',"leaseGeneration"', ',-1'), 'MetaTemplateAppOperationState_generation_check');
  reject(db, insert('21', ',"leaseOwnerToken"', ",'owner'"), 'MetaTemplateAppOperationState_lease_check');
  reject(db, insert('22', ',"leaseOwnerToken","leaseAcquiredAt","leaseUntil"', ",'',now(),now()+interval '1 minute'"), 'MetaTemplateAppOperationState_lease_check');
  reject(db, insert('23', ',"leaseOwnerToken","leaseGeneration","leaseAcquiredAt","leaseUntil"', ",'owner',1,now(),now()-interval '1 minute'"), 'MetaTemplateAppOperationState_lease_check');
  reject(db, insert('24', ',"leaseOwnerToken","leaseAcquiredAt","leaseUntil"', ",'owner',now(),now()+interval '1 minute'"), 'MetaTemplateAppOperationState_lease_check');
  reject(db, `UPDATE ${table} SET "appId"='2' WHERE environment='PRODUCTION' AND "appId"='1'`, 'META_APP_OPERATION_IDENTITY_IMMUTABLE');
  reject(db, `UPDATE ${table} SET environment='TEST' WHERE environment='PRODUCTION' AND "appId"='1'`, 'META_APP_OPERATION_IDENTITY_IMMUTABLE');
  sql(db, insert('500'));
  const attempts = await Promise.all(['owner-a', 'owner-b'].map(owner => run('docker', sqlArgs(db).concat(['-c', acquire(owner)]), { encoding: 'utf8' })));
  check(attempts.map(result => Number(result.stdout.trim())).sort(), [0, 1]);
  const winner = sql(db, `SELECT "leaseOwnerToken" FROM ${table} WHERE "appId"='500'`);
  check(sql(db, `SELECT "leaseGeneration" FROM ${table} WHERE "appId"='500'`), '1');
  reject(db, `UPDATE ${table} SET "leaseOwnerToken"='thief',"leaseGeneration"=2,"leaseAcquiredAt"=clock_timestamp(),"leaseUntil"=clock_timestamp()+interval '2 minutes' WHERE "appId"='500'`, 'META_APP_OPERATION_LEASE_ACTIVE');
  reject(db, `UPDATE ${table} SET "leaseGeneration"=0 WHERE "appId"='500'`, 'META_APP_OPERATION_GENERATION_REGRESSION');
  // A legitimate completion must use the original owner AND generation fence.
  check(sql(db, `WITH changed AS (UPDATE ${table} SET "leaseOwnerToken"=NULL,"leaseAcquiredAt"=NULL,"leaseUntil"=NULL WHERE "appId"='500' AND "leaseOwnerToken"='stale' AND "leaseGeneration"=1 AND "leaseUntil">clock_timestamp() RETURNING 1) SELECT count(*) FROM changed`), '0');
  sql(db, `UPDATE ${table} SET "cooldownUntil"=clock_timestamp()+interval '15 minutes',"consecutiveThrottleCount"=1,"lastThrottleAt"=clock_timestamp(),"leaseOwnerToken"=NULL,"leaseAcquiredAt"=NULL,"leaseUntil"=NULL WHERE "appId"='500' AND "leaseOwnerToken"='${winner}' AND "leaseGeneration"=1 AND "leaseUntil">clock_timestamp()`);
  check(sql(db, acquire('owner-c')), '0');
  reject(db, `UPDATE ${table} SET "cooldownUntil"=NULL WHERE "appId"='500'`, 'META_APP_OPERATION_COOLDOWN_REGRESSION');
  reject(db, `UPDATE ${table} SET "cooldownUntil"=clock_timestamp()+interval '1 minute' WHERE "appId"='500'`, 'META_APP_OPERATION_COOLDOWN_REGRESSION');
  reject(db, `UPDATE ${table} SET "lastThrottleAt"=NULL WHERE "appId"='500'`, 'META_APP_OPERATION_THROTTLE_TIME_REGRESSION');
  reject(db, `UPDATE ${table} SET "lastThrottleAt"="lastThrottleAt"-interval '1 minute' WHERE "appId"='500'`, 'META_APP_OPERATION_THROTTLE_TIME_REGRESSION');
  reject(db, `DELETE FROM ${table} WHERE "appId"='500'`, 'META_APP_OPERATION_STATE_DELETE_FORBIDDEN');
  // Expired ownership can be reclaimed with a new generation; late old completions lose.
  sql(db, insert('600', ',"leaseOwnerToken","leaseGeneration","leaseAcquiredAt","leaseUntil"', ",'expired',7,now()-interval '4 minutes',now()-interval '2 minutes'"));
  reject(db, `UPDATE ${table} SET "leaseOwnerToken"='new',"leaseAcquiredAt"=clock_timestamp(),"leaseUntil"=clock_timestamp()+interval '2 minutes' WHERE "appId"='600'`, 'META_APP_OPERATION_NEW_LEASE_GENERATION_REQUIRED');
  sql(db, `UPDATE ${table} SET "leaseOwnerToken"='new',"leaseGeneration"=8,"leaseAcquiredAt"=clock_timestamp(),"leaseUntil"=clock_timestamp()+interval '2 minutes' WHERE "appId"='600' AND "leaseGeneration"=7 AND "leaseUntil"<=clock_timestamp()`);
  check(sql(db, `WITH changed AS (UPDATE ${table} SET "leaseOwnerToken"=NULL,"leaseAcquiredAt"=NULL,"leaseUntil"=NULL,"cooldownUntil"=NULL WHERE "appId"='600' AND "leaseOwnerToken"='expired' AND "leaseGeneration"=7 AND "leaseUntil">clock_timestamp() RETURNING 1) SELECT count(*) FROM changed`), '0');
  check(sql(db, `SELECT "leaseOwnerToken"||':'||"leaseGeneration" FROM ${table} WHERE "appId"='600'`), 'new:8');
  // Old writers can continue inserting ordinary shops; no new relation/required field.
  sql(db, `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('old-writer','old-writer.fixture.example',now())`);
  check(sql(db, `SELECT count(*) FROM commerce."Shop"`), '2');
}
try {
  docker(['run', '-d', '--name', name, '--label', 'moda.task=ARCH-075-DATABASE-002', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=fixture-only', '-e', 'POSTGRES_DB=fixture', 'pgvector/pgvector:pg17']);
  let ready = false; for (let i = 0; i < 40; i++) { try { sql('fixture', 'SELECT 1'); ready = true; break; } catch { await delay(500); } }
  assert.ok(ready, 'invocation-owned PostgreSQL ready');
  const mapping = docker(['port', name, '5432/tcp']).trim(); assert.match(mapping, /^127\.0\.0\.1:\d+$/);
  mkdirSync(join(fixture, 'migrations'), { recursive: true });
  cpSync(new URL('../prisma/schema.prisma', import.meta.url), join(fixture, 'schema.prisma'));
  for (const entry of readdirSync(migrations).filter(entry => entry !== target)) cpSync(new URL(entry, migrations), join(fixture, 'migrations', entry), { recursive: true });
  const deploy = db => {
    const databaseUrl = `postgresql://postgres:fixture-only@${mapping}/${db}`;
    const parsed = new URL(databaseUrl); assert.equal(parsed.hostname, '127.0.0.1'); assert.ok(['fresh', 'upgrade'].includes(parsed.pathname.slice(1)));
    return execFileSync(process.execPath, [prisma, 'migrate', 'deploy', '--schema', join(fixture, 'schema.prisma')], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl }, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  };
  sql('fixture', 'CREATE DATABASE fresh; CREATE DATABASE upgrade;');
  deploy('upgrade');
  sql('upgrade', `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('legacy-shop','legacy.fixture.example',now())`);
  const before = sql('upgrade', 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  cpSync(new URL(target, migrations), join(fixture, 'migrations', target), { recursive: true });
  deploy('fresh');
  sql('fresh', `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('legacy-shop','legacy.fixture.example',now())`);
  deploy('upgrade');
  check(Number(sql('upgrade', 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')), Number(before) + 1);
  for (const db of ['fresh', 'upgrade']) {
    assert.ok(deploy(db).includes('No pending migrations'));
    await checks(db);
    console.log(`PASS ${db}: actual Prisma migrate deploy, app identity, guards, replica CAS, stale ownership and legacy preservation`);
  }
  console.log(`PASS ARCH-075-DATABASE-002 ${cases} assertions; no hosted database or provider requests`);
} finally {
  docker(['rm', '-f', '--volumes', name]);
  rmSync(temporary, { recursive: true, force: true });
  console.log('Removed invocation-owned PostgreSQL and migration fixtures');
}
