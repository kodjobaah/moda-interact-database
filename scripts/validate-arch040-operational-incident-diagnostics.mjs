import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../prisma/migrations/20261020110000_arch040_operational_incident_error_diagnostics/migration.sql',
  import.meta.url,
), 'utf8');

function modelBody(name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Missing Prisma model ${name}`);
  return match[1];
}

for (const [model, table, field, checkName] of [
  ['OperationalIncident', 'OperationalIncident', 'lastErrorMessage',
    'OperationalIncident_lastErrorMessage_length_check'],
  ['OperationalIncidentEvent', 'OperationalIncidentEvent', 'errorMessage',
    'OperationalIncidentEvent_errorMessage_length_check'],
]) {
  assert.match(modelBody(model), new RegExp(`\\b${field}\\s+String\\?\\s+@db\\.VarChar\\(512\\)`),
    `${model}.${field} must be an optional 512-character string`);
  assert.ok(migration.includes(`ALTER TABLE "support"."${table}"`),
    `Missing forward migration for ${table}`);
  assert.ok(migration.includes(`ADD COLUMN "${field}" VARCHAR(512)`),
    `Missing bounded ${table}.${field} column`);
  assert.ok(migration.includes(`ADD CONSTRAINT "${checkName}"`),
    `Missing ${table}.${field} database check`);
  assert.match(migration,
    new RegExp(`char_length\\("${field}"\\) BETWEEN 1 AND 512`),
    `${table}.${field} must reject empty messages`);
}

assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)\b/i,
  'Diagnostic migration must be additive and preserve existing incident rows and events');
console.log('PASS ARCH-040 operational incident diagnostic Prisma and migration contracts');
