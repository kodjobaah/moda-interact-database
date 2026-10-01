import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const targetMigration = '20261001120000_arch023_merchant_knowledge_entitlement_reconciliation_lease';
const databaseName = `arch023_entitlement_lease_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const containerName = `moda-arch023-db006-${randomUUID()}`;
let containerStarted = false;

function docker(args, options = {}) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
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

function jsonQuery(sql) {
  return JSON.parse(psql(sql, { capture: true }).trim());
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
    for (let attempt = 1; attempt <= 90; attempt += 1) {
      try {
        psql('SELECT 1;');
        break;
      } catch (error) {
        if (attempt === 90) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(`ISOLATION container=${containerName} image=pgvector/pgvector:pg17 network=none database=${databaseName}`);

    const migrations = readdirSync(migrationsDirectory)
      .filter(name => /^\d{14}_.+$/.test(name) && name <= targetMigration)
      .sort();
    assert.equal(migrations.at(-1), targetMigration, 'The target migration must be the final migration in the proof');
    for (const name of migrations) {
      const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
      psql(sql);
      console.log(`APPLIED ${name}`);
    }

    psql(`INSERT INTO public."BackgroundRuntimeLease"
      ("name", "ownerToken", "generation", "acquiredAt", "heartbeatAt", "leaseUntil", "updatedAt")
    VALUES
      ('MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION', 'arch023-database-006-test', 1, NOW(), NOW(), NOW(), NOW()),
      ('MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP', 'arch023-database-006-test', 1, NOW(), NOW(), NOW(), NOW()),
      ('MERCHANT_KNOWLEDGE_ENTITLEMENT_RECONCILIATION', 'arch023-database-006-test', 1, NOW(), NOW(), NOW(), NOW());`);
    const accepted = jsonQuery(`SELECT json_agg("name"::text ORDER BY "name"::text)::text
      FROM public."BackgroundRuntimeLease"
      WHERE "name" IN (
        'MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION'::"public"."BackgroundRuntimeLeaseName",
        'MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP'::"public"."BackgroundRuntimeLeaseName",
        'MERCHANT_KNOWLEDGE_ENTITLEMENT_RECONCILIATION'::"public"."BackgroundRuntimeLeaseName"
      );`);
    assert.deepEqual(accepted, [
      'MERCHANT_KNOWLEDGE_ENTITLEMENT_RECONCILIATION',
      'MERCHANT_KNOWLEDGE_PENDING_RECONCILIATION',
      'MERCHANT_KNOWLEDGE_UPLOAD_CLEANUP',
    ]);
    psql(`DELETE FROM public."BackgroundRuntimeLease"
      WHERE "ownerToken" = 'arch023-database-006-test';`);
    console.log('ARCH-023 Merchant Knowledge entitlement-reconciliation lease PostgreSQL proof passed.');
  } finally {
    if (containerStarted) {
      docker(['rm', '--force', '--volumes', containerName]);
      console.log(`CLEANUP removed invocation-owned container ${containerName}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});