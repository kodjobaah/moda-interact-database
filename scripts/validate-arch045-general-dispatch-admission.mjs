import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Ensure the forward migration only removes the recovery-only admission
// predicate; every other ARCH-040 trigger guard remains byte-for-byte intact.
const original = readFileSync(new URL(
  '../prisma/migrations/20261017120000_arch040_recovery_human_handover/migration.sql',
  import.meta.url,
), 'utf8');
const forward = readFileSync(new URL(
  '../prisma/migrations/20261022215000_arch045_general_conversation_dispatch_admission/migration.sql',
  import.meta.url,
), 'utf8');
const functionName = '"whatsapp".arch040_message_dispatch_guard()';
const originalStart = original.indexOf(`CREATE FUNCTION ${functionName}`);
const originalEnd = original.indexOf('CREATE TRIGGER arch040_message_dispatch_guard', originalStart);
assert.ok(originalStart >= 0 && originalEnd > originalStart, 'original ARCH-040 function not found');
const oldBody = original.slice(originalStart, originalEnd).trim();
assert.equal(oldBody.split('AND c."checkoutRecoveryId" IS NOT NULL').length, 2);
const expected = oldBody
  .replace(`CREATE FUNCTION ${functionName}`, `CREATE OR REPLACE FUNCTION ${functionName}`)
  .replace('AND c."checkoutRecoveryId" IS NOT NULL ', '');
const forwardStart = forward.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}`);
assert.ok(forwardStart > 0, 'migration must be forward-only CREATE OR REPLACE FUNCTION');
assert.equal(forward.slice(forwardStart).trim(), expected,
  'forward migration must not change ARCH-040 validation except the recovery link predicate');
assert.doesNotMatch(forward, /(?:DROP|ALTER)\s+(?:FUNCTION|TRIGGER|TABLE)/i,
  'do not drop/recreate the trigger, function or table');
assert.match(forward, /providerDispatchControlRevision/);
assert.match(forward, /ARCH040 admitted message identity cannot change/);
assert.match(forward, /ARCH040 admitted message content and sender immutable/);
assert.match(forward, /c\."controlRevision"=NEW\."providerDispatchControlRevision"/);
assert.match(forward, /c\."controlMode"=/);
console.log('PASS ARCH-045 forward migration: exact predicate removal; existing guards preserved');
