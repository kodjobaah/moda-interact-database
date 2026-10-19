import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../prisma/migrations/20261019133000_arch040_follow_up_reservation_release/migration.sql', import.meta.url), 'utf8');
const original = readFileSync(new URL('../prisma/migrations/20261017120000_arch040_recovery_human_handover/migration.sql', import.meta.url), 'utf8');
const attempt = schema.match(/model RecoveryOutreachAttempt \{([\s\S]*?)\n\}/)?.[1] ?? '';
const command = schema.match(/model MerchantConversationSendCommand \{([\s\S]*?)\n\}/)?.[1] ?? '';

assert.match(attempt, /@@unique\(\[checkoutRecoveryId, sequence\]\)/);
assert.match(attempt, /initiationKey\s+String\?\s+@unique/);
assert.match(attempt, /merchantSendCommands\s+MerchantConversationSendCommand\[\]/);
assert.doesNotMatch(attempt, /merchantSendCommand\s+MerchantConversationSendCommand\?/);
assert.match(command, /recoveryOutreachAttemptId\s+String\?\s*\n/);
assert.doesNotMatch(command, /recoveryOutreachAttemptId\s+String\?\s+@unique/);
assert.match(command, /recoveryOutreachAttempt\s+RecoveryOutreachAttempt\?\s+@relation\(fields: \[recoveryOutreachAttemptId\], references: \[id\], onDelete: Restrict\)/);
assert.match(command, /@@index\(\[recoveryOutreachAttemptId\], map: "MerchantSend_outreach_attempt_idx"\)/);
assert.match(command, /@@unique\(\[shopId, idempotencyKey\]\)/);
assert.match(command, /providerDispatchKey\s+String\?\s+@unique/);
assert.match(original, /"MerchantConversationSendCommand_recoveryOutreachAttemptId_fkey" FOREIGN KEY[^\n]*ON DELETE RESTRICT/);
assert.match(migration, /DROP INDEX "whatsapp"\."MerchantConversationSendCommand_recoveryOutreachAttemptId_key";/);
assert.match(migration, /CREATE INDEX "MerchantSend_outreach_attempt_idx"\s+ON "whatsapp"\."MerchantConversationSendCommand"\("recoveryOutreachAttemptId"\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION "commerce"\.arch040_attempt_guard\(\)/);

const currentGuard = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "commerce".arch040_attempt_guard()'));
for (const invariant of [
  'NEW."initiationKey" IS NULL', 'NEW."initiatedBy" IS NULL', 'NEW."claimedAt" IS NULL',
  'OLD."status" = \'PENDING\'', 'NEW."status" = \'PENDING\'',
  'OLD."outboundMessageId" IS NULL', 'NEW."outboundMessageId" IS NULL',
  'OLD."sentAt" IS NULL', 'NEW."sentAt" IS NULL',
  'NEW."trigger"', 'NEW."recipient"', 'NEW."configuredOfferMode"',
  'NEW."fixedShopifyDiscountId"', 'NEW."offerSnapshot"',
  'NEW."followUpDueAt"', 'NEW."failureCode"',
  'cmd."providerDispatchKey" IS NOT NULL', 'cmd."outboundMessageId" IS NOT NULL',
  "cmd.\"state\" IN ('DISPATCH_ADMITTED','UNKNOWN','SENT')",
  'ARCH040 outreach claim is immutable',
  'ARCH040 outbound outreach identity is set-once',
  'ARCH040 cannot claim previously dispatched outreach',
  'ARCH040 attempt message belongs to different recovery',
  'ARCH040 follow-up attempt/command message mismatch',
]) assert.ok(currentGuard.includes(invariant), `Missing irreversibility check: ${invariant}`);

// Ensure the original guard's other sections were not rewritten or deleted.
const originalGuard = original.split('CREATE FUNCTION "commerce".arch040_attempt_guard()')[1].split('CREATE TRIGGER arch040_attempt_guard')[0];
const immutableMessageSection = originalGuard.split('    IF OLD."outboundMessageId" IS NOT NULL')[1];
assert.ok(currentGuard.includes(`    IF OLD."outboundMessageId" IS NOT NULL${immutableMessageSection.split('END $$;')[0]}`),
  'Original post-claim message/ownership guard must be retained verbatim');
assert.doesNotMatch(migration, /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+"whatsapp"\.arch040_command_guard/i);
assert.doesNotMatch(migration, /CREATE\s+TABLE|CREATE\s+UNIQUE\s+INDEX|DROP\s+CONSTRAINT|INSERT\s+INTO/i);
console.log('PASS ARCH-040-DATABASE-006 schema, historical FK, migration and structural guard contracts');
