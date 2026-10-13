import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Apply the REAL ordered SQL migrations to an invocation-owned, network-isolated
// PostgreSQL database. No test doubles or inspection-only checks are used here.
const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const target = '20261013080000_arch036_woo_coupon_dispatch_runtime_lease';
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');

const containerName = `moda-arch036-database003-${randomUUID()}`;
const databaseName = 'arch036_woo_dispatch_fixture';
const existingName = 'RECOVERY_CAPACITY_REPAIR';
const newName = 'WOO_COUPON_SYNC_DISPATCH';
const expectedLegacyLabels = [
  'BILLING_RECONCILIATION',
  'RECOVERY_CAPACITY_REPAIR',
  'TRANSLATION_RECONCILIATION',
  'QUEUE_CONCURRENCY_RECONCILIATION',
  'CHECKOUT_RECOVERY_EXPIRY',
  'MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION',
  'MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP',
  'MERCHANT_KNOWLEDGE_ENTITLEMENT_RECONCILIATION',
];
let containerStarted = false;

function docker(args, options = {}) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Docker command failed${detail ? `: ${detail}` : ''}`, { cause: error });
  }
}

function psql(sql, { capture = false } = {}) {
  return docker([
    'exec', '-i', containerName, 'psql', '-X', '-q',
    ...(capture ? ['-A', '-t'] : []),
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', databaseName,
  ], { input: sql });
}

function queryJson(sql) {
  return JSON.parse(psql(sql, { capture: true }).trim());
}

function enumLabels() {
  return queryJson(`SELECT COALESCE(json_agg(e.enumlabel ORDER BY e.enumsortorder), '[]'::json)::text
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'BackgroundRuntimeLeaseName';`);
}

function migrationNames() {
  const names = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_.+$/.test(name))
    .sort();
  assert.equal(names.at(-1), target, 'The target must be the newest migration in this fixture');
  return names;
}

function applyMigration(name) {
  const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
  // One psql call per migration: PostgreSQL enum additions must commit before
  // the new label can be used by subsequent statements.
  psql(sql);
  console.log(`APPLIED ${name}`);
}

function readLease(name) {
  return queryJson(`SELECT COALESCE((SELECT row_to_json(x) FROM (
    SELECT "name"::text AS name, "ownerToken" AS "ownerToken", "generation",
      "acquiredAt"::text AS "acquiredAt", "heartbeatAt"::text AS "heartbeatAt",
      "leaseUntil"::text AS "leaseUntil", "lastFinishedAt"::text AS "lastFinishedAt"
    FROM public."BackgroundRuntimeLease"
    WHERE "name" = '${name}'::public."BackgroundRuntimeLeaseName"
  ) x), 'null'::json)::text;`);
}

function seedExistingLease() {
  psql(`INSERT INTO public."BackgroundRuntimeLease"
    ("name", "ownerToken", "generation", "acquiredAt", "heartbeatAt", "leaseUntil", "lastFinishedAt", "updatedAt")
    VALUES ('${existingName}', 'arch036-preexisting-owner', 4,
      '2026-10-12 10:00:00', '2026-10-12 10:01:00',
      '2026-10-12 10:02:00', '2026-10-12 10:03:00', '2026-10-12 10:03:00');`);
  return readLease(existingName);
}

function verifyNewLeaseCanBeAcquired() {
  psql(`INSERT INTO public."BackgroundRuntimeLease"
    ("name", "ownerToken", "generation", "acquiredAt", "heartbeatAt", "leaseUntil", "updatedAt")
    VALUES ('${newName}', 'arch036-dispatcher-a', 1, now(), now(), now() + interval '2 minutes', now());`);
  assert.equal(readLease(newName).ownerToken, 'arch036-dispatcher-a');
  psql(`UPDATE public."BackgroundRuntimeLease"
    SET "ownerToken" = 'arch036-dispatcher-b', "generation" = 2,
      "heartbeatAt" = now(), "leaseUntil" = now() + interval '2 minutes', "updatedAt" = now()
    WHERE "name" = '${newName}' AND "ownerToken" = 'arch036-dispatcher-a' AND "generation" = 1;`);
  assert.equal(readLease(newName).ownerToken, 'arch036-dispatcher-b');
  assert.equal(readLease(newName).generation, 2);
  psql(`DELETE FROM public."BackgroundRuntimeLease" WHERE "name" = '${newName}';`);
  assert.equal(readLease(newName), null, 'New lease row can be released/deleted');
  console.log('PASS new lease label accepts insert, ownership transition and removal');
}

async function main() {
  try {
    docker([
      'run', '--detach', '--name', containerName, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=fixture-only',
      '--env', `POSTGRES_DB=${databaseName}`,
      'pgvector/pgvector:pg17',
    ]);
    containerStarted = true;
    let ready = false;
    for (let attempt = 1; attempt <= 90; attempt += 1) {
      try {
        psql('SELECT 1;');
        ready = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    assert.ok(ready, 'Fixture PostgreSQL must become ready');
    console.log(`ISOLATION mode=${mode} container=${containerName} network=none database=${databaseName}`);

    const migrations = migrationNames();
    let previousLease = null;
    for (const name of migrations) {
      if (mode === 'upgrade' && name === target) {
        assert.deepEqual(enumLabels(), expectedLegacyLabels,
          'Pre-upgrade schema must contain exactly the eight existing enum labels');
        previousLease = seedExistingLease();
        console.log('SEEDED legacy lease before applying the ARCH-036 migration');
      }
      applyMigration(name);
    }

    assert.deepEqual(enumLabels(), [...expectedLegacyLabels, newName],
      'Applying the real migration must preserve existing labels and append the new one');
    if (mode === 'upgrade') {
      assert.deepEqual(readLease(existingName), previousLease,
        'Existing lease ownership, generation and timestamps must survive the upgrade unchanged');
      console.log('PASS pre-existing lease row preserved byte-for-byte at query level');
    } else {
      const preserved = seedExistingLease();
      assert.deepEqual(readLease(existingName), preserved,
        'Existing enum labels must remain usable on fresh install');
    }

    assert.equal(readLease(newName), null, 'Migration must not seed a runtime lease row');
    verifyNewLeaseCanBeAcquired();
    // Reapplying the migration must be harmless: the migration explicitly uses IF NOT EXISTS.
    applyMigration(target);
    assert.deepEqual(enumLabels(), [...expectedLegacyLabels, newName],
      'Reapplying the migration must not change the enum');
    console.log(`PASS ARCH-036 lease migration PostgreSQL ${mode} scenario`);
  } finally {
    if (containerStarted) {
      docker(['rm', '--force', '--volumes', containerName]);
      console.log(`CLEANUP removed ${containerName}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
