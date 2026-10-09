import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migrationPath = new URL('../prisma/migrations/', import.meta.url);
const migrationName = '20261009103000_arch028_recovery_outreach_attempt_recipient';
const migration = read(`prisma/migrations/${migrationName}/migration.sql`);
const migrations = readdirSync(migrationPath).filter(name => /^\d{14}_.+$/.test(name)).sort();
const attempt = schema.match(/model RecoveryOutreachAttempt \{([\s\S]*?)\n\}/)?.[1] ?? '';
const migrationBody = migration.replace(/--[^\n]*/g, '');

assert.deepEqual(
  migrations.filter(name => /arch028_recovery_outreach_attempt_recipient/.test(name)),
  [migrationName],
  'exactly one recipient migration must exist',
);
assert.ok(migrations.includes('20261008140724_arch028_whatsapp_failure_reachability_compensation'));
assert.ok(migrationName > '20261008140724_arch028_whatsapp_failure_reachability_compensation');
assert.match(attempt, /^\s*recipient\s+String\s+@db\.VarChar\(64\)\s*$/m);
assert.doesNotMatch(attempt, /^\s*recipient\s+String\?/m);
assert.doesNotMatch(attempt, /^\s*recipient\s+.*@default\(/m);
assert.match(migrationBody, /ALTER TABLE "commerce"\."RecoveryOutreachAttempt"/);
assert.match(migrationBody, /ADD COLUMN "recipient" VARCHAR\(64\) NOT NULL/);
assert.match(migrationBody, /CONSTRAINT "RecoveryOutreachAttempt_recipient_check"/);
assert.match(migrationBody, /CHECK \(\("recipient" COLLATE "C"\) ~ '\^\[0-9\]\{1,64\}\$'\)/);
assert.doesNotMatch(migrationBody, /\b(?:UPDATE|INSERT\s+INTO)\b/i, 'migration must not backfill recipient values');
assert.doesNotMatch(migrationBody, /\bDEFAULT\b/i, 'recipient must not receive a default');
for (const name of ['Conversation', 'ConversationMessage']) {
  const block = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  assert.doesNotMatch(block, /^\s*recipient\s/m, `${name} must not gain a recipient field`);
}

console.log('ARCH-028 recovery outreach recipient schema and migration checks passed.');