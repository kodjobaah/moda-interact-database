import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const lastAcceptedMigration = '20260929160000_arch023_merchant_knowledge_schema';
const targetMigration = '20260930200000_arch023_release_feature_snapshot_history';
const databaseName = 'arch023_snapshot_history_fixture';
const containerName = `moda-arch023-db004-${randomUUID()}`;
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

function expectSqlState(label, statement, sqlState = '23514') {
  psql(`DO $assertion$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement}
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state <> '${sqlState}' THEN RAISE; END IF;
  END;
  IF caught_state IS NULL THEN
    RAISE EXCEPTION 'Expected SQLSTATE ${sqlState}: ${label}';
  END IF;
END
$assertion$;`);
  console.log(`PASS ${label} (SQLSTATE ${sqlState})`);
}

function releaseInsert(id) {
  return `INSERT INTO commerce."CommerceRelease"
    ("id", "runnerCompatibility", "contractVersion", "responseContract", "responseContractHash", "createdByAdminId", "createdAt")
    VALUES ('${id}', '^1.0.0', 'commerce.v1', '{"version":"response.v1","instructions":"Fixture response","detailsSchema":{}}'::jsonb,
      '${'a'.repeat(64)}', 'admin-snapshot-history', '2026-09-30T00:00:00Z');`;
}

function featureSnapshotInsert(releaseId, featureId, prompt) {
  const escaped = prompt.replaceAll("'", "''");
  return `INSERT INTO commerce."CommerceReleaseFeature" ("releaseId", "featureId", "behaviourPrompt", "createdAt")
    VALUES ('${releaseId}', '${featureId}', '${escaped}', '2026-09-30T00:00:00Z');`;
}

function capturePreservedRows() {
  return jsonQuery(`SELECT jsonb_build_object(
    'releaseFeatures', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."releaseId", row_data."featureId") FROM commerce."CommerceReleaseFeature" AS row_data), '[]'::jsonb),
    'releases', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id) FROM commerce."CommerceRelease" AS row_data), '[]'::jsonb),
    'releaseCapabilities', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."releaseId", row_data."capabilityId") FROM commerce."CommerceReleaseCapability" AS row_data), '[]'::jsonb),
    'featureConfigurations', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."featureId") FROM commerce."CommerceFeatureConfiguration" AS row_data), '[]'::jsonb),
    'merchantKnowledgePurposes', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id) FROM commerce."MerchantKnowledgePurpose" AS row_data), '[]'::jsonb),
    'merchantKnowledgeFormats', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id) FROM commerce."MerchantKnowledgeDataFormat" AS row_data), '[]'::jsonb),
    'merchantKnowledgePurposeFormats', COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data."purposeId", row_data."dataFormatId") FROM commerce."MerchantKnowledgePurposeDataFormat" AS row_data), '[]'::jsonb)
  )::text;`);
}

function releaseFeatureTriggers() {
  return jsonQuery(`SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', trigger_row.tgname,
    'enabled', trigger_row.tgenabled::text,
    'definition', pg_get_triggerdef(trigger_row.oid),
    'functionSource', procedure.prosrc
  ) ORDER BY trigger_row.tgname), '[]'::jsonb)::text
  FROM pg_trigger AS trigger_row
  JOIN pg_class AS relation ON relation.oid=trigger_row.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  JOIN pg_proc AS procedure ON procedure.oid=trigger_row.tgfoid
  WHERE namespace.nspname='commerce'
    AND relation.relname='CommerceReleaseFeature'
    AND trigger_row.tgname IN ('arch021_release_feature_guard', 'arch021_release_feature_immutable')
    AND NOT trigger_row.tgisinternal;`);
}

async function awaitPostgres() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      execFileSync('docker', [
        'exec', containerName, 'psql', '-X', '-q', '-U', 'postgres', '-d', databaseName, '-c', 'SELECT 1',
      ], { stdio: 'ignore' });
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error('Invocation-owned PostgreSQL container did not become ready');
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
    await awaitPostgres();
    console.log(`ISOLATION container=${containerName} image=pgvector/pgvector:pg17 network=none database=${databaseName}`);

    const migrationNames = readdirSync(migrationsDirectory)
      .filter(name => /^\d{14}_.+$/.test(name) && name <= lastAcceptedMigration)
      .sort();
    assert.equal(migrationNames.at(-1), lastAcceptedMigration, 'Accepted migration-chain endpoint is missing');
    assert.ok(!migrationNames.includes(targetMigration), 'Target migration must be applied only after predecessor proof');
    for (const name of migrationNames) {
      const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
      psql(sql);
      console.log(`APPLIED ${name}`);
    }

    psql(`BEGIN;
INSERT INTO public."PlatformAdmin" ("id", "email", "role", "updatedAt")
  VALUES ('admin-snapshot-history', 'snapshot-history@example.invalid', 'SUPER_ADMIN', '2026-09-30T00:00:00Z');
INSERT INTO billing."Feature" ("id", "key", "displayName", "activationMode", "updatedAt")
  VALUES ('feature-snapshot-history-f', 'snapshot_history_f', 'Snapshot history F', 'MERCHANT_OPT_IN', '2026-09-30T00:00:00Z');
INSERT INTO commerce."CommerceFeatureConfiguration" ("featureId", "behaviourPrompt", "editVersion", "createdAt", "updatedAt")
  VALUES ('feature-snapshot-history-f', 'v1', 0, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z');
INSERT INTO commerce."CommerceTool" ("id", "name", "displayName", "updatedAt")
  VALUES ('tool-snapshot-history', 'snapshot_history_tool', 'Snapshot history fixture tool', '2026-09-30T00:00:00Z');
INSERT INTO commerce."CommerceToolRevision" (
  "id", "toolId", "revisionNumber", "status", "contractVersion", "contentHash",
  "createdByAdminId", "publishedByAdminId", "publishedAt", "definitionVersion", "definition", "createdAt"
) VALUES (
  'tool-revision-snapshot-history', 'tool-snapshot-history', 1, 'PUBLISHED', 'commerce.v1', '${'b'.repeat(64)}',
  'admin-snapshot-history', 'admin-snapshot-history', '2026-09-30T00:00:00Z', '1.0.0',
  '{"name":"snapshot_history_tool","definitionVersion":"1.0.0","description":"Snapshot fixture","inputSchema":{},"execution":{},"responseTemplate":{}}'::jsonb,
  '2026-09-30T00:00:00Z'
);
INSERT INTO commerce."CommerceCapability" (
  "id", "key", "displayName", "featureId", "toolId", "enabled", "createdAt", "updatedAt"
) VALUES (
  'capability-snapshot-history', 'snapshot_history_capability', 'Snapshot history capability',
  'feature-snapshot-history-f', 'tool-snapshot-history', true, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z'
);
${releaseInsert('release-snapshot-history-base')}
${featureSnapshotInsert('release-snapshot-history-base', 'feature-snapshot-history-f', 'v1')}
INSERT INTO commerce."CommerceReleaseCapability" ("releaseId", "capabilityId", "featureId", "toolId", "toolRevisionId", "position")
  VALUES ('release-snapshot-history-base', 'capability-snapshot-history', 'feature-snapshot-history-f', 'tool-snapshot-history', 'tool-revision-snapshot-history', 0);
COMMIT;`);
    console.log('PASS Feature F current v1, immutable release snapshot, release, and release capability seeded');

    psql(`UPDATE commerce."CommerceFeatureConfiguration"
SET "behaviourPrompt"='v2', "editVersion"=1, "updatedAt"='2026-09-30T00:01:00Z'
WHERE "featureId"='feature-snapshot-history-f';`);
    assert.deepEqual(jsonQuery(`SELECT to_jsonb(configuration)::text FROM commerce."CommerceFeatureConfiguration" AS configuration WHERE "featureId"='feature-snapshot-history-f';`), {
      featureId: 'feature-snapshot-history-f',
      behaviourPrompt: 'v2',
      editVersion: 1,
      createdAt: '2026-09-30T00:00:00+00:00',
      updatedAt: '2026-09-30T00:01:00+00:00',
    });

    psql(releaseInsert('release-snapshot-history-predecessor-rejection'));
    expectSqlState(
      'predecessor rejects a historical v1 snapshot after current behaviour advances to v2',
      featureSnapshotInsert('release-snapshot-history-predecessor-rejection', 'feature-snapshot-history-f', 'v1'),
    );

    const rowsBeforeMigration = capturePreservedRows();
    const triggersBeforeMigration = releaseFeatureTriggers();
    assert.equal(triggersBeforeMigration.filter(row => row.name === 'arch021_release_feature_guard' && row.enabled !== 'D').length, 1,
      'Predecessor must have exactly one active insert guard');
    assert.equal(triggersBeforeMigration.filter(row => row.name === 'arch021_release_feature_immutable').length, 1,
      'Predecessor immutable trigger must be installed exactly once');

    const correction = readFileSync(new URL(`../prisma/migrations/${targetMigration}/migration.sql`, import.meta.url), 'utf8');
    psql(correction);
    assert.deepEqual(capturePreservedRows(), rowsBeforeMigration,
      'The guard replacement must preserve release, release Feature, release capability, current configuration, and ARCH-023 data');
    const triggersAfterMigration = releaseFeatureTriggers();
    assert.equal(triggersAfterMigration.filter(row => row.name === 'arch021_release_feature_guard' && row.enabled !== 'D').length, 1,
      'Final database must have exactly one active release Feature insert guard');
    assert.equal(triggersAfterMigration.filter(row => row.name === 'arch021_release_feature_immutable').length, 1,
      'Final database must retain exactly one immutable trigger');
    assert.deepEqual(
      triggersAfterMigration.find(row => row.name === 'arch021_release_feature_immutable'),
      triggersBeforeMigration.find(row => row.name === 'arch021_release_feature_immutable'),
      'The immutable release Feature trigger must remain unchanged',
    );
    assert.deepEqual(
      triggersAfterMigration.find(row => row.name === 'arch021_release_feature_guard') && {
        name: triggersAfterMigration.find(row => row.name === 'arch021_release_feature_guard').name,
        enabled: triggersAfterMigration.find(row => row.name === 'arch021_release_feature_guard').enabled,
        definition: triggersAfterMigration.find(row => row.name === 'arch021_release_feature_guard').definition,
      },
      triggersBeforeMigration.find(row => row.name === 'arch021_release_feature_guard') && {
        name: triggersBeforeMigration.find(row => row.name === 'arch021_release_feature_guard').name,
        enabled: triggersBeforeMigration.find(row => row.name === 'arch021_release_feature_guard').enabled,
        definition: triggersBeforeMigration.find(row => row.name === 'arch021_release_feature_guard').definition,
      },
      'The existing insert trigger must remain exactly once and attached to the same function name',
    );
    console.log('PASS migration preserves existing rows and trigger topology');

    psql(releaseInsert('release-snapshot-history-successor'));
    psql(featureSnapshotInsert('release-snapshot-history-successor', 'feature-snapshot-history-f', 'v1'));
    console.log('PASS successor release admits exact persisted v1 snapshot for Feature F');

    psql(releaseInsert('release-snapshot-history-current'));
    psql(featureSnapshotInsert('release-snapshot-history-current', 'feature-snapshot-history-f', 'v2'));
    console.log('PASS new release continues to admit current v2 snapshot for Feature F');

    psql(releaseInsert('release-snapshot-history-arbitrary'));
    expectSqlState(
      'Feature F rejects never-persisted arbitrary prompt text',
      featureSnapshotInsert('release-snapshot-history-arbitrary', 'feature-snapshot-history-f', 'v3-never-published'),
    );

    psql(`INSERT INTO billing."Feature" ("id", "key", "displayName", "activationMode", "updatedAt")
VALUES ('feature-snapshot-history-g', 'snapshot_history_g', 'Snapshot history G', 'MERCHANT_OPT_IN', '2026-09-30T00:02:00Z');
INSERT INTO commerce."CommerceFeatureConfiguration" ("featureId", "behaviourPrompt", "editVersion", "createdAt", "updatedAt")
VALUES ('feature-snapshot-history-g', 'g-current', 0, '2026-09-30T00:02:00Z', '2026-09-30T00:02:00Z');
${releaseInsert('release-snapshot-history-other-feature')}`);
    expectSqlState(
      'Feature G rejects prompt text historical only for Feature F',
      featureSnapshotInsert('release-snapshot-history-other-feature', 'feature-snapshot-history-g', 'v1'),
    );

    expectSqlState(
      'existing CommerceReleaseFeature rows remain immutable on UPDATE',
      `UPDATE commerce."CommerceReleaseFeature" SET "behaviourPrompt"='mutated' WHERE "releaseId"='release-snapshot-history-base' AND "featureId"='feature-snapshot-history-f';`,
    );
    expectSqlState(
      'existing CommerceReleaseFeature rows remain immutable on DELETE',
      `DELETE FROM commerce."CommerceReleaseFeature" WHERE "releaseId"='release-snapshot-history-base' AND "featureId"='feature-snapshot-history-f';`,
    );

    const finalTriggers = releaseFeatureTriggers();
    assert.equal(finalTriggers.filter(row => row.name === 'arch021_release_feature_guard' && row.enabled !== 'D').length, 1);
    assert.equal(finalTriggers.filter(row => row.name === 'arch021_release_feature_immutable').length, 1);
    console.log('ARCH-023 release Feature snapshot history PostgreSQL upgrade proof passed.');
  } finally {
    if (containerStarted) {
      docker(['rm', '--force', containerName]);
      console.log(`CLEANUP removed invocation-owned container ${containerName}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});