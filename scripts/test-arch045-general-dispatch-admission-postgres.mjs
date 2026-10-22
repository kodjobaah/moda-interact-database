import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Apply real migrations to a disposable, network-isolated PostgreSQL instance.
// Never use DATABASE_URL or any developer/production database for this test.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined;
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh or --mode upgrade');
const target = '20261022215000_arch045_general_conversation_dispatch_admission';
const container = `moda-arch045-dispatch-${randomUUID()}`;
const database = 'arch045_general_dispatch_test';
const directory = new URL('../prisma/migrations/', import.meta.url);
let started = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
  });
}
function sql(source) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], { input: source }).trim();
}
function scalar(source) { return sql(source).split('\n').at(-1)?.trim() ?? ''; }
function rejected(name, statement, expected = '23514') {
  // Savepoint semantics allow verifying SQLSTATE with no persistent side effects.
  const statementBody = statement.trim().replace(/;+$/, '');
  sql(`DO $test$ DECLARE observed TEXT;
    BEGIN
      BEGIN
        ${statementBody};
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE;
      END;
      IF observed IS DISTINCT FROM '${expected}' THEN
        RAISE EXCEPTION 'Expected SQLSTATE ${expected} for ${name}, got %', observed;
      END IF;
    END $test$;`);
}
function migrate(name) {
  sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
}
async function waitForPostgres() {
  for (let n = 0; n < 90; n += 1) {
    try {
      docker(['exec', container, 'pg_isready', '-q', '-U', 'postgres', '-d', database], {
        stdio: 'ignore',
      });
      return;
    } catch { await delay(500); }
  }
  throw new Error('Disposable PostgreSQL container did not become ready');
}
function admit(messageId, dispatchKey, revision) {
  return `UPDATE "whatsapp"."ConversationMessage" SET
    "providerDispatchKey"='${dispatchKey}',
    "providerDispatchAdmittedAt"=statement_timestamp(),
    "providerDispatchControlRevision"=${revision}
    WHERE "id"='${messageId}'`;
}
function message(id, conversationId, senderType = 'AGENT', direction = 'OUTBOUND') {
  return `('${id}','${conversationId}','${direction}','${senderType}','payload-${id}')`;
}
function seedConversations() {
  // These synthetic non-recovery fixtures test the expanded database guard,
  // not whether application conversation creation produces such records.
  // Every fixture has a valid merchant and customer identity.
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
    ('dispatch-shop','arch045-dispatch.example',now()),
    ('dispatch-other','arch045-dispatch-other.example',now());
    INSERT INTO "commerce"."Customer" ("id","shopId","phone","updatedAt") VALUES
    ('dispatch-customer','dispatch-shop','07400123456',now()),
    ('dispatch-other-customer','dispatch-other','07400123457',now());
    INSERT INTO "commerce"."CheckoutRecovery"
      ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
    ('dispatch-recovery-ai','dispatch-shop','arch045-recovery-one',now(),now()),
    ('dispatch-recovery-human','dispatch-shop','arch045-recovery-two',now(),now());
    INSERT INTO "whatsapp"."Conversation"
      ("id","shopId","customerId","checkoutRecoveryId","type","updatedAt") VALUES
    ('general-support','dispatch-shop','dispatch-customer',NULL,'PRODUCT_SUPPORT',now()),
    ('general-purchase','dispatch-shop','dispatch-customer',NULL,'POST_PURCHASE',now()),
    ('general-other','dispatch-other','dispatch-other-customer',NULL,'PRODUCT_DISCOVERY',now()),
    ('recovery-ai','dispatch-shop','dispatch-customer','dispatch-recovery-ai','RECOVERY',now()),
    ('recovery-human','dispatch-shop','dispatch-customer','dispatch-recovery-human','RECOVERY',now());
    INSERT INTO "whatsapp"."ConversationMessage"
      ("id","conversationId","direction","senderType","content") VALUES
      ${[
        message('general-agent','general-support'),
        message('general-automation','general-support','AUTOMATION'),
        message('general-wrong-revision','general-support'),
        message('general-human','general-purchase','HUMAN'),
        message('general-agent-after-handover','general-purchase'),
        message('general-other-message','general-other'),
        message('general-inbound','general-support','CUSTOMER','INBOUND'),
        message('recovery-ai-message','recovery-ai'),
        message('recovery-human-message','recovery-human','HUMAN'),
        message('recovery-agent-after-handover','recovery-human'),
      ].join(',\n')};`);
}
function transition(conversationId, from, to) {
  // ARCH-040 requires control changes and their audit record to commit together.
  sql(`BEGIN;
    UPDATE "whatsapp"."Conversation" SET
      "controlMode"='${to}', "controlRevision"=1,
      "controlChangedAt"=statement_timestamp(), "updatedAt"=statement_timestamp()
    WHERE "id"='${conversationId}' AND "controlMode"='${from}' AND "controlRevision"=0;
    INSERT INTO "whatsapp"."ConversationControlEvent"
      ("id","conversationId","fromMode","toMode","fromRevision","toRevision") VALUES
      ('event-${conversationId}','${conversationId}','${from}','${to}',0,1);
    COMMIT;`);
}
function assertTriggerStillInstalled() {
  assert.equal(scalar(`SELECT count(*) FROM pg_trigger
    WHERE tgname='arch040_message_dispatch_guard' AND NOT tgisinternal
      AND tgrelid='"whatsapp"."ConversationMessage"'::regclass`), '1');
  assert.equal(scalar(`SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='whatsapp' AND p.proname='arch040_message_dispatch_guard'`), '1');
}
function assertGeneralAndRecoveryAdmissions() {
  assertTriggerStillInstalled();
  sql(admit('general-agent','arch045-general-agent',0));
  sql(admit('general-automation','arch045-general-automation',0));
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationMessage"
    WHERE "providerDispatchKey" LIKE 'arch045-general-%'`), '2');
  // Both INSERT-time and UPDATE-time provider permits use the same trigger.
  sql(`INSERT INTO "whatsapp"."ConversationMessage"
    ("id","conversationId","direction","senderType","content",
     "providerDispatchKey","providerDispatchAdmittedAt","providerDispatchControlRevision")
    VALUES ('general-direct-insert','general-support','OUTBOUND','AGENT','inserted permit',
      'arch045-general-direct-insert',statement_timestamp(),0);`);
  rejected('direct insert requires matching control revision', `
    INSERT INTO "whatsapp"."ConversationMessage"
      ("id","conversationId","direction","senderType","content",
       "providerDispatchKey","providerDispatchAdmittedAt","providerDispatchControlRevision")
    VALUES ('general-invalid-insert','general-support','OUTBOUND','AGENT','stale permit',
      'arch045-general-invalid-insert',statement_timestamp(),1)`);
  rejected('general stale control revision', admit('general-wrong-revision','stale-general',1));
  rejected('general human sender while AI controlled', admit('general-human','human-before-handover',0));
  rejected('inbound message cannot acquire dispatch permit',
    admit('general-inbound','inbound-dispatch',0));
  transition('general-purchase','AI','HUMAN');
  rejected('general AI sender after HUMAN takeover',
    admit('general-agent-after-handover','general-after-handover',1));
  sql(admit('general-human','arch045-general-human',1));

  if (mode === 'fresh') sql(admit('recovery-ai-message','arch040-recovery-ai',0));
  assert.equal(scalar(`SELECT "providerDispatchKey" FROM "whatsapp"."ConversationMessage"
    WHERE "id"='recovery-ai-message'`), 'arch040-recovery-ai');
  rejected('recovery HUMAN sender while AI controlled',
    admit('recovery-human-message','human-before-takeover',0));
  transition('recovery-human','AI','HUMAN');
  rejected('recovery AGENT sender after HUMAN takeover',
    admit('recovery-agent-after-handover','recovery-ai-after-takeover',1));
  sql(admit('recovery-human-message','arch040-recovery-human',1));
  rejected('recovery control revision stale',
    admit('recovery-agent-after-handover','recovery-stale',0));
  console.log('PASS general AI/AUTOMATION/HUMAN and recovery AI/HUMAN control admission');
}
function assertImmutableAndUniqueAdmissions() {
  rejected('immutable key', `UPDATE "whatsapp"."ConversationMessage"
    SET "providerDispatchKey"='different-key' WHERE "id"='general-agent'`);
  rejected('immutable admitted timestamp', `UPDATE "whatsapp"."ConversationMessage"
    SET "providerDispatchAdmittedAt"=now()+interval '1 second' WHERE "id"='general-agent'`);
  rejected('immutable control revision', `UPDATE "whatsapp"."ConversationMessage"
    SET "providerDispatchControlRevision"=1 WHERE "id"='general-agent'`);
  rejected('immutable content', `UPDATE "whatsapp"."ConversationMessage"
    SET "content"='tampered' WHERE "id"='general-agent'`);
  rejected('immutable sender', `UPDATE "whatsapp"."ConversationMessage"
    SET "senderType"='AUTOMATION' WHERE "id"='general-agent'`);
  rejected('immutable conversation identity', `UPDATE "whatsapp"."ConversationMessage"
    SET "conversationId"='general-other' WHERE "id"='general-agent'`);
  rejected('immutable direction', `UPDATE "whatsapp"."ConversationMessage"
    SET "direction"='INBOUND' WHERE "id"='general-agent'`);
  rejected('globally unique dispatch key across shops',
    admit('general-other-message','arch045-general-agent',0), '23505');
  rejected('duplicate admission changes original permit timestamp',
    admit('general-agent','arch045-general-agent',0));
  // Normal delivery status transitions remain possible after admission.
  sql(`UPDATE "whatsapp"."ConversationMessage" SET
    "status"='SENT', "sentAt"=now(), "providerMessageId"='wamid.general.arch045'
    WHERE "id"='general-agent';`);
  assert.equal(scalar(`SELECT "status"::text || ':' || "providerDispatchKey"
    FROM "whatsapp"."ConversationMessage" WHERE "id"='general-agent'`),
  'SENT:arch045-general-agent');
  console.log('PASS immutable admitted message, global permit uniqueness, SENT status update');
}
async function main() {
  try {
    docker(['run', '--detach', '--name', container, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=arch045-test-only',
      '--env', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
    started = true;
    await waitForPostgres();
    const names = readdirSync(directory).filter((name) => /^\d{14}_/.test(name)).sort();
    assert.ok(names.includes(target), 'forward migration missing');
    const position = names.indexOf(target);
    assert.ok(position > 0, 'forward migration must follow ARCH-040');
    for (let i = 0; i < names.length; i += 1) {
      if (mode === 'upgrade' && i === position) {
        seedConversations();
        assertTriggerStillInstalled();
        rejected('prior ARCH-040 recovery-only guard rejects general admission',
          admit('general-agent','before-forward-migration',0));
        // Confirm upgrade preserves permits admitted by the original function.
        sql(admit('recovery-ai-message','arch040-recovery-ai',0));
        console.log('PASS upgrade baseline: general denied, recovery already admitted');
      }
      migrate(names[i]);
    }
    if (mode === 'fresh') seedConversations();
    assertGeneralAndRecoveryAdmissions();
    assertImmutableAndUniqueAdmissions();
    console.log(`PASS ARCH-045-DATABASE-004 ${mode} (${names.length} migrations)`);
  } finally {
    if (started) {
      try { docker(['rm', '--force', container]); }
      catch (error) { console.error('Disposable container cleanup failed:', error.message); }
    }
  }
}
await main();
