import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 1), ['--mode'], 'Use --mode fresh or upgrade');
assert.equal(args.length, 2, 'Use --mode fresh or upgrade with no extra arguments');
const mode = args[1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or upgrade');

const target = '20261031170000_arch054_merchant_ai_response_delay';
const container = `moda-arch054-ai-delay-${randomUUID()}`;
const database = 'arch054_ai_response_delay';
const docker = (dockerArgs, options = {}) => execFileSync('docker', dockerArgs, {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', database];
const sql = (statement) => docker(psqlArgs, { input: statement }).trim();
const scalar = (statement) => sql(statement).split('\n').at(-1)?.trim() ?? '';
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
const migrationFile = (name) => new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url);
const fixedTime = '2026-10-30T12:00:00.000Z';

function insertLegacyRows() {
  sql(`INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt")
    VALUES ('arch054-legacy-shop', 'arch054-legacy.example.invalid', ${quote(fixedTime)});
    INSERT INTO "shopify"."ShopSettings" ("id", "shopId", "recoveryDelayMinutes", "updatedAt")
    VALUES ('arch054-legacy-settings', 'arch054-legacy-shop', 17, ${quote(fixedTime)});
    INSERT INTO "whatsapp"."Conversation" ("id", "type", "pendingTurnStartedAt", "updatedAt")
    VALUES ('arch054-legacy-conversation', 'RECOVERY', ${quote(fixedTime)}, ${quote(fixedTime)});`);
}

function assertRejected(statement, pattern, message) {
  try {
    sql(statement);
  } catch (error) {
    assert.match(String(error.stderr), pattern, message);
    return;
  }
  assert.fail(message);
}

function assertRangeRejected(settingId, value) {
  assertRejected(
    `UPDATE "shopify"."ShopSettings" SET "aiResponseDelayMinutes"=${value} WHERE "id"=${quote(settingId)};`,
    /ShopSettings_aiResponseDelayMinutes_range|invalid input syntax for type integer/i,
    `shop AI delay ${value} must be rejected`,
  );
}

function assertPendingDelayRejected(conversationId, value) {
  assertRejected(
    `UPDATE "whatsapp"."Conversation" SET "pendingAiDelayMinutes"=${value} WHERE "id"=${quote(conversationId)};`,
    /Conversation_pendingAiTriple_consistency|invalid input syntax for type integer/i,
    `pending AI delay ${value} must be rejected`,
  );
}

function insertFixtures(prefix) {
  const shopId = `${prefix}-shop`;
  const settingId = `${prefix}-settings`;
  const idleId = `${prefix}-idle-conversation`;
  const pendingId = `${prefix}-pending-conversation`;
  sql(`INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt")
    VALUES (${quote(shopId)}, ${quote(`${shopId}.example.invalid`)}, ${quote(fixedTime)});
    INSERT INTO "shopify"."ShopSettings" ("id", "shopId", "updatedAt")
    VALUES (${quote(settingId)}, ${quote(shopId)}, ${quote(fixedTime)});
    INSERT INTO "whatsapp"."Conversation" ("id", "type", "updatedAt")
    VALUES (${quote(idleId)}, 'RECOVERY', ${quote(fixedTime)});
    INSERT INTO "whatsapp"."Conversation"
      ("id", "type", "pendingTurnStartedAt", "pendingAiNotBeforeAt", "pendingAiControlRevision", "pendingAiDelayMinutes", "updatedAt")
    VALUES (${quote(pendingId)}, 'RECOVERY', ${quote(fixedTime)}, '2026-10-30T12:30:00.000Z', 0, 0, ${quote(fixedTime)});`);

  assert.equal(scalar(`SELECT "aiResponseDelayMinutes" FROM "shopify"."ShopSettings" WHERE "id"=${quote(settingId)};`), '0',
    'new shop settings default to zero AI delay');
  assert.equal(scalar(`SELECT "recoveryDelayMinutes" FROM "shopify"."ShopSettings" WHERE "id"=${quote(settingId)};`), '30',
    'existing recovery delay default remains unchanged');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "id"=${quote(idleId)} AND "pendingAiNotBeforeAt" IS NULL AND "pendingAiControlRevision" IS NULL AND "pendingAiDelayMinutes" IS NULL;`), '1',
    'idle conversations keep all pending-AI snapshot fields NULL');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "id"=${quote(pendingId)} AND "pendingAiNotBeforeAt" IS NOT NULL AND "pendingAiControlRevision"=0 AND "pendingAiDelayMinutes"=0;`), '1',
    'valid zero-delay pending snapshot persists');
  const timezoneIndependentId = `${prefix}-timezone-independent`;
  sql(`SET TIME ZONE 'America/Los_Angeles';
    INSERT INTO "whatsapp"."Conversation"
      ("id", "type", "pendingTurnStartedAt", "pendingAiNotBeforeAt", "pendingAiControlRevision", "pendingAiDelayMinutes", "updatedAt")
    VALUES (${quote(timezoneIndependentId)}, 'RECOVERY', ${quote(fixedTime)}, '2026-10-30T12:30:00.000Z', 0, 30, ${quote(fixedTime)});`);
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "id"=${quote(timezoneIndependentId)};`), '1',
    'UTC deadline after UTC turn start is accepted under a non-UTC session timezone');

  sql(`UPDATE "whatsapp"."Conversation" SET "pendingAiControlRevision"=3, "pendingAiDelayMinutes"=30
    WHERE "id"=${quote(pendingId)};`);
  assert.equal(scalar(`SELECT "pendingAiDelayMinutes" FROM "whatsapp"."Conversation" WHERE "id"=${quote(pendingId)};`), '30',
    'maximum valid pending delay persists');
  assertRangeRejected(settingId, '-1');
  assertRangeRejected(settingId, '31');
  assertRangeRejected(settingId, "'0.5'");
  assertPendingDelayRejected(pendingId, '-1');
  assertPendingDelayRejected(pendingId, '31');
  assertPendingDelayRejected(pendingId, "'0.5'");
  assertRejected(`UPDATE "whatsapp"."Conversation" SET "pendingAiControlRevision"=-1 WHERE "id"=${quote(pendingId)};`,
    /Conversation_pendingAiTriple_consistency/, 'negative pending control revisions must be rejected');
  assertRejected(`UPDATE "whatsapp"."Conversation" SET "pendingAiNotBeforeAt"=NULL WHERE "id"=${quote(pendingId)};`,
    /Conversation_pendingAiTriple_consistency/, 'mixed-null pending-AI snapshot must be rejected');
  assertRejected(`SET TIME ZONE 'America/Los_Angeles'; UPDATE "whatsapp"."Conversation" SET "pendingAiNotBeforeAt"='2026-10-30T11:59:59.999Z' WHERE "id"=${quote(pendingId)};`,
    /Conversation_pendingAiTriple_consistency/, 'deadline before pending-turn start must be rejected under a non-UTC session timezone');
  assertRejected(`INSERT INTO "whatsapp"."Conversation"
    ("id", "type", "pendingAiNotBeforeAt", "pendingAiControlRevision", "pendingAiDelayMinutes", "updatedAt")
    VALUES (${quote(`${prefix}-without-start`)}, 'RECOVERY', '2026-10-30T12:30:00.000Z', 0, 0, ${quote(fixedTime)});`,
    /Conversation_pendingAiTriple_consistency/, 'pending snapshot without pendingTurnStartedAt must be rejected');
  sql(`UPDATE "whatsapp"."Conversation" SET "pendingAiNotBeforeAt"=NULL, "pendingAiControlRevision"=NULL, "pendingAiDelayMinutes"=NULL WHERE "id"=${quote(pendingId)};`);
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "id"=${quote(pendingId)} AND "pendingAiNotBeforeAt" IS NULL AND "pendingAiControlRevision" IS NULL AND "pendingAiDelayMinutes" IS NULL;`), '1',
    'nulling the complete pending-AI snapshot succeeds');
  assert.equal(scalar(`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp' AND tablename='Conversation' AND indexname='Conversation_pendingAiNotBeforeAt_id_idx';`), '1',
    'bounded due-scan btree index exists');
  console.log('PASS default, idle NULLs, valid 0/30, range/type failures, mixed-null, negative revision, UTC timestamp order in non-UTC sessions and due index');
}

async function run() {
  let containerStarted = false;
  try {
    docker(['run', '--detach', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=arch054-test', '-e', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
    containerStarted = true;
    let ready = false;
    let lastError;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', database]);
        ready = true;
        break;
      } catch (error) {
        lastError = error;
        await delay(500);
      }
    }
    assert.ok(ready, `disposable PostgreSQL did not become ready: ${lastError?.message ?? 'no readiness response'}`);

    const migrations = readdirSync(migrationDirectory).filter((name) => /^\d{14}_/.test(name)).sort();
    const targetIndex = migrations.indexOf(target);
    assert.ok(targetIndex >= 0, `expected migration ${target} to exist`);
    const priorMigrations = migrations.slice(0, targetIndex);
    for (const name of priorMigrations) sql(readFileSync(migrationFile(name), 'utf8'));
    if (mode === 'upgrade') insertLegacyRows();
    sql(readFileSync(migrationFile(target), 'utf8'));

    if (mode === 'upgrade') {
      assert.equal(scalar(`SELECT "aiResponseDelayMinutes" FROM "shopify"."ShopSettings" WHERE "id"='arch054-legacy-settings';`), '0',
        'existing shop settings receive the zero default');
      assert.equal(scalar(`SELECT "recoveryDelayMinutes" FROM "shopify"."ShopSettings" WHERE "id"='arch054-legacy-settings';`), '17',
        'existing recovery delay remains unchanged on upgrade');
      assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "id"='arch054-legacy-conversation' AND "pendingTurnStartedAt"=${quote(fixedTime)}::timestamp AND "pendingAiNotBeforeAt" IS NULL AND "pendingAiControlRevision" IS NULL AND "pendingAiDelayMinutes" IS NULL;`), '1',
        'legacy conversation data is retained and new snapshot fields default to NULL');
    }
    assert.equal(scalar(`SELECT count(*) FROM pg_constraint WHERE conname IN ('ShopSettings_aiResponseDelayMinutes_range', 'Conversation_pendingAiTriple_consistency');`), '2',
      'both named database checks are installed');
    insertFixtures(`arch054-${mode}`);
    console.log(`PASS ARCH-054-DATABASE-001 PostgreSQL ${mode} (${targetIndex + 1} migrations through target)`);
  } finally {
    if (containerStarted) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}

await run();
