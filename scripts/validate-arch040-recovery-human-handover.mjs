import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../prisma/migrations/20261017120000_arch040_recovery_human_handover/migration.sql', import.meta.url), 'utf8');
const policyMigration = readFileSync(new URL('../prisma/migrations/20261017214500_arch040_remove_outreach_sequence_policy/migration.sql', import.meta.url), 'utf8');
for (const oldConstraint of ['ck_arch016_outreach_trigger_sequence', 'RecoveryOutreachAttempt_sequence_trigger_check']) {
  assert.ok(policyMigration.includes(`DROP CONSTRAINT IF EXISTS "${oldConstraint}"`), `Outreach business policy constraint still active: ${oldConstraint}`);
}
assert.match(policyMigration, /CREATE OR REPLACE FUNCTION "whatsapp"\.arch040_command_guard/);
assert.doesNotMatch(policyMigration, /a\."sequence"\s*=\s*2/, 'Merchant send guard must not hardcode sequence 2');
assert.match(policyMigration, /a\."checkoutRecoveryId"\s*=\s*recovery_id/, 'Recovery link must remain checked');
assert.match(policyMigration, /a\."outboundMessageId"/, 'Message identity must remain checked');
for (const model of [
  'ConversationControlEvent', 'MerchantConversationSendCommand',
  'ShopHumanMessagingRestriction', 'ShopHumanMessagingRestrictionEvent',
]) {
  assert.match(schema, new RegExp(`model ${model} \\{`), `Missing model ${model}`);
  assert.match(sql, new RegExp(`CREATE TABLE "(?:commerce|whatsapp)"\\."${model}"`), `Missing migration for ${model}`);
}
for (const name of [
  'ConversationControlMode', 'RecoveryOutreachInitiator', 'MerchantConversationSendKind',
  'MerchantConversationSendState', 'HumanMessagingRestrictionStatus',
]) {
  assert.match(schema, new RegExp(`enum ${name} \\{`));
  assert.match(sql, new RegExp(`CREATE TYPE "(?:commerce|whatsapp)"\\."${name}"`));
}
for (const fragment of [
  'controlRevision', 'controlChangedAt', 'providerDispatchControlRevision',
  'POST_WINDOW_FOLLOW_UP', 'initiatedBy', 'initiationKey', 'claimedAt',
  'recoveryOutreachAttemptId', 'expectedControlRevision', 'leaseToken',
  'providerDispatchRestrictionRevision', 'platformAdminId',
]) {
  assert.ok(schema.includes(fragment), `Missing required schema field ${fragment}`);
  assert.ok(sql.includes(fragment), `Missing migration representation ${fragment}`);
}
for (const guard of [
  'arch040_conversation_guard', 'arch040_conversation_transition',
  'arch040_conversation_event_consistency', 'arch040_event_immutable',
  'arch040_attempt_guard', 'arch040_command_guard',
  'arch040_message_dispatch_guard', 'arch040_restriction_guard',
  'arch040_restriction_transition', 'arch040_restriction_event_check',
]) assert.ok(sql.includes(guard), `Missing SQL guard ${guard}`);
assert.match(schema, /@@unique\(\[checkoutRecoveryId\]\)/);
assert.match(schema, /@@unique\(\[checkoutRecoveryId, sequence\]\)/);
assert.match(schema, /@@unique\(\[shopId, idempotencyKey\]\)/);
assert.match(sql, /"payloadSha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.doesNotMatch(schema, /humanActorPlatform|humanActorSubject|humanTakenOverAt/);
console.log('PASS ARCH-040 schema/migration structural contracts');
