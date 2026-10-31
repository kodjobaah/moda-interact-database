import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = new URL('../prisma/migrations/20261031170000_arch054_merchant_ai_response_delay/migration.sql', import.meta.url);
const source = readFileSync(migrationPath, 'utf8');
const normalise = (sql) => sql.replace(/--[^\r\n]*/g, '').split(';')
  .map((statement) => statement.replace(/\s+/g, ' ').trim()).filter(Boolean);
const statements = normalise(source);

assert.equal(statements[0], 'BEGIN');
assert.equal(statements.at(-1), 'COMMIT');
assert.equal(statements.filter((statement) => statement.startsWith('ALTER TABLE')).length, 4,
  'migration changes only the existing ShopSettings and Conversation tables and adds their checks');
assert.ok(statements.some((statement) => statement === 'ALTER TABLE "shopify"."ShopSettings" ADD COLUMN "aiResponseDelayMinutes" INTEGER NOT NULL DEFAULT 0'));
assert.ok(statements.some((statement) => statement === 'ALTER TABLE "whatsapp"."Conversation" ADD COLUMN "pendingAiNotBeforeAt" TIMESTAMPTZ(3), ADD COLUMN "pendingAiControlRevision" INTEGER, ADD COLUMN "pendingAiDelayMinutes" INTEGER'));
assert.ok(statements.some((statement) => statement === 'CREATE INDEX "Conversation_pendingAiNotBeforeAt_id_idx" ON "whatsapp"."Conversation"("pendingAiNotBeforeAt", "id")'));
assert.ok(statements.some((statement) => statement === 'ALTER TABLE "shopify"."ShopSettings" ADD CONSTRAINT "ShopSettings_aiResponseDelayMinutes_range" CHECK ("aiResponseDelayMinutes" >= 0 AND "aiResponseDelayMinutes" <= 30)'));
const triple = statements.find((statement) => statement.includes('ADD CONSTRAINT "Conversation_pendingAiTriple_consistency"'));
assert.ok(triple, 'the named pending-AI snapshot consistency check must be added');
for (const invariant of [
  '"pendingAiNotBeforeAt" IS NULL',
  '"pendingAiControlRevision" IS NULL',
  '"pendingAiDelayMinutes" IS NULL',
  '"pendingAiNotBeforeAt" IS NOT NULL',
  '"pendingAiControlRevision" IS NOT NULL',
  '"pendingAiDelayMinutes" IS NOT NULL',
  '"pendingTurnStartedAt" IS NOT NULL',
  '"pendingAiControlRevision" >= 0',
  '"pendingAiDelayMinutes" >= 0',
  '"pendingAiDelayMinutes" <= 30',
  '"pendingAiNotBeforeAt" >= ("pendingTurnStartedAt" AT TIME ZONE \'UTC\')',
]) assert.ok(triple.includes(invariant), `missing consistency invariant: ${invariant}`);
assert.equal(statements.length, 7, 'migration contains only the scoped field, index, and check changes');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('PASS ARCH-054 exact migration DDL, constraint names and pending-AI integrity rules');
}
