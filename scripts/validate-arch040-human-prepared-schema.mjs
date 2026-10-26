import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../prisma/schema.prisma');
const migration = read('../prisma/migrations/20261026080000_arch040_prepared_human_message_content/migration.sql');
const priorCommand = read('../prisma/migrations/20261017214500_arch040_remove_outreach_sequence_policy/migration.sql');
const priorModeration = read('../prisma/migrations/20261018092000_arch040_moderation_template_content_digest/migration.sql');
const model = schema.match(/^model MerchantConversationSendCommand \{([\s\S]*?)^\}/m)?.[1];
assert.ok(model, 'Existing merchant command model is required');
for (const [field, type, native] of [
  ['preparedTextBody','String?','@db.Text'],
  ['preparedWrapperEvidence','Json?','@db.JsonB'],
  ['preparedAt','DateTime?','@db.Timestamptz(3)'],
]) {
  const found = [...model.matchAll(new RegExp(`^\\s*${field}\\s+(\\S+)\\s+([^\\n]+)$`, 'gm'))];
  assert.equal(found.length, 1, `${field} must appear exactly once`);
  assert.equal(found[0][1], type, `${field} must be nullable ${type}`);
  assert.equal(found[0][2].trim(), native, `${field} must use ${native} without a default`);
}
for (const invariant of [
  /\btextBody\s+String\?\s+@db\.Text/, /\bpayloadSha256\s+String\s+@db\.VarChar\(64\)/,
  /@@unique\(\[shopId, idempotencyKey\]\)/, /@@schema\("whatsapp"\)/,
  /\bproviderDispatchKey\s+String\?\s+@unique/,
  /\bmoderationAssessments\s+ConversationModerationAssessment\[\]/,
]) assert.match(model, invariant, 'Existing command identity/relations must remain intact');

// Check both the exact DDL and its absence of defaults, NOT just field names.
const ddl = migration.match(/ALTER TABLE "whatsapp"\."MerchantConversationSendCommand"\s+([\s\S]*?);/)?.[1];
assert.ok(ddl, 'Additive ALTER TABLE required');
assert.deepEqual(ddl.split(',').map(x => x.trim()).filter(Boolean), [
  'ADD COLUMN "preparedTextBody" TEXT',
  'ADD COLUMN "preparedWrapperEvidence" JSONB',
  'ADD COLUMN "preparedAt" TIMESTAMPTZ(3)',
]);
assert.doesNotMatch(migration, /\bDEFAULT\b|\b(?:CREATE|DROP)\s+(?:TABLE|TRIGGER|INDEX)\b|\bINSERT\s+INTO\b/i);
const dirs = readdirSync(new URL('../prisma/migrations/', import.meta.url))
  .filter(name => /^\d{14}_/.test(name)).sort();
assert.equal(dirs.at(-1), '20261026080000_arch040_prepared_human_message_content',
  'Prepared-content migration must remain last in the captured chain');

function functionSql(sql, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION "whatsapp"\\.${escapedName}\\(\\) RETURNS trigger LANGUAGE plpgsql AS \\$\\$[\\s\\S]*?END \\$\\$;`));
  assert.ok(match, `Missing complete ${name} function`);
  return match[0];
}
const command = functionSql(migration, 'arch040_command_guard');
const moderation = functionSql(migration, 'arch040_moderation_subject_guard');
assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 2,
  'Only the two existing functions may be replaced');
assert.equal(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION')).trim(),
  `${command}\n\n${moderation}`, 'No other SQL actions may follow the replacements');

// Compare full installed function bodies against the previous migrations after
// reversing exactly the authorised preparation-only edits. This protects all
// unrelated tenant, state, provider-permit, template and message guards.
let commandReverted = command;
const mustReplace = (text, before, after, label) => {
  assert.ok(text.includes(before), `Missing ${label}`);
  assert.equal(text.split(before).length - 1, 1, `Duplicate ${label}`);
  return text.replace(before, after);
};
commandReverted = mustReplace(commandReverted,
  'DECLARE freezing_prepared_body BOOLEAN := FALSE;\n', '', 'freeze flag');
const start = commandReverted.indexOf('    -- A command\'s accepted text is immutable intent.');
const end = commandReverted.indexOf('    IF OLD."outboundMessageId" IS NOT NULL', start);
assert.ok(start > 0 && end > start, 'Complete prepared-content update branch must exist');
const freezeSection = commandReverted.slice(start, end);
for (const invariant of [
  'OLD."preparedTextBody" IS NOT NULL', 'OLD."preparedWrapperEvidence" IS NOT NULL',
  'OLD."preparedAt" IS NOT NULL', 'IS DISTINCT FROM ROW(OLD."preparedTextBody"',
  'NEW."preparedTextBody" IS NULL', "NEW.\"preparedTextBody\" !~ '[^[:space:]]'",
  'NEW."preparedWrapperEvidence" IS NULL', 'NEW."preparedAt" IS NULL',
  'OLD."kind"<>\'HUMAN_TEXT\'', 'OLD."state"<>\'CLAIMED\'',
  'OLD."leaseToken" IS NULL', 'OLD."leaseExpiresAt" IS NULL',
  'OLD."leaseExpiresAt"<=statement_timestamp()', 'OLD."providerDispatchKey" IS NOT NULL',
  "ERRCODE='23514'", 'freezing_prepared_body := TRUE;',
]) assert.ok(freezeSection.includes(invariant), `Missing freeze integrity: ${invariant}`);
commandReverted = commandReverted.slice(0, start) + commandReverted.slice(end);
const leaseException = ` AND NOT (\n         -- Ordinary CLAIMED->CLAIMED writes remain rejected. Exception only\n         -- for first freeze (plus ORM updatedAt), with every other field intact.\n         freezing_prepared_body AND\n         (to_jsonb(NEW) - ARRAY['preparedTextBody','preparedWrapperEvidence','preparedAt','updatedAt'])\n         IS NOT DISTINCT FROM\n         (to_jsonb(OLD) - ARRAY['preparedTextBody','preparedWrapperEvidence','preparedAt','updatedAt'])\n       )`;
commandReverted = mustReplace(commandReverted, leaseException, '', 'narrow active-lease exception');
commandReverted = mustReplace(commandReverted,
  `NEW."outboundMessageId" IS NOT NULL OR NEW."leaseToken" IS NOT NULL OR\n       NEW."preparedTextBody" IS NOT NULL OR NEW."preparedWrapperEvidence" IS NOT NULL OR\n       NEW."preparedAt" IS NOT NULL`,
  `NEW."outboundMessageId" IS NOT NULL OR NEW."leaseToken" IS NOT NULL`, 'raw insert guard');
assert.equal(commandReverted, functionSql(priorCommand, 'arch040_command_guard'),
  'All pre-existing command guard branches must remain exactly unchanged');

let moderationReverted = moderation;
moderationReverted = mustReplace(moderationReverted, 'cmd."preparedTextBody"', 'cmd."textBody"',
  'moderation reads frozen content');
const moderateStart = moderationReverted.indexOf('    -- New HUMAN_TEXT assessments require durable frozen content.');
const moderateEnd = moderationReverted.indexOf('    IF NEW."inputKind"=\'TEXT\' AND', moderateStart);
assert.ok(moderateStart > 0 && moderateEnd > moderateStart, 'Missing prefreeze moderation gate');
const moderateSection = moderationReverted.slice(moderateStart, moderateEnd);
assert.match(moderateSection, /command_kind='HUMAN_TEXT' AND command_text IS NULL/);
assert.match(moderateSection, /ERRCODE='23514'/);
moderationReverted = moderationReverted.slice(0, moderateStart) + moderationReverted.slice(moderateEnd);
assert.equal(moderationReverted, functionSql(priorModeration, 'arch040_moderation_subject_guard'),
  'All tenant, template-input and ConversationMessage moderation guards must remain unchanged');
console.log('PASS ARCH-040-DATABASE-007 exact Prisma columns/DDL, single freeze exception,');
console.log('     full previous trigger preservation, prepared moderation and migration order');
