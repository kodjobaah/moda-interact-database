import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Real-migration rehearsal. A new, network-isolated PostgreSQL container is
// created for each invocation; no configured/local developer database is used.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex === -1 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh or --mode upgrade');
const target = '20261020110000_arch040_operational_incident_error_diagnostics';
const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-arch040-incident-diagnostics-${randomUUID()}`;
const database = 'arch040_incident_diagnostics_fixture';
const incidentId = 'arch040-incident-existing';
const initialEventId = '00000000-0000-4000-8000-000000000040';
const diagnosticEventId = '00000000-0000-4000-8000-000000000041';
let started = false;

function docker(args, extra = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...extra,
  });
}
function sql(statement, capture = false) {
  return docker([
    'exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    ...(capture ? ['-A', '-t'] : []), '-U', 'postgres', '-d', database,
  ], { input: statement }).trim();
}
function scalar(statement) { return sql(statement, true).split('\n').at(-1).trim(); }
function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function rejected(label, statement, expectedSqlState) {
  const body = statement.trim().replace(/;+$/, '');
  sql(`DO $check$ DECLARE actual text;
  BEGIN
    BEGIN
      ${body};
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
      IF actual <> '${expectedSqlState}' THEN RAISE; END IF;
    END;
    IF actual IS NULL THEN RAISE EXCEPTION 'Unexpectedly accepted: ${label}'; END IF;
  END $check$;`);
  console.log(`PASS rejected ${label} (${expectedSqlState})`);
}
async function ready() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', database], { stdio: 'ignore' });
      return;
    } catch { await delay(500); }
  }
  throw new Error('Disposable PostgreSQL did not become ready');
}
function applyMigration(name) {
  const migration = new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url);
  sql(readFileSync(migration, 'utf8'));
  console.log(`APPLIED ${name}`);
}
function incidentRow() {
  return scalar(`SELECT row_to_json(i)::text FROM (
    SELECT "id", "incidentKey", "sourceService", "environment", "category",
      "reasonCode", "resourceKey", "severity", "status", "occurrenceCount",
      "firstOccurredAt", "lastOccurredAt", "lastCorrelationId", "revision"
    FROM support."OperationalIncident" WHERE "id"=${quote(incidentId)}
  ) i`);
}
function eventRow() {
  return scalar(`SELECT row_to_json(e)::text FROM (
    SELECT "id", "incidentId", "eventType", "correlationId", "occurredAt"
    FROM support."OperationalIncidentEvent" WHERE "id"=${quote(initialEventId)}::uuid
  ) e`);
}
function seedExistingIncident() {
  // Omitting the new columns is deliberate: old producers must remain valid.
  sql(`INSERT INTO support."OperationalIncident"
    ("id", "incidentKey", "sourceService", "environment", "category", "reasonCode",
     "resourceKey", "severity", "firstOccurredAt", "lastOccurredAt", "lastCorrelationId")
    VALUES (${quote(incidentId)}, ${quote('a'.repeat(64))}, 'background', 'test',
      'WHATSAPP_HUMAN_SEND', 'WHATSAPP_SENDER_MISSING', 'messaging.sender', 'HIGH',
      '2026-10-19T08:05:52Z', '2026-10-19T08:05:52Z', 'fixture-corr-1');
    INSERT INTO support."OperationalIncidentEvent"
      ("id", "incidentId", "eventType", "correlationId", "occurredAt")
    VALUES (${quote(initialEventId)}::uuid, ${quote(incidentId)}, 'OCCURRED',
      'fixture-corr-1', '2026-10-19T08:05:52Z');`);
}
function assertMetadata() {
  for (const [table, column, constraint] of [
    ['OperationalIncident', 'lastErrorMessage', 'OperationalIncident_lastErrorMessage_length_check'],
    ['OperationalIncidentEvent', 'errorMessage', 'OperationalIncidentEvent_errorMessage_length_check'],
  ]) {
    assert.equal(scalar(`SELECT "character_maximum_length" FROM information_schema.columns
      WHERE table_schema='support' AND table_name=${quote(table)} AND column_name=${quote(column)}`),
    '512', `${table}.${column} must be VARCHAR(512)`);
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint c
      JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='support' AND t.relname=${quote(table)}
        AND c.conname=${quote(constraint)} AND c.contype='c' AND c.convalidated`),
    '1', `${table}.${column} must have a validated database check constraint`);
  }
}
function verifyDiagnosticBehavior() {
  assertMetadata();
  assert.equal(scalar(`SELECT "lastErrorMessage" IS NULL FROM support."OperationalIncident"
    WHERE "id"=${quote(incidentId)}`), 't', 'pre-existing incident must default to NULL');
  assert.equal(scalar(`SELECT "errorMessage" IS NULL FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(initialEventId)}::uuid`), 't', 'pre-existing event must default to NULL');

  // Zero-length strings are rejected separately from overlong strings;
  // PostgreSQL should allow both NULL and exactly 512 characters.
  rejected('empty incident diagnostic', `UPDATE support."OperationalIncident"
    SET "lastErrorMessage"='' WHERE "id"=${quote(incidentId)}`, '23514');
  rejected('513-character incident diagnostic', `UPDATE support."OperationalIncident"
    SET "lastErrorMessage"=${quote('x'.repeat(513))} WHERE "id"=${quote(incidentId)}`, '22001');
  sql(`UPDATE support."OperationalIncident" SET "lastErrorMessage"=${quote('x'.repeat(512))}
    WHERE "id"=${quote(incidentId)};`);
  assert.equal(scalar(`SELECT char_length("lastErrorMessage") FROM support."OperationalIncident"
    WHERE "id"=${quote(incidentId)}`), '512');

  rejected('empty event diagnostic', `INSERT INTO support."OperationalIncidentEvent"
    ("id","incidentId","eventType","errorMessage") VALUES
    (${quote(diagnosticEventId)}::uuid,${quote(incidentId)},'OCCURRED','')`, '23514');
  rejected('513-character event diagnostic', `INSERT INTO support."OperationalIncidentEvent"
    ("id","incidentId","eventType","errorMessage") VALUES
    (${quote(diagnosticEventId)}::uuid,${quote(incidentId)},'OCCURRED',${quote('y'.repeat(513))})`, '22001');
  const multibyte = '🙂'.repeat(512);
  sql(`INSERT INTO support."OperationalIncidentEvent"
    ("id","incidentId","eventType","correlationId","errorMessage") VALUES
    (${quote(diagnosticEventId)}::uuid,${quote(incidentId)},'OCCURRED',
     'fixture-corr-2',${quote(multibyte)});`);
  assert.equal(scalar(`SELECT char_length("errorMessage") FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(diagnosticEventId)}::uuid`), '512');
  assert.equal(scalar(`SELECT octet_length("errorMessage") FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(diagnosticEventId)}::uuid`), '2048', 'bound counts characters, not UTF-8 bytes');
  assert.equal(scalar(`SELECT count(*) FROM support."OperationalIncidentEvent"
    WHERE "incidentId"=${quote(incidentId)}`), '2', 'historical occurrence must be retained');

  // A new occurrence may refresh the incident summary but cannot rewrite the
  // original event's own diagnostic or correlation ID.
  sql(`UPDATE support."OperationalIncident"
    SET "lastErrorMessage"='latest safe diagnostic', "occurrenceCount"=2,
      "lastCorrelationId"='fixture-corr-2',
      "lastOccurredAt"='2026-10-20T08:05:52Z'
    WHERE "id"=${quote(incidentId)};`);
  assert.equal(scalar(`SELECT "lastErrorMessage" FROM support."OperationalIncident"
    WHERE "id"=${quote(incidentId)}`), 'latest safe diagnostic');
  assert.equal(scalar(`SELECT "errorMessage" IS NULL FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(initialEventId)}::uuid`), 't');
  assert.equal(scalar(`SELECT char_length("errorMessage") FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(diagnosticEventId)}::uuid`), '512');
  rejected('immutable event diagnostic', `UPDATE support."OperationalIncidentEvent"
    SET "errorMessage"='rewritten' WHERE "id"=${quote(diagnosticEventId)}::uuid`, '23514');
  rejected('immutable event delete', `DELETE FROM support."OperationalIncidentEvent"
    WHERE "id"=${quote(diagnosticEventId)}::uuid`, '23514');
  rejected('duplicate occurrence ID', `INSERT INTO support."OperationalIncidentEvent"
    ("id","incidentId","eventType","errorMessage") VALUES
    (${quote(diagnosticEventId)}::uuid,${quote(incidentId)},'OCCURRED','different')`, '23505');
  assert.equal(scalar(`SELECT count(*) FROM support."OperationalIncidentEvent"
    WHERE "incidentId"=${quote(incidentId)}`), '2');

  // Nullable diagnostics remain compatible with existing incident reporters.
  sql(`UPDATE support."OperationalIncident" SET "lastErrorMessage"=NULL
    WHERE "id"=${quote(incidentId)};
    INSERT INTO support."OperationalIncidentEvent"
    ("id","incidentId","eventType","correlationId") VALUES
    ('00000000-0000-4000-8000-000000000042',${quote(incidentId)},'OCCURRED','fixture-corr-3');`);
  assert.equal(scalar(`SELECT count(*) FROM support."OperationalIncidentEvent"
    WHERE "incidentId"=${quote(incidentId)} AND "errorMessage" IS NULL`), '2');
  console.log('PASS bounded diagnostics, old-writer compatibility, occurrence history, immutability and deduplication');
}

async function main() {
  try {
    docker(['run', '--detach', '--name', container, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=fixture-only', '--env', `POSTGRES_DB=${database}`,
      'pgvector/pgvector:pg17']);
    started = true;
    await ready();
    const migrations = readdirSync(migrationsDirectory)
      .filter((name) => /^\d{14}_/.test(name) && name <= target).sort();
    assert.ok(migrations.includes(target), 'Target migration missing from repository');
    let beforeIncident;
    let beforeEvent;
    for (const name of migrations) {
      if (mode === 'upgrade' && name === target) {
        assert.equal(scalar(`SELECT count(*) FROM information_schema.columns
          WHERE table_schema='support' AND
          ((table_name='OperationalIncident' AND column_name='lastErrorMessage')
           OR (table_name='OperationalIncidentEvent' AND column_name='errorMessage'))`),
        '0', 'upgrade fixture must begin without the diagnostic fields');
        seedExistingIncident();
        beforeIncident = incidentRow();
        beforeEvent = eventRow();
        console.log('SEEDED pre-upgrade operational incident and immutable event');
      }
      applyMigration(name);
    }
    if (mode === 'fresh') seedExistingIncident();
    else {
      assert.equal(incidentRow(), beforeIncident, 'upgrade must preserve pre-existing incident data');
      assert.equal(eventRow(), beforeEvent, 'upgrade must preserve pre-existing occurrence data');
    }
    verifyDiagnosticBehavior();
    console.log(`PASS ARCH-040 operational incident diagnostics PostgreSQL ${mode}`);
  } finally {
    if (started) {
      docker(['rm', '--force', '--volumes', container]);
      console.log(`CLEANUP ${container}`);
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
