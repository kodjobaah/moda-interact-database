import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Runs only on its own ephemeral pgvector container (no published port or
// external DATABASE_URL). Never use production databases for migration tests.
assert.deepEqual(process.argv.slice(2), ['--mode', 'fresh'], 'Use --mode fresh only');
const container = `moda-arch040-db006-${randomUUID()}`;
const database = 'arch040_follow_up_release';
const image = 'pgvector/pgvector:pg17';
let started = false;
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
  '-A', '-t', '-U', 'postgres', '-d', database];
const sql = (statement) => docker(psqlArgs, { input: statement }).trim();
const scalar = (statement) => sql(statement).split('\n').at(-1)?.trim();
const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;
const attemptTable = '"commerce"."RecoveryOutreachAttempt"';
const commandTable = '"whatsapp"."MerchantConversationSendCommand"';
const reset = (attempt) => `UPDATE ${attemptTable} SET "initiatedBy"=NULL,
  "initiationKey"=NULL,"claimedAt"=NULL,"updatedAt"=now()
  WHERE "id"=${quote(attempt)};`;
function rejects(name, statement) {
  try { sql(statement); }
  catch (error) {
    assert.match(String(error.stderr ?? ''), /ERROR:/, `${name}: PostgreSQL must reject the mutation`);
    return;
  }
  assert.fail(`${name}: unexpectedly accepted`);
}
function fixture(number, shop = 's1') {
  const id = `a${number}`;
  sql(`INSERT INTO "commerce"."CheckoutRecovery"
      ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
      ('r${number}',${quote(shop)},'token-${number}',now(),now());
    INSERT INTO "whatsapp"."Conversation"
      ("id","checkoutRecoveryId","type","updatedAt") VALUES
      ('c${number}','r${number}','RECOVERY',now());
    INSERT INTO ${attemptTable}
      ("id","checkoutRecoveryId","recipient","sequence","trigger", "configuredOfferMode",
       "initiatedBy","initiationKey","claimedAt","followUpDueAt","updatedAt") VALUES
      (${quote(id)},'r${number}','447700900001',2,'POST_WINDOW_FOLLOW_UP','NONE',
       'HUMAN','claim-${number}',now(),now()+interval '1 hour',now());`);
  return id;
}
const hex = 'a'.repeat(64);
function command(id, number, { shop = 's1', conversation = `c${number}`, attempt = `a${number}`,
  key = `claim-${number}`, revision = 0 } = {}) {
  return `INSERT INTO ${commandTable}
    ("id","shopId","conversationId","idempotencyKey","payloadSha256",
     "expectedControlRevision","kind","recipientSnapshot","templateName",
     "templateLanguageCode","recoveryOutreachAttemptId","updatedAt") VALUES
    (${quote(id)},${quote(shop)},${quote(conversation)},${quote(key)},${quote(hex)},${revision},
     'RECOVERY_FOLLOW_UP_TEMPLATE','447700900001','approved_follow_up','en_GB',
     ${quote(attempt)},now());`;
}
function assertClaim(id, key) {
  assert.equal(scalar(`SELECT coalesce("initiationKey",'NULL') FROM ${attemptTable} WHERE "id"=${quote(id)}`), key);
}
function humanMessage(id, conversation, key = null) {
  sql(`INSERT INTO "whatsapp"."ConversationMessage"
    ("id","conversationId","direction","senderType","content") VALUES
    (${quote(id)},${quote(conversation)},'OUTBOUND','HUMAN','Customer reply');`);
  if (key !== null) {
    sql(`UPDATE "whatsapp"."ConversationMessage"
      SET "providerDispatchKey"=${quote(key)},"providerDispatchAdmittedAt"=now(),
        "providerDispatchControlRevision"=1 WHERE "id"=${quote(id)};`);
  }
}
async function main() {
  docker(['run','-d','--name',container,'--network','none',
    '-e','POSTGRES_PASSWORD=arch040-fixture','-e',`POSTGRES_DB=${database}`,image]);
  started = true;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      docker(['exec', container, 'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',database]);
      ready = true;
      break;
    } catch { await sleep(1000); }
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  const root = new URL('../prisma/migrations/', import.meta.url);
  const migrations = readdirSync(root).filter((name) => /^\d{14}_/.test(name)).sort();
  assert.ok(migrations.includes('20261019133000_arch040_follow_up_reservation_release'));
  for (const name of migrations) sql(readFileSync(new URL(`${name}/migration.sql`,root),'utf8'));
  console.log(`PASS fresh migration chain (${migrations.length} migrations)`);

  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
    ('s1','arch040-release-shop-one.example',now()),
    ('s2','arch040-release-shop-two.example',now());`);
  assert.equal(scalar(`SELECT indisunique::text FROM pg_index WHERE indexrelid=
    '"whatsapp"."MerchantSend_outreach_attempt_idx"'::regclass`),'false');
  assert.equal(scalar(`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp' AND
    indexname='MerchantConversationSendCommand_recoveryOutreachAttemptId_key'`),'0');
  assert.equal(scalar(`SELECT confdeltype FROM pg_constraint WHERE conname=
    'MerchantConversationSendCommand_recoveryOutreachAttemptId_fkey'`),'r');

  fixture(1);
  sql(command('cmd-a',1));
  rejects('duplicate idempotency key',command('cmd-duplicate',1,{ key:'claim-1' }));
  rejects('duplicate physical sequence-two attempt',
    `INSERT INTO ${attemptTable} ("id","checkoutRecoveryId","recipient","sequence","trigger",
      "configuredOfferMode","updatedAt") VALUES
      ('duplicate-attempt','r1','447700900001',2,'POST_WINDOW_FOLLOW_UP','NONE',now());`);
  sql(`UPDATE ${commandTable} SET "state"='CANCELLED',"completedAt"=now()
    WHERE "id"='cmd-a';`);
  const before = scalar(`SELECT "trigger"::text||'/'||"followUpDueAt"::text FROM ${attemptTable} WHERE "id"='a1'`);
  assert.equal(scalar(`WITH released AS (UPDATE ${attemptTable}
    SET "initiatedBy"=NULL,"initiationKey"=NULL,"claimedAt"=NULL,"updatedAt"=now()
    WHERE "id"='a1' AND "initiationKey"='claim-1' AND "status"='PENDING'
      AND "outboundMessageId" IS NULL AND "sentAt" IS NULL RETURNING "id")
    SELECT count(*) FROM released`),'1');
  assertClaim('a1','NULL');
  assert.equal(scalar(`SELECT "trigger"::text||'/'||"followUpDueAt"::text FROM ${attemptTable} WHERE "id"='a1'`),before);
  assert.equal(scalar(`SELECT "state"::text||'/'||"recoveryOutreachAttemptId" FROM ${commandTable}
    WHERE "id"='cmd-a'`),'CANCELLED/a1');
  assert.equal(scalar(`WITH released AS (UPDATE ${attemptTable}
    SET "initiationKey"=NULL WHERE "id"='a1' AND "initiationKey"='claim-1' RETURNING "id")
    SELECT count(*) FROM released`),'0');
  sql(`UPDATE ${attemptTable} SET "initiatedBy"='HUMAN',"initiationKey"='claim-1b',
    "claimedAt"=now(),"trigger"='NO_RESPONSE_FOLLOW_UP' WHERE "id"='a1';`);
  sql(command('cmd-b',1,{ key:'claim-1b' }));
  assert.equal(scalar(`SELECT count(*) FROM ${commandTable} WHERE "recoveryOutreachAttemptId"='a1'`),'2');
  assert.equal(scalar(`SELECT count(*) FROM ${attemptTable} WHERE "checkoutRecoveryId"='r1' AND "sequence"=2`),'1');
  sql(`INSERT INTO ${attemptTable} ("id","checkoutRecoveryId","recipient","sequence",
      "trigger","configuredOfferMode","updatedAt") VALUES
      ('a1-third','r1','447700900001',3,'NO_RESPONSE_FOLLOW_UP','NONE',now());`);
  rejects('old cancelled command FK cannot be relinked',
    `UPDATE ${commandTable} SET "recoveryOutreachAttemptId"='a1-third' WHERE "id"='cmd-a';`);
  rejects('old cancelled command FK cannot be unlinked',
    `UPDATE ${commandTable} SET "recoveryOutreachAttemptId"=NULL WHERE "id"='cmd-a';`);
  rejects('cancelled command tombstone cannot reopen',
    `UPDATE ${commandTable} SET "state"='ACCEPTED' WHERE "id"='cmd-a';`);
  rejects('old cancelled command payload cannot change',
    `UPDATE ${commandTable} SET "templateName"='changed' WHERE "id"='cmd-a';`);
  rejects('linked attempt cannot be deleted', `DELETE FROM ${attemptTable} WHERE "id"='a1';`);
  rejects('claim reset cannot also mutate recipient',reset('a1').replace('"updatedAt"=now()',`"updatedAt"=now(),"recipient"='different'`));
  console.log('PASS immutable cancelled A, reset, reclaim B, shared FK, unique attempt/idempotency');

  fixture(2,'s2');
  rejects('cross-recovery command reference',command('wrong-tenant',2,{ shop:'s1', conversation:'c1' }));
  rejects('claimed tuple cannot change',`UPDATE ${attemptTable} SET "initiationKey"='other' WHERE "id"='a2';`);
  rejects('claim reset cannot change trigger',reset('a2').replace('"updatedAt"=now()',`"updatedAt"=now(),"trigger"='NO_RESPONSE_FOLLOW_UP'`));
  rejects('claim reset cannot change offer',reset('a2').replace('"updatedAt"=now()',`"updatedAt"=now(),"offerSnapshot"='{"foo":"bar"}'::jsonb`));
  rejects('claim reset cannot change follow-up schedule',reset('a2').replace('"updatedAt"=now()',`"updatedAt"=now(),"followUpDueAt"=now()+interval '2 hours'`));
  rejects('partial claim reset',`UPDATE ${attemptTable} SET "initiationKey"=NULL WHERE "id"='a2';`);
  // A cancelled pre-provider attempt is a valid non-PENDING fixture. The
  // WAITING_FOR_RESPONSE state requires sentAt and an outbound message (ARCH-016).
  sql(`UPDATE ${attemptTable} SET "status"='CANCELLED' WHERE "id"='a2';`);
  assert.equal(scalar(`SELECT "status"::text FROM ${attemptTable} WHERE "id"='a2'`), 'CANCELLED');
  rejects('non-pending attempt',reset('a2'));
  assertClaim('a2','claim-2');

  fixture(3);
  humanMessage('m-no-permit','c3');
  sql(command('cmd-with-message',3));
  sql(`UPDATE ${commandTable} SET "outboundMessageId"='m-no-permit' WHERE "id"='cmd-with-message';`);
  rejects('command outbound evidence without provider key',reset('a3'));
  assertClaim('a3','claim-3');

  fixture(4);
  humanMessage('m-attempt','c4');
  sql(`UPDATE ${attemptTable} SET "outboundMessageId"='m-attempt' WHERE "id"='a4';`);
  rejects('attempt outbound evidence',reset('a4'));

  fixture(5);
  sql(`UPDATE ${attemptTable} SET "sentAt"=now() WHERE "id"='a5';`);
  rejects('attempt sent timestamp',reset('a5'));

  fixture(6);
  // Admission requires the human-control revision that is current at permit time.
  sql(`BEGIN;
    UPDATE "whatsapp"."Conversation" SET "controlMode"='HUMAN',
      "controlRevision"=1,"controlChangedAt"=now(),"updatedAt"=now()
      WHERE "id"='c6';
    INSERT INTO "whatsapp"."ConversationControlEvent"
      ("id","conversationId","fromMode","toMode","fromRevision","toRevision")
      VALUES ('control-c6','c6','AI','HUMAN',0,1);
    COMMIT;`);
  sql(command('cmd-permit',6,{ revision: 1 }));
  humanMessage('m-permit','c6');
  sql(`UPDATE ${commandTable} SET "state"='CLAIMED',"leaseToken"='lease-c6',
    "leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=1
    WHERE "id"='cmd-permit';`);
  sql(`UPDATE "whatsapp"."ConversationMessage" SET "providerDispatchKey"='provider-c6',
    "providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=1 WHERE "id"='m-permit';`);
  sql(`UPDATE ${commandTable} SET "state"='DISPATCH_ADMITTED',
    "providerDispatchKey"='provider-c6',"providerDispatchAdmittedAt"=now(),
    "providerDispatchControlRevision"=1,"providerDispatchRestrictionRevision"=0,
    "outboundMessageId"='m-permit',"leaseToken"=NULL,"leaseExpiresAt"=NULL
    WHERE "id"='cmd-permit';`);
  for (const state of ['DISPATCH_ADMITTED','UNKNOWN','SENT']) {
    if (state !== 'DISPATCH_ADMITTED') sql(`UPDATE ${commandTable} SET "state"='${state}' WHERE "id"='cmd-permit';`);
    rejects(`${state} provider admission irreversible`,reset('a6'));
    assertClaim('a6','claim-6');
  }
  console.log('PASS provider evidence and post-permit states cannot release a claim');
  console.log('PASS ARCH-040-DATABASE-006 disposable PostgreSQL suite');
}
try { await main(); }
finally {
  if (started) {
    try { docker(['rm','-f',container]); }
    catch (error) { console.error('Disposable PostgreSQL cleanup failed:',error.message); }
  }
}
