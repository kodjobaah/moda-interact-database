import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  seedUpgrade, capturePreserved, assertConversion, captureGuards,
  captureLegacyGrant, assertLegacyGrantConverted,
  runTaxonomyCases, runGrantCases,
} from './fixtures/reference-taxonomy-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = '20261104162500_arch058_remove_builtin_contract_hash';
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]),
  'Usage: --mode fresh|upgrade');
const mode = args[1];
const container = `moda-reference-taxonomy-${randomUUID()}`;
const password = randomUUID();
const staging = mkdtempSync(path.join(tmpdir(), 'moda-reference-taxonomy-'));
const migrationRoot = path.join(root, 'prisma/migrations');
const migrations = readdirSync(migrationRoot).filter(name => /^\d{14}_/.test(name)).sort();
assert.equal(migrations.at(-1), target, 'Built-in grant correction must follow the accepted migration chain');
const predecessors = migrations.slice(0, -1);
let started = false;
let hostPort;
let currentDatabase = 'reference_taxonomy';

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
    if (result.status !== 0) {
      const logs = spawnSync('docker', ['logs', '--since', beganAt, container], {
        encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
      });
      if (logs.error) throw logs.error;
      const serverDiagnostic = (logs.stdout + logs.stderr).split('\n')
        .filter(line => line.includes('db=' + database + ' '))
        .join('\n').replaceAll(password, '[REDACTED]').slice(-4096);
      assert.equal(result.status, 0, output.slice(-4096) + '\n' + serverDiagnostic);
    }
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
  const legacyGrant = mode === 'upgrade' ? captureLegacyGrant(fixture) : null;
  const preserved = capturePreserved(fixture);
  const completeBefore = mode === 'upgrade' ? capturePreserved(fixture, true) : null;
  const guards = captureGuards(fixture);
  cpSync(path.join(migrationRoot, target), path.join(staging, 'prisma/migrations', target), { recursive: true });

  if (mode === 'upgrade') {
    cloneDatabase('injected_failure');
    const migrationSql = readFileSync(path.join(migrationRoot, target, 'migration.sql'), 'utf8');
    const injectedSql = migrationSql.replace('COMMIT;', "DO $$ BEGIN RAISE EXCEPTION 'ARCH058_INJECTED_FAILURE'; END $$;\nCOMMIT;");
    assert.notEqual(injectedSql, migrationSql, 'Failure injection point must exist before COMMIT');
    const failure = execute(injectedSql);
    assert.notEqual(failure.status, 0, 'Injected migration failure unexpectedly succeeded');
    assert.ok(failure.stderr.includes('ARCH058_INJECTED_FAILURE'), failure.stderr.slice(0, 4096));
    const injectedJson = expression => {
      const result = execute(`SELECT coalesce((${expression})::jsonb, 'null'::jsonb)::text;`, 'injected_failure');
      assert.equal(result.status, 0, result.stderr?.slice(0, 4096));
      return JSON.parse(result.stdout.trim());
    };
    assert.deepEqual(capturePreserved({ sql, json: injectedJson }, true), completeBefore);
    assert.deepEqual(injectedJson(`(SELECT to_jsonb(row) FROM commerce."CommerceConversationGrant" row
      WHERE id='reference-legacy-grant')`), legacyGrant);
    assert.deepEqual(injectedJson(`jsonb_build_object(
      'functions',(SELECT jsonb_agg(jsonb_build_array(oid,proname,proowner,proacl) ORDER BY proname)
        FROM pg_proc WHERE oid IN ('commerce.arch020_grant_tools(jsonb)'::regprocedure,
          'commerce.arch021_conversation_grant_guard()'::regprocedure)),
      'triggers',(SELECT jsonb_agg(jsonb_build_array(tgname,tgfoid,tgenabled,pg_get_triggerdef(oid)) ORDER BY tgname)
        FROM pg_trigger WHERE tgrelid='commerce."CommerceConversationGrant"'::regclass AND NOT tgisinternal),
      'checks',(SELECT jsonb_agg(jsonb_build_array(oid,conname,pg_get_constraintdef(oid)) ORDER BY conname)
        FROM pg_constraint WHERE conrelid='commerce."CommerceConversationGrant"'::regclass))`), guards);
    assert.equal(injectedJson(`to_jsonb((SELECT count(*) FROM "_prisma_migrations" WHERE migration_name='${target}'))`), 0);
    currentDatabase = 'reference_taxonomy';
    console.log('PASS injected failure rolls back helper replacement, row rewrite and trigger drop');
  }

  deploy(currentDatabase);
  const preservedAfter = capturePreserved(fixture);
  const expectedPreserved = structuredClone(preserved);
  if (mode === 'upgrade') {
    const grantIndex = expectedPreserved['commerce."CommerceConversationGrant"'].findIndex(row => row.id === 'reference-legacy-grant');
    const grant = expectedPreserved['commerce."CommerceConversationGrant"'][grantIndex];
    grant.grantedTools = grant.grantedTools.map(tool => tool.kind === 'BUILT_IN'
      ? { kind: tool.kind, toolName: tool.toolName, definitionVersion: '2.0.0' }
      : tool);
  }
  assert.deepEqual(preservedAfter, expectedPreserved);
  assert.deepEqual(captureGuards(fixture), guards, 'Function identity, owners/ACLs and CHECK/trigger bindings must survive');
  if (mode === 'upgrade') assertLegacyGrantConverted(fixture, legacyGrant);
  if (mode === 'fresh') assertConversion(fixture, mode);
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
  if (started) {
    try { docker(['rm', '--force', '--volumes', container]); }
    catch (error) { console.error(String(error).replaceAll(password, '[REDACTED]').slice(0, 2048)); process.exitCode = 1; }
  }
  rmSync(staging, { recursive: true, force: true });
}
