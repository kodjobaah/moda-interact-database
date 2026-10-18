import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../prisma/migrations/20261018030000_arch040_conversation_moderation_assessments/migration.sql', import.meta.url), 'utf8');
const templateCorrection = readFileSync(new URL('../prisma/migrations/20261018092000_arch040_moderation_template_content_digest/migration.sql', import.meta.url), 'utf8');
for (const kind of ['ConversationModerationSubject', 'ConversationModerationDecision']) {
  assert.match(schema, new RegExp(`enum ${kind} \\{`));
  assert.ok(migration.includes(`"whatsapp"."${kind}"`), `Missing SQL enum ${kind}`);
}
assert.match(schema, /model ConversationModerationAssessment \{/);
assert.match(migration, /CREATE TABLE "whatsapp"\."ConversationModerationAssessment"/);
for (const part of [
  'conversationMessageId', 'merchantSendCommandId', 'contentSha256',
  'reviewedByPlatformAdminId', 'nextAttemptAt', 'leaseExpiresAt',
  'ConversationModeration_due_idx', 'ConversationModeration_shop_incidents_idx',
  'ConversationModeration_message_content_uq', 'ConversationModeration_command_content_uq',
]) assert.ok(schema.includes(part) && migration.includes(part), `Missing assessment contract ${part}`);
for (const part of [
  'ConversationModeration_exactly_one_subject_check', 'ConversationModeration_subject_pair_check',
  'ConversationModeration_digest_check', 'ConversationModeration_input_kind_check',
  'ConversationModeration_state_tuple_check', 'ConversationModeration_review_tuple_check',
  'arch040_moderation_subject_guard', 'arch040_moderation_guard',
  'arch040_moderation_parent_guard', 'arch040_moderation_create_or_reuse', 'arch040_moderation_complete',
  'arch040_moderation_renew_lease', 'arch040_moderation_record_review',
]) assert.ok(migration.includes(part), `Missing SQL invariant ${part}`);
for (const fragment of [
  'arch040_moderation_template_input_v1',
  'templateName', 'languageCode', 'parametersPresent',
  'CREATE OR REPLACE FUNCTION "whatsapp".arch040_moderation_subject_guard',
  'command_template_name,command_template_language,command_template_parameters',
  'ARCH040 moderation HUMAN template digest mismatch',
  'NEW."inputKind"=\'TEXT\' AND message_type=\'TEXT\'',
]) assert.ok(templateCorrection.includes(fragment), `Missing template moderation correction: ${fragment}`);
assert.doesNotMatch(migration, /\b(INSERT INTO|ALTER TABLE)\s+"?(billing|support)"?\./i, 'Moderation must not alter billing/support');
const assessment = schema.split('model ConversationModerationAssessment {')[1]?.split(/\n}\s*\n/)[0] ?? '';
assert.doesNotMatch(assessment, /actorPlatform|moderationTextBody|moderationRawContent/i,
  'No second platform actor or raw moderation body');
console.log('PASS ARCH-040-DATABASE-005 moderation persistence structural contracts');
