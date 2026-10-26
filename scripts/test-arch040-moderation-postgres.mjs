import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// This harness creates and destroys ONLY its own isolated Docker database.
// It cannot accept DATABASE_URL or existing database connection arguments.
assert.deepEqual(process.argv.slice(2), ['--mode','fresh'], 'Run with --mode fresh only');
const image = 'pgvector/pgvector:pg17';
const container = `moda-arch040-moderation-${randomUUID()}`;
const database = 'arch040_moderation_fixture';
const tbl = '"whatsapp"."ConversationModerationAssessment"';
let started = false;
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-A','-t','-U','postgres','-d',database];
const sql = (text) => docker(psqlArgs, { input: text }).trim();
const scalar = (text) => sql(text).split('\n').at(-1)?.trim();
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
function rejected(name, statement) {
  try { sql(statement); } catch (error) {
    assert.match(String(error.stderr ?? ''), /ERROR:/, `${name}: expected PostgreSQL rejection`);
    return;
  }
  assert.fail(`${name}: PostgreSQL unexpectedly accepted invalid write`);
}
function assessment(id, { shop='s1', conversation='c1', subject='CUSTOMER_MESSAGE',
  message='msg-customer', command=null, content='Hello from customer', policy='moderation-v1',
  digest=sha(content), kind='TEXT', model='omni-moderation-latest' } = {}) {
  return `INSERT INTO ${tbl} ("id","shopId","conversationId","subject", "conversationMessageId",
    "merchantSendCommandId","contentSha256","inputKind","requestedModel","policyVersion","updatedAt")
    VALUES (${q(id)},${q(shop)},${q(conversation)},${q(subject)},${message===null?'NULL':q(message)},
      ${command===null?'NULL':q(command)},${q(digest)},${q(kind)},${q(model)},${q(policy)},now());`;
}
const claim = (id, token, expires = `now() + interval '1 minute'`) => `UPDATE ${tbl}
  SET "decision"='CHECKING',"attemptCount"="attemptCount"+1,
    "leaseToken"=${q(token)},"leaseExpiresAt"=${expires},"nextAttemptAt"=NULL,
    "assessedAt"=NULL,"returnedModel"=NULL,"flagged"=NULL,
    "categories"=NULL,"categoryScores"=NULL,"reasonCode"=NULL,"providerRequestId"=NULL,
    "updatedAt"=now()
  WHERE "id"=${q(id)} AND ("decision" IN ('PENDING','RETRYABLE_ERROR') OR
    ("decision"='CHECKING' AND "leaseExpiresAt"<=clock_timestamp()));`;
const complete = (id,token,decision,{model='omni-moderation-latest',flagged=false,
  categories='{"violence":false}', scores='{"violence":0.01}', reason=null,
  request='req-1',next=null} = {}) =>
  `SELECT "whatsapp".arch040_moderation_complete(${q(id)},${q(token)},'${decision}',
    ${model===null?'NULL':q(model)},${flagged===null?'NULL':flagged},
    ${categories===null?'NULL':`${q(categories)}::jsonb`},
    ${scores===null?'NULL':`${q(scores)}::jsonb`},${reason===null?'NULL':q(reason)},
    ${request===null?'NULL':q(request)},${next===null?'NULL':next});`;
function runParallel(statement) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker',psqlArgs,{stdio:['pipe','pipe','pipe']});
    let out='',err='';
    p.stdout.on('data',x=>{out+=x;});
    p.stderr.on('data',x=>{err+=x;});
    p.on('error', reject);
    p.on('close', code => code===0 ? resolve(out.trim()) : reject(new Error(err)));
    p.stdin.end(statement);
  });
}
async function main() {
  docker(['run','-d','--network','none','--name',container,
    '-e','POSTGRES_PASSWORD=arch040-fixture','-e',`POSTGRES_DB=${database}`,image]);
  started=true;
  let ready=false;
  for (let i=0;i<90;i++) {
    try {
      docker(['exec',container,'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',database]);
      ready=true; break;
    } catch { await sleep(1000); }
  }
  assert.ok(ready,'disposable PostgreSQL did not become ready');
  const base = new URL('../prisma/migrations/',import.meta.url);
  const migrations = readdirSync(base).filter(n=>/^\d{14}_/.test(n)).sort();
  const target='20261018030000_arch040_conversation_moderation_assessments';
  assert.ok(migrations.includes(target),'moderation migration missing');
  for(const name of migrations) {
    sql(readFileSync(new URL(`${name}/migration.sql`,base),'utf8'));
  }
  console.log(`PASS fresh migration chain (${migrations.length} migrations)`);
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
      ('s1','modtest-shop-one.example',now()),('s2','modtest-shop-two.example',now());
    INSERT INTO "public"."PlatformAdmin" ("id","email","updatedAt") VALUES
      ('admin1','modtest-admin@example.test',now()),('admin-inactive','modtest-inactive@example.test',now());
    UPDATE "public"."PlatformAdmin" SET "active"=false WHERE "id"='admin-inactive';
    INSERT INTO "commerce"."CheckoutRecovery"
      ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
      ('r1','s1','modtest-recovery-one',now(),now()),('r2','s2','modtest-recovery-two',now(),now());
    INSERT INTO "whatsapp"."Conversation"
      ("id","shopId","checkoutRecoveryId","type","updatedAt") VALUES
      ('c1',NULL,'r1','RECOVERY',now()),('c2',NULL,'r2','RECOVERY',now()),
      ('standalone1','s1',NULL,'PRODUCT_SUPPORT',now()),('standalone2','s2',NULL,'PRODUCT_SUPPORT',now());
    INSERT INTO "whatsapp"."ConversationMessage"
      ("id","conversationId","direction","senderType","content") VALUES
      ('msg-customer','c1','INBOUND','CUSTOMER','Hello from customer'),
      ('msg-agent','c1','OUTBOUND','AGENT','Agent reply'),
      ('msg-auto','c1','OUTBOUND','AUTOMATION','Automated message'),
      ('msg-foreign','c2','INBOUND','CUSTOMER','Foreign shop message'),
      ('msg-standalone','standalone1','INBOUND','CUSTOMER','Standalone inbound');
    INSERT INTO "whatsapp"."MerchantConversationSendCommand"
      ("id","shopId","conversationId","idempotencyKey","payloadSha256",
        "expectedControlRevision","kind","recipientSnapshot","textBody","updatedAt")
      VALUES ('cmd1','s1','c1','moderation-command-one',${q('a'.repeat(64))},0,
       'HUMAN_TEXT','447700900001','Merchant reply',now());`);
  sql(assessment('assess1'));
  const reused = scalar(`SELECT "whatsapp".arch040_moderation_create_or_reuse(
    'new-id-that-must-not-be-created','s1','c1','CUSTOMER_MESSAGE','msg-customer',NULL,
    ${q(sha('Hello from customer'))},'TEXT','omni-moderation-latest','moderation-v1');`);
  assert.equal(reused,'assess1','idempotent database API must return existing assessment');
  sql(assessment('assess-standalone',{conversation:'standalone1',message:'msg-standalone',content:'Standalone inbound'}));
  sql(assessment('assess-agent',{subject:'AGENT_MESSAGE',message:'msg-agent',content:'Agent reply'}));
  sql(assessment('assess-auto',{subject:'AUTOMATION_MESSAGE',message:'msg-auto',content:'Automated message'}));
  // ARCH-040-DATABASE-007: existing HUMAN_TEXT moderation fixtures must first
  // freeze the exact customer-visible body under the current command lease.
  // This command has no wrapper, so use an explicit PASSTHROUGH provenance.
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='CLAIMED',
    "leaseToken"='moderation-command-lease',
    "leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=1,
    "updatedAt"=now() WHERE "id"='cmd1';
    UPDATE "whatsapp"."MerchantConversationSendCommand"
    SET "preparedTextBody"='Merchant reply',
      "preparedWrapperEvidence"=${q(JSON.stringify({ schemaVersion:1,outcome:'PASSTHROUGH',
        reason:'NOT_CONFIGURED',bodySha256:sha('Merchant reply') }))}::jsonb,
      "preparedAt"=now(),"updatedAt"=now() WHERE "id"='cmd1';`);
  sql(assessment('assess-human',{subject:'HUMAN_COMMAND',message:null,command:'cmd1',content:'Merchant reply'}));
  assert.equal(scalar(`SELECT count(*) FROM ${tbl};`),'5');
  assert.equal(scalar(`SELECT "shopId" FROM ${tbl} WHERE "id"='assess1';`),'s1');
  rejected('subject FK exclusive', assessment('both',{command:'cmd1'}));
  rejected('missing subject FK',assessment('missing',{message:null}));
  rejected('subject/command mismatch',assessment('mismatched',{subject:'HUMAN_COMMAND'}));
  rejected('incorrect message direction',assessment('actor',{subject:'CUSTOMER_MESSAGE',message:'msg-agent',content:'Agent reply'}));
  rejected('foreign message',assessment('foreign',{message:'msg-foreign',content:'Foreign shop message'}));
  rejected('wrong shop on recovery with null conversation shopId', assessment('tenant',{shop:'s2'}));
  rejected('foreign conversation',assessment('foreign-conversation',{conversation:'c2'}));
  rejected('standalone cross-tenant',assessment('standalone-foreign',{shop:'s2',conversation:'standalone1',message:'msg-standalone',content:'Standalone inbound'}));
  rejected('HUMAN command cannot bind standalone', assessment('human-standalone',{conversation:'standalone1',subject:'HUMAN_COMMAND',message:null,command:'cmd1'}));
  rejected('non-hex digest',assessment('bad-digest',{digest:'Z'.repeat(64)}));
  rejected('invalid input kind',assessment('bad-kind',{kind:'IMAGE'}));
  rejected('digest does not match effective text',assessment('false-digest',{digest:'a'.repeat(64)}));
  rejected('text message cannot masquerade as transcript',assessment('false-transcript',{kind:'TRANSCRIPT'}));
  rejected('HUMAN text cannot be submitted as template params',assessment('false-command-kind',{subject:'HUMAN_COMMAND',message:null,command:'cmd1',kind:'TEMPLATE_PARAMETERS'}));
  // Template moderation MUST derive the digest from the authoritative,
  // immutable command fields. BG006 consumes the same SQL-produced UTF-8 text.
  sql(`INSERT INTO "commerce"."RecoveryOutreachAttempt"
    ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","updatedAt")
    VALUES ('a-template','r1','447700900001',2,'POST_WINDOW_FOLLOW_UP','NONE',now());
    INSERT INTO "whatsapp"."MerchantConversationSendCommand"
    ("id","shopId","conversationId","idempotencyKey","payloadSha256",
     "expectedControlRevision","kind","recipientSnapshot", "templateName",
     "templateLanguageCode","templateParameters","recoveryOutreachAttemptId","updatedAt")
    VALUES ('cmd-template','s1','c1','modtest-template-one',${q('b'.repeat(64))},0,
     'RECOVERY_FOLLOW_UP_TEMPLATE','447700900001','approved_follow_up','en_GB',
     '{"body":{"name":"Taylor","order":7},"header":["thanks","again"]}'::jsonb,
     'a-template',now());`);
  const templateSql = (params = `'{"body":{"name":"Taylor","order":7},"header":["thanks","again"]}'::jsonb`,
    name='approved_follow_up', lang='en_GB') =>
    `SELECT "whatsapp".arch040_moderation_template_input_v1(${q(name)},${q(lang)},${params});`;
  const canonicalTemplateText = scalar(templateSql());
  assert.match(canonicalTemplateText,/moda\.whatsapp\.template-parameters\.v1/);
  assert.equal(canonicalTemplateText,scalar(templateSql(
    `'{"header":["thanks","again"],"body":{"order":7,"name":"Taylor"}}'::jsonb`)),
    'JSONB object key order must not change the moderation input');
  assert.notEqual(canonicalTemplateText,scalar(templateSql(undefined,'other_follow_up')));
  assert.notEqual(canonicalTemplateText,scalar(templateSql(undefined,undefined,'fr')));
  assert.notEqual(canonicalTemplateText,scalar(templateSql(
    `'{"body":{"name":"Taylor","order":8},"header":["thanks","again"]}'::jsonb`)));
  assert.notEqual(scalar(templateSql('NULL::jsonb')),scalar(templateSql(`'null'::jsonb`)),
    'SQL NULL and JSON null parameter inputs must not collide');
  const templateDigest=sha(canonicalTemplateText);
  sql(assessment('assess-template',{subject:'HUMAN_COMMAND',message:null,
    command:'cmd-template',kind:'TEMPLATE_PARAMETERS',digest:templateDigest}));
  rejected('template digest cannot be caller chosen',assessment('tampered-template',{
    subject:'HUMAN_COMMAND',message:null,command:'cmd-template',kind:'TEMPLATE_PARAMETERS',
    digest:sha('invented renderer output')}));
  rejected('AGENT template digest has no authoritative persisted tuple', assessment(
    'unverifiable-agent-template',{subject:'AGENT_MESSAGE',message:'msg-agent',
      kind:'TEMPLATE_PARAMETERS',digest:sha('Agent reply')}));
  rejected('AUTOMATION template digest has no authoritative persisted tuple', assessment(
    'unverifiable-automation-template',{subject:'AUTOMATION_MESSAGE',message:'msg-auto',
      kind:'TEMPLATE_PARAMETERS',digest:sha('Automated message')}));
  assert.equal(scalar(`SELECT "whatsapp".arch040_moderation_create_or_reuse(
    'duplicate-template','s1','c1','HUMAN_COMMAND',NULL,'cmd-template',
    ${q(templateDigest)},'TEMPLATE_PARAMETERS','omni-moderation-latest','moderation-v1');`),
    'assess-template','same canonical template+policy+subject must reuse one assessment');
  console.log('PASS authoritative template rendering, digests, and fail-closed message parameters');
  rejected('no duplicate raw content column',`SELECT "rawText" FROM ${tbl};`);
  console.log('PASS actor, digest shape, recovery/standalone tenancy, metadata shape');

  const insertReused=(id,digest,policy='moderation-v1')=>`INSERT INTO ${tbl}
    ("id","shopId","conversationId","subject","conversationMessageId","contentSha256",
      "inputKind","requestedModel","policyVersion","updatedAt") VALUES
    (${q(id)},'s1','c1','CUSTOMER_MESSAGE','msg-customer',${q(digest)},
     'TEXT','omni-moderation-latest',${q(policy)},now())
    ON CONFLICT ("conversationMessageId","policyVersion","contentSha256") DO NOTHING RETURNING "id";`;
  // New subject not yet assessed: two insertions race for the same unique
  // (subject, policy, digest) identity and exactly one writer wins.
  sql(`INSERT INTO "whatsapp"."ConversationMessage"
    ("id","conversationId","direction","senderType","content")
    VALUES ('msg-race','c1','INBOUND','CUSTOMER','Concurrent inbound');`);
  const raceInsert = (id) => `INSERT INTO ${tbl}
    ("id","shopId","conversationId","subject","conversationMessageId","contentSha256",
      "inputKind","requestedModel","policyVersion","updatedAt")
    VALUES (${q(id)},'s1','c1','CUSTOMER_MESSAGE','msg-race',${q(sha('Concurrent inbound'))},
      'TEXT','omni-moderation-latest','moderation-v1',now())
    ON CONFLICT ("conversationMessageId","policyVersion","contentSha256") DO NOTHING
    RETURNING "id";`;
  const firstResult = await Promise.all([
    runParallel(raceInsert('duplicateA')),
    runParallel(raceInsert('duplicateB')),
  ]);
  assert.equal(firstResult.filter(Boolean).length,1,'exactly one concurrent insertion wins');
  assert.equal(scalar(`SELECT count(*) FROM ${tbl} WHERE "conversationMessageId"='msg-race';`),'1');
  // The original customer message retains its existing assessment.
  assert.equal(scalar(`SELECT count(*) FROM ${tbl} WHERE "conversationMessageId"='msg-customer' AND "policyVersion"='moderation-v1';`),'1');
  sql(`UPDATE "whatsapp"."ConversationMessage" SET "content"='changed effective text' WHERE "id"='msg-customer';`);
  sql(insertReused('changed-digest',sha('changed effective text')));
  sql(insertReused('changed-policy',sha('changed effective text'),'moderation-v2'));
  assert.equal(scalar(`SELECT count(*) FROM ${tbl} WHERE "conversationMessageId"='msg-customer';`),'3');
  rejected('immutable hash',`UPDATE ${tbl} SET "contentSha256"=${q(sha('other'))} WHERE "id"='assess1';`);
  rejected('immutable policy',`UPDATE ${tbl} SET "policyVersion"='moderation-v3' WHERE "id"='assess1';`);
  rejected('immutable origin',`UPDATE ${tbl} SET "subject"='AGENT_MESSAGE' WHERE "id"='assess1';`);
  rejected('assessed message direction immutable',`UPDATE "whatsapp"."ConversationMessage" SET "direction"='OUTBOUND' WHERE "id"='msg-customer';`);
  rejected('assessed recovery shop immutable',`UPDATE "commerce"."CheckoutRecovery" SET "shopId"='s2' WHERE "id"='r1';`);
  rejected('assessed standalone conversation shop immutable',`UPDATE "whatsapp"."Conversation" SET "shopId"='s2' WHERE "id"='standalone1';`);
  console.log('PASS concurrent dedupe, changed digest/policy, immutable binding');

  // Force *observed* PostgreSQL row-lock contention, rather than relying on
  // lucky scheduling. The losing writer must re-evaluate the PENDING predicate.
  const first = runParallel(`SET application_name='arch040_moderation_first';
    BEGIN; ${claim('assess1','lease-A')} SELECT pg_sleep(2); COMMIT; SELECT 'first';`);
  let firstHolding=false;
  for (let i=0;i<25;i++) {
    if (scalar(`SELECT count(*) FROM pg_stat_activity
      WHERE application_name='arch040_moderation_first' AND wait_event='PgSleep';`)==='1') {
      firstHolding=true;break;
    }
    await sleep(70);
  }
  assert.ok(firstHolding,'first claimant never held its PostgreSQL row lock');
  const second = runParallel(`SET application_name='arch040_moderation_contender';
    UPDATE ${tbl} SET "decision"='CHECKING',"attemptCount"=1,
      "leaseToken"='lease-B',"leaseExpiresAt"=now()+interval '1 minute',"updatedAt"=now()
    WHERE "id"='assess1' AND "decision"='PENDING' RETURNING "id";`);
  let blocked=false;
  for (let i=0;i<25;i++) {
    if (scalar(`SELECT count(*) FROM pg_stat_activity
      WHERE application_name='arch040_moderation_contender' AND wait_event_type='Lock';`)==='1') {
      blocked=true;break;
    }
    await sleep(70);
  }
  const both=await Promise.all([first,second]);
  assert.ok(blocked,'second claimant did not contend on the locked assessment');
  assert.match(both[0],/first/);
  assert.equal(both[1],'');
  assert.equal(scalar(`SELECT "leaseToken"||':'||"attemptCount" FROM ${tbl} WHERE "id"='assess1';`),'lease-A:1');
  rejected('cannot update result without lease',`UPDATE ${tbl} SET "decision"='ALLOW',"flagged"=false,
    "returnedModel"='omni-moderation-latest',"assessedAt"=now(),"leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE "id"='assess1';`);
  assert.equal(scalar(complete('assess1','stale-token','ALLOW')),'f');
  assert.equal(scalar(complete('assess1','lease-A','ALLOW')),'t');
  assert.equal(scalar(`SELECT "decision" FROM ${tbl} WHERE "id"='assess1';`),'ALLOW');
  // Specifically prove that an existing ALLOW for digest A cannot be
  // re-used after the linked content changes to digest B.
  sql(`INSERT INTO "whatsapp"."ConversationMessage"
    ("id","conversationId","direction","senderType","content")
    VALUES ('msg-previously-allowed','c1','INBOUND','CUSTOMER','Allowed original');`);
  sql(assessment('allowed-original',{message:'msg-previously-allowed',content:'Allowed original'}));
  sql(claim('allowed-original','lease-original'));
  assert.equal(scalar(complete('allowed-original','lease-original','ALLOW')),'t');
  assert.equal(scalar(`SELECT "decision" FROM ${tbl} WHERE "id"='allowed-original';`),'ALLOW');
  sql(`UPDATE "whatsapp"."ConversationMessage" SET "content"='Changed after approval'
    WHERE "id"='msg-previously-allowed';`);
  rejected('old ALLOW cannot be reused for changed content',
    `SELECT "whatsapp".arch040_moderation_create_or_reuse(
       'not-allowed-to-reuse','s1','c1','CUSTOMER_MESSAGE','msg-previously-allowed',NULL,
       ${q(sha('Allowed original'))},'TEXT','omni-moderation-latest','moderation-v1');`);
  const changedId=scalar(`SELECT "whatsapp".arch040_moderation_create_or_reuse(
    'fresh-unclassified','s1','c1','CUSTOMER_MESSAGE','msg-previously-allowed',NULL,
    ${q(sha('Changed after approval'))},'TEXT','omni-moderation-latest','moderation-v1');`);
  assert.equal(changedId,'fresh-unclassified');
  assert.equal(scalar(`SELECT "decision" FROM ${tbl} WHERE "id"='fresh-unclassified';`),'PENDING');
  assert.equal(scalar(`SELECT "decision" FROM ${tbl} WHERE "id"='allowed-original';`),'ALLOW',
    'prior ALLOW remains an immutable historical decision, not effective approval');
  console.log('PASS changed content cannot reuse a terminal ALLOW');

  rejected('terminal decision immutable',`UPDATE ${tbl} SET "decision"='BLOCK',"flagged"=true WHERE "id"='assess1';`);
  assert.equal(scalar(complete('assess1','lease-A','BLOCK')),'f');
  console.log('PASS competing claims, token-CAS classifier completion, terminal immutability');

  sql(claim('assess-agent','lease-expired',`now() + interval '150 milliseconds'`));
  await sleep(230);
  sql(claim('assess-agent','lease-new'));
  assert.equal(scalar(`SELECT "attemptCount" FROM ${tbl} WHERE "id"='assess-agent';`),'2');
  assert.equal(scalar(complete('assess-agent','lease-expired','ALLOW')),'f');
  // Both operations must run in the same PostgreSQL transaction. A separate
  // docker exec/psql startup can outlast a short retry delay, making a valid
  // due claim look like an incorrectly accepted premature claim.
  const retryBeforeDue = sql(`BEGIN;
    ${complete('assess-agent','lease-new','RETRYABLE_ERROR',{
      model:null,flagged:null,categories:null,scores:null,reason:'PROVIDER_TEMPORARY',
      request:null,next:`now() + interval '2 seconds'`})}
    DO $arch040_retry_before_due$
    DECLARE prematurely_rejected boolean := false;
    BEGIN
      BEGIN
        ${claim('assess-agent','too-early')}
      EXCEPTION WHEN SQLSTATE '23514' THEN
        prematurely_rejected := true;
      END;
      IF NOT prematurely_rejected THEN
        RAISE EXCEPTION 'moderation retry was claimed before nextAttemptAt';
      END IF;
    END
    $arch040_retry_before_due$;
    COMMIT;`);
  assert.equal(retryBeforeDue,'t','retry completion must persist before the claim check');
  assert.equal(scalar(`SELECT "decision"||':'||"attemptCount" FROM ${tbl}
    WHERE "id"='assess-agent';`),'RETRYABLE_ERROR:2',
    'premature claim must not consume another attempt or lease');
  await sleep(2200);
  sql(claim('assess-agent','lease-third'));
  assert.equal(scalar(complete('assess-agent','lease-third','BLOCK',{
    flagged:true,reason:'FLAGGED',request:'req-block'})),'t');
  assert.equal(scalar(`SELECT "decision"||':'||"attemptCount" FROM ${tbl} WHERE "id"='assess-agent';`),'BLOCK:3');
  sql(claim('assess-human','lease-human'));
  assert.equal(scalar(`SELECT "whatsapp".arch040_moderation_renew_lease('assess-human','incorrect',now()+interval '2 minutes');`),'f');
  assert.equal(scalar(`SELECT "whatsapp".arch040_moderation_renew_lease('assess-human','lease-human',now()+interval '2 minutes');`),'t');
  assert.equal(scalar(complete('assess-human','lease-human','REVIEW_REQUIRED',{
    flagged:true,reason:'NEEDS_CONTEXT'})),'t');
  rejected('unattributed review blocked',`UPDATE ${tbl} SET "reviewedAt"=now(),
    "reviewedByPlatformAdminId"='admin1',"reviewDisposition"='UPHELD' WHERE "id"='assess-human';`);
  rejected('partial review blocked',`UPDATE ${tbl} SET "reviewedAt"=now() WHERE "id"='assess-human';`);
  rejected('inactive platform reviewer', `SELECT "whatsapp".arch040_moderation_record_review('assess-human','admin-inactive','UPHELD');`);
  assert.equal(scalar(`SELECT "whatsapp".arch040_moderation_record_review('assess-human','admin1','UPHELD');`),'t');
  assert.equal(scalar(`SELECT "whatsapp".arch040_moderation_record_review('assess-human','admin1','REVERSED');`),'f');
  assert.equal(scalar(`SELECT "decision"||':'||"reviewDisposition" FROM ${tbl} WHERE "id"='assess-human';`),'REVIEW_REQUIRED:UPHELD');
  rejected('review cannot overwrite decision',`UPDATE ${tbl} SET "decision"='ALLOW' WHERE "id"='assess-human';`);
  assert.equal(scalar(`SELECT count(*) FROM ${tbl} WHERE "shopId"='s1' AND "decision"='REVIEW_REQUIRED'
    AND "reviewedAt" IS NOT NULL;`),'1');
  console.log('PASS lease expiry/reclaim, retry, REVIEW_REQUIRED and attributed one-time review');
  assert.equal(scalar(`SELECT count(*) FROM ${tbl} WHERE "shopId"='s2';`),'0');
  console.log('PASS ARCH-040-DATABASE-005 all PostgreSQL moderation checks');
}
try { await main(); } finally {
  if (started) {
    try { docker(['rm','-f',container]); } catch (error) { console.error('Disposable container cleanup failed:',error.message); }
  }
}
