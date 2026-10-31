import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const source = readFileSync(schemaPath, 'utf8');

function modelBlock(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`^model ${escaped} \\{([\\s\\S]*?)^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `Prisma ${name} must exist exactly once`);
  return matches[0][1];
}

function fieldLine(model, field) {
  const matches = model.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.startsWith(`${field} `));
  assert.equal(matches.length, 1, `${field} must be declared exactly once`);
  return matches[0].replace(/\s+/g, ' ');
}

const shopSettings = modelBlock('ShopSettings');
assert.equal(fieldLine(shopSettings, 'aiResponseDelayMinutes'), 'aiResponseDelayMinutes Int @default(0)');
assert.equal(fieldLine(shopSettings, 'recoveryDelayMinutes'), 'recoveryDelayMinutes Int @default(30)',
  'existing recovery delay remains unchanged');

const conversation = modelBlock('Conversation');
assert.equal(fieldLine(conversation, 'pendingAiNotBeforeAt'), 'pendingAiNotBeforeAt DateTime? @db.Timestamptz(3)');
assert.equal(fieldLine(conversation, 'pendingAiControlRevision'), 'pendingAiControlRevision Int?');
assert.equal(fieldLine(conversation, 'pendingAiDelayMinutes'), 'pendingAiDelayMinutes Int?');
assert.match(conversation, /^\s*@@index\(\[pendingAiNotBeforeAt, id\]\)\s*$/m,
  'due scan uses the pending deadline followed by the stable row id');
assert.match(conversation, /^\s*@@unique\(\[checkoutRecoveryId\]\)\s*$/m,
  'existing one-conversation-per-recovery uniqueness remains');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('PASS ARCH-054 exact ShopSettings and Conversation fields, defaults, due index and existing recovery uniqueness');
}
