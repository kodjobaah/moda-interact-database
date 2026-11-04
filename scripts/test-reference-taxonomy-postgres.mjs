import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  seedUpgrade, capturePreserved, assertConversion, captureGuards,
  runTaxonomyCases, runGrantCases, conflictSql,
} from './fixtures/reference-taxonomy-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = '20261104120000_reference_taxonomy_and_core_product_discovery';
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]),
  'Usage: --mode fresh|upgrade');
const mode = args[1];
const container = `moda-reference-taxonomy-${randomUUID()}`;
const password = randomUUID();
const staging = mkdtempSync(path.join(tmpdir(), 'moda-reference-taxonomy-'));
const migrationRoot = path.join(root, 'prisma/migrations');
const migrations = readdirSync(migrationRoot).filter(name => /^\d{14}_/.test(name)).sort();
assert.equal(migrations.at(-1), target, 'Reserved taxonomy migration must follow the accepted chain');
const predecessors = migrations.slice(0, -1);
let started = false;
let hostPort;
let currentDatabase = 'reference_taxonomy';
let blocker;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024, ...options,
  });
}
function execute(statement, database = currentDatabase) {
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-U', 'postgres', '-d', database,
  ], { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function sql(statement) {
  const result = execute(statement);
  assert.equal(result.status, 0, result.stderr?.slice(0, 4096));
  return result.stdout.trim();
}
function json(expression) {
  return JSON.parse(sql(`SELECT coalesce((${expression})::jsonb, 'null'::jsonb)::text;`));
}
function reject(label, statement, diagnostic, code = '23514') {
  const result = execute(`BEGIN;\n${statement};\nROLLBACK;`);
  assert.notEqual(result.status, 0, `${label}: invalid statement succeeded`);
  assert.ok(result.stderr.includes(code) && result.stderr.includes(diagnostic),
    `${label}: expected ${code}/${diagnostic}, got ${result.stderr.slice(0, 4096)}`);
  console.log(`PASS ${label} (${code}, ${diagnostic})`);
}
const fixture = { sql, json, reject };
function databaseUrl(database) {
  return `postgresql://postgres:${password}@127.0.0.1:${hostPort}/${database}`;
}
function deploy(database, expectFailure) {
  const beganAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [
    path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
    '--schema', path.join(staging, 'prisma/schema.prisma'),
  ], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl(database), DIRECT_URL: databaseUrl(database) },
    encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout}\n${result.stderr}`.replaceAll(password, '[REDACTED]');
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'Conflicting migration unexpectedly succeeded');
    // Prisma can report only 25P02 after an explicit migration transaction
    // fails. Retain its output and PostgreSQL's originating diagnostic.
    const logs = spawnSync('docker', ['logs', '--since', beganAt, container], {
      encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (logs.error) throw logs.error;
    assert.equal(logs.status, 0, logs.stderr?.slice(-2048));
    const serverDiagnostic = (logs.stdout + logs.stderr).split('\n')
      .filter(line => line.includes('db=' + database + ' '))
      .join('\n').replaceAll(password, '[REDACTED]').slice(-4096);
    assert.ok(serverDiagnostic.includes(expectFailure), output.slice(-4096) + '\n' + serverDiagnostic);
    console.log(`PASS migration rejection ${expectFailure}; Prisma exit=${result.status}\n${output.slice(-2048)}\n${serverDiagnostic}`);
  } else {
    assert.equal(result.status, 0, output.slice(-4096));
  }
  return output;
}
function migrationHistory() {
  return json(`(SELECT jsonb_agg(jsonb_build_array(migration_name,checksum,finished_at,rolled_back_at)
    ORDER BY migration_name) FROM "_prisma_migrations" WHERE migration_name <> '${target}')`);
}
async function ready() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (execute('SELECT 1;').status === 0) return;
    await delay(1000);
  }
  throw new Error('Disposable PostgreSQL readiness timeout');
}
function cloneDatabase(name, template = 'reference_taxonomy') {
  const result = execute(`CREATE DATABASE "${name}" TEMPLATE "${template}";`, 'postgres');
  assert.equal(result.status, 0, result.stderr);
  currentDatabase = name;
}
async function lockInventory() {
  blocker = spawn('docker', [
    'exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', currentDatabase,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  blocker.stderr.on('data', () => {});
  blocker.stdout.on('data', () => {});
  blocker.stdin.end(`SET application_name='reference-taxonomy-blocker';
    BEGIN;
    INSERT INTO commerce."CommerceTool" (id,name,"displayName")
      VALUES ('reference-concurrent-tool','reference_concurrent_tool','Concurrent writer');
    INSERT INTO commerce."CommerceCapability" (id,key,"displayName","featureId","toolId")
      SELECT 'reference-concurrent-capability','reference_concurrent_capability','Concurrent writer',
        id,'reference-concurrent-tool' FROM billing."Feature" WHERE key='product_search';
    SELECT pg_sleep(45); ROLLBACK;`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (sql(`SELECT count(*) FROM pg_locks lock JOIN pg_stat_activity activity USING(pid)
      WHERE activity.application_name='reference-taxonomy-blocker' AND lock.granted
      AND lock.relation='commerce."CommerceCapability"'::regclass
      AND lock.mode='RowExclusiveLock';`) === '1') return;
    await delay(100);
  }
  throw new Error('Inventory writer failed to acquire its barrier lock');
}
function releaseInventory() {
  sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE application_name='reference-taxonomy-blocker' AND datname=current_database();`);
  blocker?.kill();
  blocker = undefined;
}

try {
  // An inherited DATABASE_URL is never used. Only this invocation's random
  // loopback port and database names are supplied to Prisma.
  started = true;
  docker(['run', '--detach', '--name', container,
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=reference_taxonomy',
    '--publish', '127.0.0.1::5432', 'pgvector/pgvector:pg17',
    'postgres', '-c', 'log_line_prefix=%m [%p] db=%d code=%e ',
    '-c', 'log_error_verbosity=verbose', '-c', 'log_min_error_statement=panic']);
  await ready();
  hostPort = docker(['port', container, '5432/tcp']).trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  assert.ok(hostPort, 'Disposable database must expose only a random loopback port');
  const versions = json(`jsonb_build_object('postgres',current_setting('server_version'),
    'vector',(SELECT extversion FROM pg_extension WHERE extname='vector'))`);
  assert.equal(Number(versions.postgres.split('.')[0]), 17);
  console.log(`ISOLATION image=pgvector/pgvector:pg17 PostgreSQL=${versions.postgres}`);
  mkdirSync(path.join(staging, 'prisma/migrations'), { recursive: true });
  cpSync(path.join(root, 'prisma/schema.prisma'), path.join(staging, 'prisma/schema.prisma'), { recursive: false });
  cpSync(path.join(migrationRoot, 'migration_lock.toml'), path.join(staging, 'prisma/migrations/migration_lock.toml'));
  for (const name of predecessors) {
    cpSync(path.join(migrationRoot, name), path.join(staging, 'prisma/migrations', name), { recursive: true });
  }
  deploy(currentDatabase);
  const history = migrationHistory();
  assert.equal(history.length, predecessors.length);
  for (const [name, checksum] of history) {
    assert.equal(checksum, createHash('sha256').update(readFileSync(path.join(migrationRoot, name, 'migration.sql'))).digest('hex'));
  }
  if (mode === 'upgrade') {
    cloneDatabase('predecessor_template');
    currentDatabase = 'reference_taxonomy';
    seedUpgrade(fixture);
  }
  const preserved = capturePreserved(fixture);
  const guards = captureGuards(fixture);
  cpSync(path.join(migrationRoot, target), path.join(staging, 'prisma/migrations', target), { recursive: true });

  if (mode === 'upgrade') {
    for (const kind of ['unknown', 'unowned', 'wrong-tool', 'wildcard-audit', 'missing-feature', 'primary-collision', 'lock-timeout']) {
      cloneDatabase(`conflict_${kind.replaceAll('-', '_')}`, ['primary-collision', 'lock-timeout'].includes(kind) ? 'reference_taxonomy' : 'predecessor_template');
      const mutation = conflictSql(kind);
      if (mutation) sql(mutation);
      const before = capturePreserved(fixture, true);
      const feature = json(`(SELECT to_jsonb(row) FROM billing."Feature" row WHERE key='product_search')`);
      if (kind === 'lock-timeout') await lockInventory();
      try {
        deploy(currentDatabase, kind === 'missing-feature' ? 'PRODUCT_DISCOVERY_FEATURE_MISSING'
          : kind === 'lock-timeout' ? 'canceling statement due to lock timeout'
            : kind === 'primary-collision' ? 'BillingPlanFeature_pkey' : 'PRODUCT_DISCOVERY_MEMBERSHIP_CONFLICT');
      } finally {
        if (blocker) releaseInventory();
      }
      assert.equal(sql(`SELECT to_regclass('commerce."ReferenceTaxonomyGeneration"') IS NULL;`), 't');
      assert.deepEqual(capturePreserved(fixture, true), before);
      assert.deepEqual(json(`(SELECT to_jsonb(row) FROM billing."Feature" row WHERE key='product_search')`), feature);
      assert.deepEqual(captureGuards(fixture), guards);
      assert.deepEqual(migrationHistory(), history);
      console.log(`PASS ${kind} rollback preserves schema, functions, feature, and existing rows`);
      currentDatabase = 'reference_taxonomy';
    }
  }

  deploy(currentDatabase);
  assert.deepEqual(capturePreserved(fixture), preserved);
  assert.deepEqual(captureGuards(fixture), guards, 'Function identity, owners/ACLs and CHECK/trigger bindings must survive');
  assertConversion(fixture, mode);
  runTaxonomyCases(fixture);
  await runGrantCases(fixture, mode);
  const after = capturePreserved(fixture, true);
  const targetRows = sql(`SELECT count(*) FROM "_prisma_migrations" WHERE migration_name='${target}' AND finished_at IS NOT NULL;`);
  assert.equal(targetRows, '1');
  const rerun = deploy(currentDatabase);
  assert.match(rerun, /No pending migrations/);
  assert.deepEqual(capturePreserved(fixture, true), after);
  assert.deepEqual(migrationHistory(), history);
  console.log(`PASS ${mode}: migrate deploy rerun is a recorded no-op; predecessor checksums preserved`);
  console.log(`VERSIONS pgvector=${sql("SELECT extversion FROM pg_extension WHERE extname='vector';")}`);
} catch (error) {
  // Keep the original error/cause while bounding and redacting printed output.
  console.error(String(error.stack ?? error).replaceAll(password, '[REDACTED]').slice(0, 8192));
  process.exitCode = 1;
} finally {
  blocker?.kill();
  if (started) {
    try { docker(['rm', '--force', '--volumes', container]); }
    catch (error) { console.error(String(error).replaceAll(password, '[REDACTED]').slice(0, 2048)); process.exitCode = 1; }
  }
  rmSync(staging, { recursive: true, force: true });
}
