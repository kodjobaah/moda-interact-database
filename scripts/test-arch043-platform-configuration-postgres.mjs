import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise SQL-level guarantees and the writer's REQUIRED atomic SQL pattern.
// This is not an Admin writer or cryptography implementation. Callers must
// authorise actors, validate exact JSON shapes, and seal with version-bound AAD.
const mode = process.argv.at(process.argv.indexOf('--mode') + 1);
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh or --mode upgrade');
const target = '20261017150000_arch043_platform_configuration';
const forwardMigrationId = '20261017194500_arch043_remove_platform_configuration_audit_secret_redacted';
const migrations = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-arch043-db001-${randomUUID()}`;
const db = 'arch043_configuration_fixture';
const config = '"public"."PlatformConfiguration"';
const audit = '"public"."PlatformConfigurationAudit"';
let started = false;
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', db];
function psql(statement) { return docker(psqlArgs, { input: statement }).trim(); }
function scalar(statement) { return psql(statement).split('\n').at(-1).trim(); }
function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function json(value) { return `${quote(JSON.stringify(value))}::jsonb`; }
function rejected(name, statement) {
  try { psql(statement); } catch (error) {
    assert.match(String(error.stderr ?? ''), /ERROR:/, `${name} must be rejected by PostgreSQL`);
    return;
  }
  assert.fail(`${name} unexpectedly succeeded`);
}
const id = () => quote(randomUUID());
const sealed = text => ({
  kind: 'sealed', schemaVersion: 1, algorithm: 'AES-256-GCM', wrappingKeyId: 'test-wrap-v1',
  nonce: 'bm9uY2U=', ciphertext: text, authTag: 'dGFn',
});
const disabled = { kind: 'disabled', schemaVersion: 1 };
const redacted = configured => ({ redacted: true, configured });

// One PostgreSQL statement is one atomic transaction: if the audit INSERT
// fails, the row insertion fails with it; conflict returns 0 (without audit).
function createStatement(environment, key, value, after = value, actor = 'arch043-admin') {
  return `WITH written AS (
    INSERT INTO ${config} ("id","environment","key","value","version","updatedBy","updatedAt")
    VALUES (${id()},${quote(environment)},${quote(key)},${json(value)},1,${quote(actor)},now())
    ON CONFLICT ("environment","key") DO NOTHING
    RETURNING "environment","key","version"
  ), recorded AS (
    INSERT INTO ${audit} ("id","environment","key","expectedVersion","resultingVersion",
      "beforeValue","afterValue","actorId")
    SELECT ${id()},"environment","key",0,"version",NULL,${json(after)},${quote(actor)} FROM written
    RETURNING 1
  ) SELECT count(*) FROM recorded;`;
}
// Only the row matching the trusted environment, key AND expected version can
// change. The old value is read in the same transaction as the guarded update.
function casStatement(environment, key, expected, next, beforeAudit, afterAudit,
  { actor = 'arch043-admin', invalidAudit = false } = {}) {
  return `WITH previous AS MATERIALIZED (
      SELECT "value" FROM ${config}
      WHERE "environment"=${quote(environment)} AND "key"=${quote(key)} AND "version"=${expected}
  ), written AS (
      UPDATE ${config} SET "value"=${json(next)}, "version"="version"+1,
        "updatedBy"=${quote(actor)},"updatedAt"=now()
      WHERE "environment"=${quote(environment)} AND "key"=${quote(key)}
        AND "version"=${expected} AND EXISTS (SELECT 1 FROM previous)
      RETURNING "environment","key","version"
  ), recorded AS (
      INSERT INTO ${audit} ("id","environment","key","expectedVersion","resultingVersion",
        "beforeValue","afterValue","actorId","reason")
      SELECT ${id()},written."environment",written."key",${expected},
        written."version"${invalidAudit ? '+1' : ''},
        ${beforeAudit === undefined ? 'previous."value"' : json(beforeAudit)},
        ${json(afterAudit)},${quote(actor)},'ARCH-043 SQL CAS proof'
      FROM written CROSS JOIN previous RETURNING 1
  ) SELECT count(*) FROM recorded;`;
}
function readValue(environment, key) {
  return JSON.parse(scalar(`SELECT "value"::text FROM ${config} WHERE "environment"=${quote(environment)} AND "key"=${quote(key)};`));
}
function version(environment, key) {
  return Number(scalar(`SELECT "version" FROM ${config} WHERE "environment"=${quote(environment)} AND "key"=${quote(key)};`));
}
function revisions(environment, key) {
  return JSON.parse(scalar(`SELECT coalesce(jsonb_agg("resultingVersion" ORDER BY "resultingVersion"), '[]'::jsonb)
    FROM ${audit} WHERE "environment"=${quote(environment)} AND "key"=${quote(key)};`));
}
async function concurrentPsql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Number(stdout.trim().split('\n').at(-1))) : reject(new Error(stderr)));
    child.stdin.end(`SELECT pg_sleep(0.2);\n${statement}`);
  });
}
function apply(name) {
  psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function assertGuards() {
  const keys = ['commerce.connectionKeys', 'auth.admin', 'auth.commerce', 'shopify.oauth', 'messaging.meta'];
  for (const key of keys) {
    const prefix = `INSERT INTO ${config} ("id","environment","key","value","updatedAt") VALUES
      (${id()},'test',${quote(key)},`;
    for (const [name, value] of [
      ['plain secret', { AUTH_SECRET: 'sensitive' }],
      ['missing marker', { ...sealed('YQ=='), authTag: undefined }],
      ['additional plaintext field', { ...sealed('YQ=='), accessToken: 'sensitive' }],
      ['invalid version', { ...sealed('YQ=='), schemaVersion: 2 }],
      ['unapproved algorithm', { ...sealed('YQ=='), algorithm: 'none' }],
      ['invalid tombstone', { ...disabled, SECRET: 'sensitive' }],
    ]) rejected(`${key}: ${name}`, `${prefix}${json(value)},now());`);
    psql(`${prefix}${json(disabled)},now());`);
    // The forward migration permits additional safe audit metadata for every
    // configuration key, including previously fixed-shape secret keys.
    // Application writers are still responsible for redacting secret material.
    const auditId = randomUUID();
    const before = { ...redacted(true), operation: 'IMPORT' };
    const after = { ...redacted(true), operation: 'ROTATE', changedFields: ['appSecret'] };
    psql(`INSERT INTO ${audit} ("id","environment","key","expectedVersion",
      "resultingVersion","beforeValue","afterValue","actorId") VALUES
      (${quote(auditId)},'test',${quote(key)},0,1,${json(before)},${json(after)},'arch043-admin');`);
    assert.deepEqual(JSON.parse(scalar(`SELECT "afterValue"::text FROM ${audit}
      WHERE "id"=${quote(auditId)};`)), after);
  }
  rejected('blank environment', `INSERT INTO ${config} ("id","environment","key","value","updatedAt")
    VALUES (${id()},'  ','commerce.preview','{}',now());`);
  rejected('blank key', `INSERT INTO ${config} ("id","environment","key","value","updatedAt")
    VALUES (${id()},'test',' ','{}',now());`);
  rejected('array value', `INSERT INTO ${config} ("id","environment","key","value","updatedAt")
    VALUES (${id()},'test','other','[]',now());`);
  rejected('version zero', `INSERT INTO ${config} ("id","environment","key","value","version","updatedAt")
    VALUES (${id()},'test','other','{}',0,now());`);
  rejected('wrong audit revision', `INSERT INTO ${audit} ("id","environment","key","expectedVersion",
    "resultingVersion","afterValue","actorId") VALUES (${id()},'test','other',1,3,'{}','arch043-admin');`);
  rejected('blank audit actor', `INSERT INTO ${audit} ("id","environment","key","expectedVersion",
    "resultingVersion","afterValue","actorId") VALUES (${id()},'test','other',0,1,'{}','   ');`);
}
async function assertTransactions() {
  const key = 'commerce.preview';
  const initial = { deadlineMs: 10000, outputTokens: 100 };
  const updated = { deadlineMs: 15000, outputTokens: 200 };
  const safeDefault = { deadlineMs: 10000, outputTokens: 100 };
  assert.equal(Number(scalar(createStatement('test', key, initial))), 1);
  assert.equal(Number(scalar(createStatement('test', key, updated))), 0, 'concurrent duplicate cannot insert');
  assert.deepEqual(revisions('test', key), [1]);
  assert.equal(Number(scalar(casStatement('test', key, 1, updated, undefined, updated))), 1);
  assert.equal(Number(scalar(casStatement('test', key, 1, initial, undefined, initial))), 0);
  assert.equal(version('test', key), 2);
  assert.deepEqual(revisions('test', key), [1, 2]);
  // Reset keeps the row and the monotonic revision, preventing stale create-clear-replay.
  assert.equal(Number(scalar(casStatement('test', key, 2, safeDefault, undefined, safeDefault))), 1);
  assert.equal(Number(scalar(createStatement('test', key, initial))), 0);
  assert.equal(Number(scalar(casStatement('test', key, 1, initial, undefined, initial))), 0);
  assert.equal(version('test', key), 3);
  assert.deepEqual(revisions('test', key), [1, 2, 3]);
  // A failed audit rejects the entire statement: neither row nor version changes.
  rejected('audit insertion rollback', casStatement('test', key, 3, updated, undefined, updated, { invalidAudit: true }));
  assert.equal(version('test', key), 3);
  assert.deepEqual(readValue('test', key), safeDefault);
  assert.deepEqual(revisions('test', key), [1, 2, 3]);
  rejected('create audit rollback', createStatement('staging', key, initial, []));
  assert.equal(scalar(`SELECT count(*) FROM ${config} WHERE "environment"='staging';`), '0');

  assert.equal(Number(scalar(createStatement('production', key, updated))), 1);
  assert.equal(version('production', key), 1);
  assert.equal(version('test', key), 3);
  assert.equal(Number(scalar(casStatement('test', key, 3, updated, undefined, updated))), 1);
  assert.equal(version('production', key), 1, 'environment isolation');

  const secretKey = 'shopify.oauth';
  assert.equal(Number(scalar(createStatement('production', secretKey, sealed('YQ=='), redacted(true)))), 1);
  assert.equal(Number(scalar(casStatement('production', secretKey, 1, sealed('Yg=='),
    redacted(true), redacted(true)))), 1);
  assert.equal(Number(scalar(casStatement('production', secretKey, 2, disabled,
    redacted(true), redacted(false)))), 1);
  assert.equal(Number(scalar(casStatement('production', secretKey, 1, sealed('Yw=='),
    redacted(true), redacted(true)))), 0, 'revoked secret cannot be resurrected by stale writer');
  assert.deepEqual(readValue('production', secretKey), disabled);
  assert.equal(version('production', secretKey), 3);
  assert.deepEqual(revisions('production', secretKey), [1, 2, 3]);
  const safeAudit = JSON.parse(scalar(`SELECT jsonb_agg(jsonb_build_object('before', "beforeValue", 'after', "afterValue")
    ORDER BY "resultingVersion") FROM ${audit} WHERE "environment"='production' AND "key"='shopify.oauth';`));
  assert.deepEqual(safeAudit, [
    { before: null, after: redacted(true) },
    { before: redacted(true), after: redacted(true) },
    { before: redacted(true), after: redacted(false) },
  ]);

  const concurrentKey = 'support.translation';
  assert.equal(Number(scalar(createStatement('test', concurrentKey, { provider: 'openai', model: 'initial' }))), 1);
  const contenders = await Promise.all([
    concurrentPsql(casStatement('test', concurrentKey, 1, { provider: 'openai', model: 'first' }, undefined,
      { provider: 'openai', model: 'first' })),
    concurrentPsql(casStatement('test', concurrentKey, 1, { provider: 'openai', model: 'second' }, undefined,
      { provider: 'openai', model: 'second' })),
  ]);
  assert.equal(contenders.reduce((sum, result) => sum + result, 0), 1, 'only one concurrent writer may win');
  assert.equal(version('test', concurrentKey), 2);
  assert.deepEqual(revisions('test', concurrentKey), [1, 2]);

  rejected('audit UPDATE', `UPDATE ${audit} SET "reason"='tamper' WHERE "environment"='test';`);
  rejected('audit DELETE', `DELETE FROM ${audit} WHERE "environment"='test';`);
  rejected('audit TRUNCATE', `TRUNCATE ${audit};`);
  console.log('PASS create/CAS, concurrent writers, reset, stale replay, rollback, extensible redacted audit and append-only history');
}
async function main() {
  try {
    docker(['run', '--detach', '--name', container, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=arch043-fixture', '--env', `POSTGRES_DB=${db}`, 'pgvector/pgvector:pg17']);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', db]); ready = true; break; }
      catch { await delay(1000); }
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready');
    console.log(`ISOLATION ${mode} postgres=pgvector/pg17 network=none container=${container}`);
    const names = readdirSync(migrations).filter(name => /^\d{14}_/.test(name)).sort();
    assert.equal(names.at(-1), forwardMigrationId);
    let before = null;
    for (const name of names) {
      if (name === target) {
        if (mode === 'upgrade') {
          psql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt")
            VALUES ('arch043-existing-shop','existing.arch043.invalid',now());`);
          psql(`INSERT INTO "public"."BackgroundRuntimeConfig" ("id","version","updatedAt")
            VALUES ('arch043-preserved-config',7,now());`);
        }
        before = JSON.parse(scalar(`SELECT jsonb_build_object(
          'tables', (SELECT count(*) FROM information_schema.tables WHERE table_type='BASE TABLE'),
          'shops', (SELECT count(*) FROM "commerce"."Shop"),
          'background', (SELECT count(*) FROM "public"."BackgroundRuntimeConfig"),
          'billing', (SELECT count(*) FROM "billing"."PlatformBillingPolicy"));`));
      }
      apply(name);
    }
    const after = JSON.parse(scalar(`SELECT jsonb_build_object(
      'tables', (SELECT count(*) FROM information_schema.tables WHERE table_type='BASE TABLE'),
      'shops', (SELECT count(*) FROM "commerce"."Shop"),
      'background', (SELECT count(*) FROM "public"."BackgroundRuntimeConfig"),
      'billing', (SELECT count(*) FROM "billing"."PlatformBillingPolicy"));`));
    assert.equal(after.tables, before.tables + 2, 'exactly two additive tables');
    for (const key of ['shops','background','billing']) assert.equal(after[key], before[key], `${key} must be preserved`);
    assert.equal(scalar(`SELECT count(*) FROM ${config};`), '0', 'no operational values may be seeded');
    assert.equal(scalar(`SELECT count(*) FROM ${audit};`), '0', 'no audit entries may be seeded');
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint
      WHERE conrelid='"public"."PlatformConfigurationAudit"'::regclass
        AND conname='PlatformConfigurationAudit_secret_redacted';`), '0',
      'the forward migration must remove only the secret audit shape constraint');
    for (const constraint of ['PlatformConfigurationAudit_revision_step',
      'PlatformConfigurationAudit_after_object', 'PlatformConfigurationAudit_before_object']) {
      assert.equal(scalar(`SELECT count(*) FROM pg_constraint
        WHERE conrelid='"public"."PlatformConfigurationAudit"'::regclass
          AND conname=${quote(constraint)};`), '1', `${constraint} must remain enforced`);
    }
    if (mode === 'upgrade') {
      assert.equal(scalar(`SELECT "version" FROM "public"."BackgroundRuntimeConfig"
        WHERE "id"='arch043-preserved-config';`), '7');
      assert.equal(scalar(`SELECT count(*) FROM "commerce"."Shop" WHERE "id"='arch043-existing-shop';`), '1');
    }
    assert.equal(scalar(`SELECT count(*) FROM pg_trigger WHERE tgrelid='"public"."PlatformConfigurationAudit"'::regclass
      AND NOT tgisinternal;`), '2', 'append-only audit requires update/delete + truncate triggers');
    assertGuards();
    await assertTransactions();
    console.log(`PASS ARCH-043-DATABASE-001 PostgreSQL ${mode}`);
  } finally {
    if (started) { docker(['rm', '--force', '--volumes', container]); console.log(`CLEANUP ${container}`); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
