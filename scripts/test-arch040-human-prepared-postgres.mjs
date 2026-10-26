import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// No database connection string or externally supplied endpoint is supported:
// each run owns a disposable, network-isolated Docker PostgreSQL instance.
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh','upgrade'].includes(args[1]),
  'Usage: node scripts/test-arch040-human-prepared-postgres.mjs --mode fresh|upgrade');
const mode = args[1];
const migrationId = '20261026080000_arch040_prepared_human_message_content';
const container = `moda-arch040-prepared-${randomUUID()}`;
const database = 'arch040_prepared';
const image = 'pgvector/pgvector:pg17';
const cmdTable = '"whatsapp"."MerchantConversationSendCommand"';
const assessmentTable = '"whatsapp"."ConversationModerationAssessment"';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
let started = false;
function docker(params, options = {}) {
  return execFileSync('docker', params, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}
const psql = ['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1',
  '-v','VERBOSITY=verbose','-A','-t','-U','postgres','-d',database];
function sql(source) { return docker(psql, { input: source }).trim(); }
function scalar(source) { return sql(source).split('\n').at(-1)?.trim(); }
function rejects(name, source, errorPattern = /23514:/) {
  try { sql(source); } catch (error) {
    assert.match(String(error.stderr ?? ''), errorPattern, `${name}: expected structural SQLSTATE`);
    return;
  }
  assert.fail(`${name}: PostgreSQL unexpectedly accepted invalid write`);
}
function command(id, { shop='s1', conversation='c1', kind='HUMAN_TEXT', body='Merchant original',
  revision=0, attempt='a-template', key=id } = {}) {
  const isText = kind === 'HUMAN_TEXT';
  return `INSERT INTO ${cmdTable} ("id","shopId","conversationId","idempotencyKey",
      "payloadSha256","expectedControlRevision","kind","recipientSnapshot",
      "textBody","templateName","templateLanguageCode","templateParameters",
      "recoveryOutreachAttemptId","updatedAt") VALUES (
      ${quote(id)},${quote(shop)},${quote(conversation)},${quote(key)},${quote(sha(body))},
      ${revision},${quote(kind)},'447700900001',${isText?quote(body):'NULL'},
      ${isText?'NULL':"'approved_follow_up'"},${isText?'NULL':"'en_GB'"},
      ${isText?'NULL':"'{\"body\":[{\"name\":\"Taylor\"}]}'::jsonb"},
      ${isText?'NULL':quote(attempt)},now());`;
}
function claim(id, token, expires="now() + interval '5 minutes'") {
  return `UPDATE ${cmdTable} SET "state"='CLAIMED',"leaseToken"=${quote(token)},
    "leaseExpiresAt"=${expires},"dispatchAttemptCount"="dispatchAttemptCount"+1,
    "updatedAt"=now() WHERE "id"=${quote(id)};`;
}
function prepared(id, body, evidence = { schemaVersion:1, outcome:'RENDERED', bodySha256:sha(body) }) {
  return `UPDATE ${cmdTable} SET "preparedTextBody"=${quote(body)},
    "preparedWrapperEvidence"=${quote(JSON.stringify(evidence))}::jsonb,
    "preparedAt"=now(),"updatedAt"=now() WHERE "id"=${quote(id)};`;
}
function moderation(id, { subject='HUMAN_COMMAND', kind='TEXT', commandId=null,
  messageId=null, body='', digest=sha(body), policy='moderation-v1', conversation='c1',shop='s1' } = {}) {
  return `INSERT INTO ${assessmentTable} ("id","shopId","conversationId","subject",
      "conversationMessageId","merchantSendCommandId","contentSha256","inputKind",
      "requestedModel","policyVersion","updatedAt") VALUES
      (${quote(id)},${quote(shop)},${quote(conversation)},${quote(subject)},
      ${messageId===null?'NULL':quote(messageId)},${commandId===null?'NULL':quote(commandId)},
      ${quote(digest)},${quote(kind)},'omni-moderation-latest',${quote(policy)},now());`;
}
function seed() {
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
    ('s1','prepared-one.example',now()),('s2','prepared-two.example',now());
    INSERT INTO "commerce"."CheckoutRecovery"
      ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
      ('r1','s1','prepared-recovery-one',now(),now()),
      ('r2','s2','prepared-recovery-two',now(),now());
    INSERT INTO "whatsapp"."Conversation"
      ("id","shopId","checkoutRecoveryId","type","updatedAt") VALUES
      ('c1',NULL,'r1','RECOVERY',now()),('c2',NULL,'r2','RECOVERY',now());
    INSERT INTO "commerce"."RecoveryOutreachAttempt"
      ("id","checkoutRecoveryId","recipient","sequence","trigger",
       "configuredOfferMode","updatedAt") VALUES
      ('a-template','r1','447700900001',2,'POST_WINDOW_FOLLOW_UP','NONE',now());
    INSERT INTO "whatsapp"."ConversationMessage"
      ("id","conversationId","direction","senderType","content") VALUES
      ('msg-customer','c1','INBOUND','CUSTOMER','Customer text'),
      ('msg-agent','c1','OUTBOUND','AGENT','Agent text'),
      ('msg-auto','c1','OUTBOUND','AUTOMATION','Automation text'),
      ('msg-human','c1','OUTBOUND','HUMAN','Outbound HUMAN'),
      ('msg-foreign','c2','INBOUND','CUSTOMER','Wrong tenant');`);
}
function transitionHuman() {
  sql(`BEGIN;
    UPDATE "whatsapp"."Conversation" SET "controlMode"='HUMAN',
      "controlRevision"=1,"controlChangedAt"=clock_timestamp(),"updatedAt"=now()
      WHERE "id"='c1';
    INSERT INTO "whatsapp"."ConversationControlEvent"
      ("id","conversationId","fromMode","toMode","fromRevision","toRevision")
      VALUES ('control-c1','c1','AI','HUMAN',0,1);
    COMMIT;`);
}
function permit(id, messageId='msg-human', key=`provider-${id}`) {
  sql(`UPDATE "whatsapp"."ConversationMessage"
    SET "providerDispatchKey"=${quote(key)},"providerDispatchAdmittedAt"=now(),
    "providerDispatchControlRevision"=1 WHERE "id"=${quote(messageId)};`);
  sql(`UPDATE ${cmdTable} SET "state"='DISPATCH_ADMITTED',
    "providerDispatchKey"=${quote(key)},"providerDispatchAdmittedAt"=now(),
    "providerDispatchControlRevision"=1,"providerDispatchRestrictionRevision"=0,
    "outboundMessageId"=${quote(messageId)},"leaseToken"=NULL,
    "leaseExpiresAt"=NULL,"updatedAt"=now() WHERE "id"=${quote(id)};`);
}
function checkColumns() {
  const result = sql(`SELECT column_name||':'||data_type||':'||is_nullable||':'||
    coalesce(datetime_precision::text,'-')||':'||coalesce(column_default,'none')
    FROM information_schema.columns WHERE table_schema='whatsapp'
    AND table_name='MerchantConversationSendCommand'
    AND column_name IN ('preparedTextBody','preparedWrapperEvidence','preparedAt')
    ORDER BY column_name;`);
  assert.deepEqual(result.split('\n'), [
    'preparedAt:timestamp with time zone:YES:3:none',
    'preparedTextBody:text:YES:-:none',
    'preparedWrapperEvidence:jsonb:YES:-:none',
  ]);
  assert.equal(scalar(`SELECT count(*) FROM pg_trigger WHERE tgrelid=${quote(cmdTable)}::regclass
    AND tgname='arch040_command_guard' AND NOT tgisinternal;`), '1');
  assert.equal(scalar(`SELECT count(*) FROM pg_trigger WHERE tgrelid=${quote(assessmentTable)}::regclass
    AND tgname='arch040_moderation_subject_guard' AND NOT tgisinternal;`), '1');
}
function testPrepared() {
  rejects('prepared tuple forbidden on INSERT', `INSERT INTO ${cmdTable} (
    "id","shopId","conversationId","idempotencyKey","payloadSha256",
    "expectedControlRevision","kind","recipientSnapshot","textBody",
    "preparedTextBody","preparedWrapperEvidence","preparedAt","updatedAt") VALUES
    ('insert-prepared','s1','c1','insert-prepared',${quote(sha('raw'))},0,'HUMAN_TEXT',
     '447700900001','raw','rendered','{}'::jsonb,now(),now());`, /23514: ARCH040 new command/);
  sql(command('human-main'));
  assert.equal(scalar(`SELECT ("preparedTextBody" IS NULL AND "preparedWrapperEvidence" IS NULL AND
      "preparedAt" IS NULL)::text FROM ${cmdTable} WHERE "id"='human-main';`), 'true');
  rejects('cannot freeze before claim',prepared('human-main','Wrapped: Merchant original'),
    /23514: ARCH040 prepared HUMAN content requires/);
  rejects('cannot moderate raw intent', moderation('before-freeze',{
    commandId:'human-main',body:'Merchant original',policy:'pre-freeze'}),
    /23514: ARCH040 moderation HUMAN text requires/);
  sql(claim('human-main','lease-main'));
  rejects('wrong lease cannot freeze',prepared('human-main','Wrong token').replace(
    '"updatedAt"=now()', '"leaseToken"=\'wrong-token\',"updatedAt"=now()'), /23514:/);
  rejects('partial body cannot freeze',`UPDATE ${cmdTable} SET "preparedTextBody"='partial'
    WHERE "id"='human-main';`, /23514: ARCH040 prepared HUMAN content requires/);
  rejects('partial evidence cannot freeze',`UPDATE ${cmdTable} SET "preparedWrapperEvidence"='{}'::jsonb
    WHERE "id"='human-main';`, /23514: ARCH040 prepared HUMAN content requires/);
  rejects('partial timestamp cannot freeze',`UPDATE ${cmdTable} SET "preparedAt"=now()
    WHERE "id"='human-main';`, /23514: ARCH040 prepared HUMAN content requires/);
  rejects('blank text cannot freeze',prepared('human-main',' \t\n '),
    /23514: ARCH040 prepared HUMAN content requires/);
  rejects('cannot slip permit into freeze',prepared('human-main','Injected permit').replace(
    '"updatedAt"=now()', `"providerDispatchKey"='fake',"updatedAt"=now()`), /23514:/);
  const wrapped = 'Hello 👋\nMerchant original\nModa-approved footer';
  sql(prepared('human-main',wrapped));
  assert.equal(sql(`SELECT "preparedTextBody" FROM ${cmdTable} WHERE "id"='human-main';`), wrapped);
  assert.equal(scalar(`SELECT "textBody"||':'||"payloadSha256"||':'||"idempotencyKey"
     FROM ${cmdTable} WHERE "id"='human-main';`),
    `Merchant original:${sha('Merchant original')}:human-main`);
  rejects('raw digest must not pass', moderation('raw-digest',{
    commandId:'human-main',body:'Merchant original'}), /23514: ARCH040 moderation HUMAN text digest mismatch/);
  sql(moderation('wrapped-digest',{commandId:'human-main',body:wrapped}));
  rejects('cannot change body',`UPDATE ${cmdTable} SET "preparedTextBody"='another' WHERE "id"='human-main';`,
    /23514: ARCH040 prepared HUMAN content is immutable/);
  rejects('cannot clear evidence',`UPDATE ${cmdTable} SET "preparedWrapperEvidence"=NULL WHERE "id"='human-main';`,
    /23514: ARCH040 prepared HUMAN content is immutable/);
  rejects('cannot change timestamp',`UPDATE ${cmdTable} SET "preparedAt"=now()+interval '1 minute'
    WHERE "id"='human-main';`, /23514: ARCH040 prepared HUMAN content is immutable/);
  rejects('original merchant text immutable',`UPDATE ${cmdTable} SET "textBody"='altered'
    WHERE "id"='human-main';`, /23514: ARCH040 accepted command identity/);
  rejects('original digest immutable',`UPDATE ${cmdTable} SET "payloadSha256"=${quote(sha('other'))}
    WHERE "id"='human-main';`, /23514: ARCH040 accepted command identity/);
  rejects('idempotency key immutable',`UPDATE ${cmdTable} SET "idempotencyKey"='other'
    WHERE "id"='human-main';`, /23514: ARCH040 accepted command identity/);
  rejects('cannot steal active lease',`UPDATE ${cmdTable} SET "leaseToken"='stolen',
    "dispatchAttemptCount"=2 WHERE "id"='human-main';`, /23514: ARCH040 cannot steal active lease/);
  // A new retry claim must not re-render or change frozen content.
  sql(`UPDATE ${cmdTable} SET "state"='FAILED',"failureCode"='TRANSIENT',
    "leaseToken"=NULL,"leaseExpiresAt"=NULL WHERE "id"='human-main';`);
  sql(claim('human-main','lease-retry'));
  assert.equal(sql(`SELECT "preparedTextBody" FROM ${cmdTable} WHERE "id"='human-main';`),wrapped);
  rejects('retry cannot change prepared body',prepared('human-main','retry body'),
    /23514: ARCH040 prepared HUMAN content is immutable/);
  // Passthrough still has a durable prepared tuple, then uses identical moderation.
  sql(command('passthrough',{body:'No wrapper required'}));
  sql(claim('passthrough','lease-pass'));
  sql(prepared('passthrough','No wrapper required',{
    schemaVersion:1,outcome:'PASSTHROUGH',reason:'NOT_CONFIGURED',bodySha256:sha('No wrapper required') }));
  sql(moderation('passthrough-moderation',{commandId:'passthrough',body:'No wrapper required'}));
  sql(command('template',{kind:'RECOVERY_FOLLOW_UP_TEMPLATE'}));
  rejects('foreign recovery ownership',command('foreign',{shop:'s2'}),
    /23514: ARCH040 command requires recovery owned by shop/);
  sql(claim('template','lease-template'));
  rejects('cannot prepare post-window template',prepared('template','wrong body'),
    /23514: ARCH040 prepared HUMAN content requires/);
  const templateInput = scalar(`SELECT "whatsapp".arch040_moderation_template_input_v1(
    "templateName","templateLanguageCode","templateParameters")
    FROM ${cmdTable} WHERE "id"='template';`);
  const templateDigest = sha(templateInput);
  assert.equal(scalar(`SELECT encode(sha256(convert_to(
    "whatsapp".arch040_moderation_template_input_v1(
      "templateName","templateLanguageCode","templateParameters"),'UTF8')),'hex')
    FROM ${cmdTable} WHERE "id"='template';`),templateDigest);
  rejects('template must use canonical parameter digest',moderation('template-wrong',{
    commandId:'template',kind:'TEMPLATE_PARAMETERS',body:'approved_follow_up'}),
    /23514: ARCH040 moderation HUMAN template digest mismatch/);
  sql(moderation('template-canonical',{
    commandId:'template',kind:'TEMPLATE_PARAMETERS',digest:templateDigest}));
  rejects('template cannot be moderated as TEXT',moderation('template-text',{
    commandId:'template',kind:'TEXT',digest:templateDigest}), /23514: ARCH040 moderation command subject/);
  rejects('human cannot be moderated as TEMPLATE_PARAMETERS',moderation('human-template',{
    commandId:'human-main',kind:'TEMPLATE_PARAMETERS',digest:templateDigest}), /23514: ARCH040 moderation command subject/);
  for (const [subject,messageId,body] of [
    ['CUSTOMER_MESSAGE','msg-customer','Customer text'],
    ['AGENT_MESSAGE','msg-agent','Agent text'],
    ['AUTOMATION_MESSAGE','msg-auto','Automation text'],
  ]) sql(moderation(`assessment-${subject}`,{ subject,messageId,body }));
  rejects('cross-tenant moderation',moderation('tenant-wrong',{
    commandId:'human-main',body:wrapped,shop:'s2'}), /23514: ARCH040 moderation tenant mismatch/);
  rejects('wrong message actor',moderation('actor-wrong',{
    subject:'CUSTOMER_MESSAGE',messageId:'msg-agent',body:'Agent text'}), /23514: ARCH040 moderation message actor/);
  console.log('PASS exact frozen body, moderation digests, templates, nonhuman actors, lease and tenant checks');
}
function testPrePermitAndTerminal() {
  sql(command('expired'));
  sql(claim('expired','lease-expired',"now() + interval '250 milliseconds'"));
  sql(`SELECT pg_sleep(0.40);`);
  rejects('expired lease cannot freeze',prepared('expired','too late'),
    /23514: ARCH040 prepared HUMAN content requires/);
  sql(command('cancelled'));
  sql(`UPDATE ${cmdTable} SET "state"='CANCELLED',"completedAt"=now()
    WHERE "id"='cancelled';`);
  rejects('terminal command cannot be prepared',prepared('cancelled','late'),
    /23514: ARCH040 prepared HUMAN content requires/);
  rejects('terminal command cannot reopen',`UPDATE ${cmdTable} SET "state"='CLAIMED',
    "leaseToken"='restart',"leaseExpiresAt"=now()+interval '1 minute',
    "dispatchAttemptCount"=1 WHERE "id"='cancelled';`, /23514: ARCH040 terminal command/);
  transitionHuman();
  sql(command('permitted',{revision:1}));
  sql(claim('permitted','lease-permit'));
  sql(prepared('permitted','Approved human text'));
  permit('permitted');
  sql(`UPDATE ${cmdTable} SET "state"='UNKNOWN' WHERE "id"='permitted';`);
  rejects('provider key cannot diverge from the linked message',`UPDATE ${cmdTable} SET
    "providerDispatchKey"='another' WHERE "id"='permitted';`,
    /23514: ARCH040 command and message provider dispatch mismatch/);
  rejects('one-way provider permit timestamp cannot be rewritten',`UPDATE ${cmdTable} SET
    "providerDispatchAdmittedAt"="providerDispatchAdmittedAt" + interval '1 second'
    WHERE "id"='permitted';`, /23514: ARCH040 one-way provider permit immutable/);
  rejects('post-provider preparation cannot change',prepared('permitted','resend wrapped'),
    /23514: ARCH040 prepared HUMAN content is immutable/);
  rejects('provider-admitted command cannot reopen',`UPDATE ${cmdTable} SET "state"='CLAIMED',
    "leaseToken"='resend',"leaseExpiresAt"=now()+interval '1 minute'
    WHERE "id"='permitted';`, /23514: ARCH040 admitted command cannot be resent/);
  console.log('PASS expired lease, terminal tombstone and provider permit irreversibility');
}
async function testConcurrentFreeze() {
  sql(command('concurrent-freeze'));
  sql(claim('concurrent-freeze','lease-concurrent'));
  function worker(body) {
    return new Promise((resolve, reject) => {
      const child = spawn('docker',psql,{stdio:['pipe','pipe','pipe']});
      let stderr='';
      child.stderr.on('data',value=>{ stderr+=String(value); });
      child.on('error',reject);
      child.on('close',code=>resolve({code,stderr}));
      child.stdin.end(prepared('concurrent-freeze',body));
    });
  }
  const results = await Promise.all([worker('First wrapped body'),worker('Second wrapped body')]);
  assert.equal(results.filter(result=>result.code===0).length,1,
    'Exactly one concurrent freeze should commit');
  const rejectedAttempt=results.find(result=>result.code!==0);
  assert.match(rejectedAttempt.stderr,/23514: ARCH040 prepared HUMAN content is immutable/);
  const winner=scalar(`SELECT "preparedTextBody" FROM ${cmdTable} WHERE "id"='concurrent-freeze';`);
  assert.ok(['First wrapped body','Second wrapped body'].includes(winner));
  const storedEvidence=scalar(`SELECT "preparedWrapperEvidence"->>'bodySha256'
    FROM ${cmdTable} WHERE "id"='concurrent-freeze';`);
  assert.equal(storedEvidence,sha(winner),'The winning body and provenance must be atomic');
  console.log('PASS concurrent first writer wins; second writer receives SQLSTATE 23514');
}
function upgradeFixture() {
  // All rows and prior moderation assessments exist BEFORE the new columns.
  sql(command('legacy-human',{body:'Historical raw text'}));
  sql(moderation('legacy-assessment',{commandId:'legacy-human',body:'Historical raw text'}));
  sql(command('legacy-cancelled'));
  sql(`UPDATE ${cmdTable} SET "state"='CANCELLED',"completedAt"=now()
    WHERE "id"='legacy-cancelled';`);
  sql(command('legacy-pending'));
  // Previously admitted commands can stay in UNKNOWN with a provider key.
  transitionHuman();
  sql(command('legacy-unknown',{revision:1}));
  sql(claim('legacy-unknown','legacy-lease'));
  permit('legacy-unknown');
  sql(`UPDATE ${cmdTable} SET "state"='UNKNOWN' WHERE "id"='legacy-unknown';`);
  return scalar(`SELECT md5(row_to_json(a)::text) FROM ${assessmentTable} a
    WHERE "id"='legacy-assessment';`);
}
function checkUpgrade(previousFingerprint) {
  checkColumns();
  assert.equal(scalar(`SELECT count(*) FROM ${cmdTable} WHERE "id" LIKE 'legacy-%'
    AND "preparedTextBody" IS NULL AND "preparedWrapperEvidence" IS NULL AND "preparedAt" IS NULL;`),'4',
    'No auto-backfill, including previously permitted and terminal commands');
  assert.equal(scalar(`SELECT md5(row_to_json(a)::text) FROM ${assessmentTable} a
    WHERE "id"='legacy-assessment';`),previousFingerprint,
    'Historical moderation evidence must be unchanged');
  assert.equal(scalar(`SELECT "textBody"||':'||"payloadSha256"||':'||"idempotencyKey"
    FROM ${cmdTable} WHERE "id"='legacy-human';`),
    `Historical raw text:${sha('Historical raw text')}:legacy-human`);
  assert.equal(scalar(`SELECT "providerDispatchKey" FROM ${cmdTable}
    WHERE "id"='legacy-unknown';`),'provider-legacy-unknown');
  rejects('post-upgrade new assessment of unprepared historical text', moderation('legacy-new-assessment',{
    commandId:'legacy-human',body:'Historical raw text',policy:'moderation-v2'}),
    /23514: ARCH040 moderation HUMAN text requires/);
  rejects('cannot newly prepare admitted UNKNOWN',prepared('legacy-unknown','late'),
    /23514: ARCH040 prepared HUMAN content requires/);
  rejects('cannot newly prepare terminal CANCELLED',prepared('legacy-cancelled','late'),
    /23514: ARCH040 prepared HUMAN content requires/);
  // Existing pending human intent is prepared only when next valid claim occurs.
  rejects('unclaimed pending historical command',prepared('legacy-pending','prepared'),
    /23514: ARCH040 prepared HUMAN content requires/);
  sql(claim('legacy-pending','lease-upgrade'));
  sql(prepared('legacy-pending','New prepared body'));
  sql(moderation('legacy-prepared-assessment',{
    commandId:'legacy-pending',body:'New prepared body',policy:'moderation-v2'}));
  console.log('PASS migration upgrade preserves historical assessment, provider/terminal and pending intent');
}
function migrate(names) {
  const root = new URL('../prisma/migrations/', import.meta.url);
  for (const name of names) sql(readFileSync(new URL(`${name}/migration.sql`,root),'utf8'));
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
  assert.ok(ready,'Disposable PostgreSQL did not become ready');
  const version=scalar('SHOW server_version;');
  console.log(`PostgreSQL ${version} in isolated ${mode} fixture`);
  const migrations=readdirSync(new URL('../prisma/migrations/',import.meta.url))
    .filter(n=>/^\d{14}_/.test(n)).sort();
  assert.equal(migrations.at(-1), migrationId);
  if(mode==='fresh') {
    migrate(migrations);
    checkColumns();
    seed();
    testPrepared();
    testPrePermitAndTerminal();
    await testConcurrentFreeze();
  } else {
    migrate(migrations.filter(name=>name!==migrationId));
    seed();
    const fingerprint=upgradeFixture();
    migrate([migrationId]);
    checkUpgrade(fingerprint);
    // The upgraded schema still accepts a new complete freeze and digest.
    sql(command('new-after-upgrade'));
    sql(claim('new-after-upgrade','lease-new'));
    sql(prepared('new-after-upgrade','Post-upgrade wrapped text'));
    sql(moderation('new-after-upgrade-assessment',{
      commandId:'new-after-upgrade',body:'Post-upgrade wrapped text'}));
  }
  console.log(`PASS ARCH-040-DATABASE-007 ${mode} PostgreSQL migration and behavioural checks`);
}
try { await main(); } finally {
  if(started) {
    try { docker(['rm','-f',container]); } catch { /* Cleanup best effort */ }
  }
}
