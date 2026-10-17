import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { runArch040PostgresContention } from './arch040-postgres-contention.mjs';

// Verify the complete migration chain on a fresh, disposable database only.
// Use disposable, network-isolated PostgreSQL; never production credentials.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.equal(mode, 'fresh', 'ARCH-040 validation supports --mode fresh only');
const targetMigration = '20261017120000_arch040_recovery_human_handover';
const image = 'pgvector/pgvector:pg17';
const container = `moda-arch040-db001-${randomUUID()}`;
const db = 'arch040_human_handover';
let running = false;
function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}
function dbArgs() {
  return ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', db];
}
function sql(source) { return docker(dbArgs(), { input: source }).trim(); }
function scalar(query) { return sql(query).split('\n').at(-1).trim(); }
function rejects(source, name) {
  let error;
  try { sql(source); } catch (caught) { error = caught; }
  assert.ok(error, `${name} must be rejected`);
  assert.match(String(error.stderr ?? ''), /ERROR:/, `${name} should be rejected by PostgreSQL`);
}
async function parallel(sqls) {
  return Promise.all(sqls.map((source) => new Promise((resolve, reject) => {
    const child = spawn('docker', dbArgs(), { stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
    child.stdin.end(source);
  })));
}
function transition(id, from, to, revision, auditId) {
  return `BEGIN;
    WITH changed AS (
      UPDATE "whatsapp"."Conversation" SET "controlMode"='${to}',
        "controlRevision"=${revision + 1}, "controlChangedAt"=clock_timestamp(), "updatedAt"=now()
      WHERE "id"='${id}' AND "controlMode"='${from}' AND "controlRevision"=${revision}
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "whatsapp"."ConversationControlEvent"
        ("id","conversationId","fromMode","toMode","fromRevision","toRevision")
      SELECT '${auditId}',"id",'${from}','${to}',${revision},${revision + 1} FROM changed
      RETURNING "id"
    ) SELECT count(*) FROM inserted;
    COMMIT;`;
}
function restrictionChange(id, from, to, rev, reason, admin, first = false) {
  if (first) return `BEGIN;
    INSERT INTO "commerce"."ShopHumanMessagingRestriction"
      ("shopId","status","revision","reasonCode","suspendedAt")
    VALUES ('${id}','SUSPENDED',1,'${reason}',now());
    INSERT INTO "commerce"."ShopHumanMessagingRestrictionEvent"
      ("id","shopId","fromStatus","toStatus","revision","reasonCode","platformAdminId")
    VALUES ('a-${rev}','${id}','ACTIVE','SUSPENDED',1,'${reason}','${admin}');
    COMMIT;`;
  return `BEGIN;
    WITH changed AS (
      UPDATE "commerce"."ShopHumanMessagingRestriction" SET "status"='${to}',
        "revision"=${rev}, "reasonCode"='${reason}',
        "suspendedAt"=${to === 'SUSPENDED' ? 'now()' : '"suspendedAt"'},
        "restoredAt"=${to === 'ACTIVE' ? 'now()' : '"restoredAt"'}, "updatedAt"=now()
      WHERE "shopId"='${id}' AND "revision"=${rev - 1} AND "status"='${from}' RETURNING "shopId"
    ), inserted AS (
      INSERT INTO "commerce"."ShopHumanMessagingRestrictionEvent"
        ("id","shopId","fromStatus","toStatus","revision","reasonCode","platformAdminId")
      SELECT 'a-${rev}-${reason}',"shopId",'${from}','${to}',${rev},'${reason}','${admin}' FROM changed
      RETURNING "id"
    ) SELECT count(*) FROM inserted;
    COMMIT;`;
}
const d = (x) => `'${x}'`;
async function main() {
  docker(['run', '-d', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=arch040-fixture', '-e', `POSTGRES_DB=${db}`, image]);
  running = true;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', db]);
      ready = true; break;
    } catch { await sleep(1000); }
  }
  assert.ok(ready, 'PostgreSQL was not ready');
  const migrations = new URL('../prisma/migrations/', import.meta.url);
  const names = readdirSync(migrations).filter((name) => /^\d{14}_/.test(name)).sort();
  assert.ok(names.includes(targetMigration), 'ARCH-040 migration is missing from the captured baseline');
  for (const name of names) {
    sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  }
  console.log(`PASS ${mode} migration chain (${names.length} migrations)`);
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
      ('s1','arch040-shop1.example',now()),('s2','arch040-shop2.example',now());
    INSERT INTO "public"."PlatformAdmin" ("id","email","updatedAt") VALUES
      ('admin-040','admin-040@example.test',now());
    INSERT INTO "commerce"."CheckoutRecovery" ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
      ('r1','s1','recovery-one',now(),now()),('r2','s2','recovery-two',now(),now());
    INSERT INTO "whatsapp"."Conversation" ("id","shopId","checkoutRecoveryId","type","updatedAt") VALUES
      ('c1',NULL,'r1','RECOVERY',now()),('c2','s2','r2','RECOVERY',now()),
      ('standalone','s1',NULL,'PRODUCT_SUPPORT',now());`);
  assert.equal(scalar(`SELECT "controlMode"||':'||"controlRevision"||':'||coalesce("controlChangedAt"::text,'NULL') FROM "whatsapp"."Conversation" WHERE "id"='c1'`), 'AI:0:NULL');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "checkoutRecoveryId"='r1'`), '1');
  rejects(`INSERT INTO "whatsapp"."Conversation" ("id","checkoutRecoveryId","type","updatedAt") VALUES ('dup','r1','RECOVERY',now());`, 'one conversation per recovery');
  rejects(`UPDATE "whatsapp"."Conversation" SET "controlMode"='HUMAN',"controlRevision"=1,"controlChangedAt"=now() WHERE "id"='c1';`, 'mode change without audit transaction');
  sql(transition('c1', 'AI', 'HUMAN', 0, 'control-1'));
  const race = await parallel([
    transition('c1', 'HUMAN', 'AI', 1, 'control-2a'),
    transition('c1', 'HUMAN', 'AI', 1, 'control-2b'),
  ]);
  assert.deepEqual(race.map((r) => r.match(/(?:^|\n)([01])(?:\n|$)/)?.[1]).sort(), ['0','1']);
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationControlEvent" WHERE "conversationId"='c1' AND "toRevision"=2`), '1');
  sql(transition('c1', 'AI', 'HUMAN', 2, 'control-3'));
  assert.equal(scalar(`SELECT "controlMode"||':'||"controlRevision" FROM "whatsapp"."Conversation" WHERE "id"='c1'`), 'HUMAN:3');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationControlEvent" WHERE "conversationId"='c1'`), '3');
  assert.match(sql(transition('c1', 'AI', 'HUMAN', 2, 'noop')), /0/);
  rejects(`UPDATE "whatsapp"."ConversationControlEvent" SET "toRevision"=4 WHERE "id"='control-1';`, 'immutable control audit');
  console.log('PASS control CAS, racing writers, monotonic audit and no-op');

  sql(`INSERT INTO "commerce"."RecoveryOutreachAttempt" ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","updatedAt") VALUES
    ('first','r1','447700900001',1,'INITIAL','NONE',now()),
    ('follow','r1','447700900001',2,'NO_RESPONSE_FOLLOW_UP','NONE',now()),
    ('foreign-follow','r2','447700900002',2,'NO_RESPONSE_FOLLOW_UP','NONE',now());`);
  rejects(`INSERT INTO "commerce"."RecoveryOutreachAttempt" ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","updatedAt") VALUES ('third','r1','447700900001',3,'NO_RESPONSE_FOLLOW_UP','NONE',now());`, 'no third recovery outreach');
  rejects(`INSERT INTO "commerce"."RecoveryOutreachAttempt" ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","updatedAt") VALUES ('mismatch','r2','447700900002',1,'POST_WINDOW_FOLLOW_UP','NONE',now());`, 'invalid trigger pairing');
  const attempts = await parallel(['HUMAN','AUTOMATION'].map((actor) => `WITH won AS (
    UPDATE "commerce"."RecoveryOutreachAttempt"
      SET "initiatedBy"='${actor}', "initiationKey"='follow-${actor}',"claimedAt"=now(),"updatedAt"=now()
    WHERE "id"='follow' AND "initiationKey" IS NULL RETURNING "id"
    ) SELECT count(*) FROM won;`));
  assert.deepEqual(attempts.sort(), ['0','1']);
  rejects(`UPDATE "commerce"."RecoveryOutreachAttempt" SET "initiationKey"='replace' WHERE "id"='follow';`, 'immutable winning follow-up');
  sql(`INSERT INTO "whatsapp"."ConversationMessage" ("id","conversationId","direction","senderType","content") VALUES
    ('m-customer','c1','INBOUND','CUSTOMER','Hello'),('m-human','c1','OUTBOUND','HUMAN','Reply'),
    ('m-agent','c1','OUTBOUND','AGENT','Agent'),('m-auto','c1','OUTBOUND','AUTOMATION','Automation'),
    ('m-foreign','c2','OUTBOUND','HUMAN','Foreign'),
    ('m-human-send','c1','OUTBOUND','HUMAN','Another response');`);
  rejects(`UPDATE "commerce"."RecoveryOutreachAttempt" SET "outboundMessageId"='m-foreign' WHERE "id"='follow';`, 'foreign-conversation outreach message');
  sql(`UPDATE "commerce"."RecoveryOutreachAttempt" SET "outboundMessageId"='m-human' WHERE "id"='follow';`);
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationMessage" WHERE "conversationId"='c1' AND "senderType"='HUMAN'`), '2');
  sql(`UPDATE "whatsapp"."ConversationMessage" SET "status"='SENT',"sentAt"=now() WHERE "id"='m-human';`);
  console.log('PASS unique shared follow-up, race, provenance and same-conversation FK');

  const hex = 'a'.repeat(64);
  const humanCmd = (id, shop, conversation, key, attempt = 'NULL', kind = 'HUMAN_TEXT') =>
    `INSERT INTO "whatsapp"."MerchantConversationSendCommand" ("id","shopId","conversationId","idempotencyKey","payloadSha256","expectedControlRevision","kind","recipientSnapshot",${kind === 'HUMAN_TEXT' ? '"textBody"' : '"templateName","templateLanguageCode"'},"updatedAt"${attempt === 'NULL' ? '' : ',"recoveryOutreachAttemptId"'}) VALUES
     (${d(id)},${d(shop)},${d(conversation)},${d(key)},${d(hex)},3,'${kind}','447700900001',${kind === 'HUMAN_TEXT' ? "'Hello'" : "'approved_follow_up','en_GB'"},now()${attempt === 'NULL' ? '' : ',' + attempt});`;
  sql(humanCmd('cmd-1','s1','c1','replay-1'));
  assert.equal(scalar(`SELECT "state" FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-1'`),'ACCEPTED');
  rejects(humanCmd('cmd-2','s1','c1','replay-1'),'durable idempotency replay');
  rejects(humanCmd('bad-stand','s1','standalone','standalone-key'),'no standalone sends');
  rejects(humanCmd('bad-tenant','s2','c1','other-shop-key'),'recovery-derived tenant');
  rejects(humanCmd('bad-attempt','s1','c1','wrong-attempt',"'foreign-follow'",'RECOVERY_FOLLOW_UP_TEMPLATE'),'wrong recovery follow-up');
  sql(humanCmd('cmd-follow','s1','c1','follow-key',"'follow'",'RECOVERY_FOLLOW_UP_TEMPLATE'));
  rejects(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "textBody"='tampered' WHERE "id"='cmd-1';`, 'immutable accepted payload');
  rejects(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "outboundMessageId"='m-foreign' WHERE "id"='cmd-1';`, 'wrong outbound conversation');
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='CLAIMED',"leaseToken"='worker-one',
    "leaseExpiresAt"=now()+interval '500 milliseconds',"dispatchAttemptCount"=1 WHERE "id"='cmd-1' AND "state"='ACCEPTED';`);
  rejects(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "leaseToken"='worker-stale',
    "leaseExpiresAt"=now()+interval '1 minute',"dispatchAttemptCount"=2 WHERE "id"='cmd-1';`, 'active lease cannot be stolen');
  sql('SELECT pg_sleep(0.65);');
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "leaseToken"='worker-two',
    "leaseExpiresAt"=now()+interval '1 minute',"dispatchAttemptCount"=2 WHERE "id"='cmd-1' AND "state"='CLAIMED';`);
  assert.equal(scalar(`SELECT "dispatchAttemptCount" FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-1'`),'2');
  // Admission is a short transaction: message evidence first, then durable
  // command permit, with the real consumer holding shop -> conversation locks.
  sql(`BEGIN;
    SELECT "id" FROM "commerce"."Shop" WHERE "id"='s1' FOR UPDATE;
    SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c1' FOR UPDATE;
    UPDATE "whatsapp"."ConversationMessage" SET "providerDispatchKey"='permit-one',
      "providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=3 WHERE "id"='m-human-send';
    UPDATE "whatsapp"."MerchantConversationSendCommand"
      SET "state"='DISPATCH_ADMITTED',"providerDispatchKey"='permit-one',
        "providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=3,
        "providerDispatchRestrictionRevision"=0,"outboundMessageId"='m-human-send',
        "leaseToken"=NULL,"leaseExpiresAt"=NULL
      WHERE "id"='cmd-1' AND "state"='CLAIMED' AND "leaseToken"='worker-two';
    COMMIT;`);
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='UNKNOWN' WHERE "id"='cmd-1';`);
  rejects(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='CLAIMED',"leaseToken"='worker-three',"leaseExpiresAt"=now()+interval '1 minute' WHERE "id"='cmd-1';`, 'ambiguous admitted command never redelivered');
  rejects(`UPDATE "whatsapp"."ConversationMessage" SET "providerDispatchKey"='new-permit' WHERE "id"='m-human-send';`, 'immutable dispatch message identity');
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='SENT',"completedAt"=now() WHERE "id"='cmd-1';`);
  assert.equal(scalar(`SELECT "providerDispatchKey" FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-1'`),'permit-one');
  console.log('PASS recovery command tenancy, immutable intent, lease reclaim, admitted UNKNOWN and tombstone');

  await runArch040PostgresContention({ sql, scalar, rejects, dbArgs });

  assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopHumanMessagingRestriction" WHERE "shopId"='s1'`), '0');
  sql(restrictionChange('s1','ACTIVE','SUSPENDED',1,'safety-hold','admin-040',true));
  const adminRace = await parallel([
    restrictionChange('s1','SUSPENDED','ACTIVE',2,'restored-one','admin-040'),
    restrictionChange('s1','SUSPENDED','ACTIVE',2,'restored-two','admin-040'),
  ]);
  assert.deepEqual(adminRace.map((r) => r.match(/(?:^|\n)([01])(?:\n|$)/)?.[1]).sort(),['0','1']);
  sql(restrictionChange('s1','ACTIVE','SUSPENDED',3,'repeat-suspend','admin-040'));
  assert.equal(scalar(`SELECT "revision" FROM "commerce"."ShopHumanMessagingRestriction" WHERE "shopId"='s1'`),'3');
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopHumanMessagingRestrictionEvent" WHERE "shopId"='s1'`),'3');
  rejects(`DELETE FROM "commerce"."ShopHumanMessagingRestriction" WHERE "shopId"='s1';`,'restriction restoration never deletes revision');
  rejects(`DELETE FROM "commerce"."ShopHumanMessagingRestrictionEvent" WHERE "shopId"='s1';`,'immutable platform audit');
  console.log('PASS default ACTIVE, admin CAS race, restore/resuspend and immutable events');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."Conversation" WHERE "checkoutRecoveryId"='r1'`),'1');
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."RecoveryOutreachAttempt" WHERE "checkoutRecoveryId"='r1' AND "sequence"=2`),'1');
  console.log('PASS ARCH-040-DATABASE-001 integrated PostgreSQL suite');
}
try { await main(); }
finally {
  if (running) {
    try { docker(['rm','-f',container]); }
    catch (e) { console.error('Disposable container removal failed:', e.message); }
  }
}
