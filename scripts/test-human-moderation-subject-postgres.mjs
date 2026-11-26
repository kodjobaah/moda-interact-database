import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]),
  'Usage: node scripts/test-human-moderation-subject-postgres.mjs --mode fresh|upgrade');
const mode = args[1];
const target = '20261126140000_human_moderation_subject_guard';
const root = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-human-moderation-${randomUUID()}`;
const db = 'human_moderation_fixture';
const commandTable = 'whatsapp."MerchantConversationSendCommand"';
const assessmentTable = 'whatsapp."ConversationModerationAssessment"';
const hash = body => createHash('sha256').update(body, 'utf8').digest('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const raw = 'Merchant original';
const frozen = 'Shop: Merchant original';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
});
// Always use a dedicated container, never DATABASE_URL or an external host.
const sql = statement => docker(['exec', '-i', '-e', 'PGPASSWORD=fixture-only', '-e', 'PGCONNECT_TIMEOUT=2',
  container, 'psql', '-X', '-qAt', '-w', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', db], {
  input: statement, stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
function reject(statement, reason) {
  assert.throws(() => sql(statement), error => /23514:/.test(String(error.stderr)) &&
    String(error.stderr).includes(reason), reason);
}
function migrate(name) {
  sql(readFileSync(new URL(`${name}/migration.sql`, root), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function command(id, template = false) {
  sql(`INSERT INTO ${commandTable} ("id","shopId","conversationId","idempotencyKey","followUpClaimKey",
    "payloadSha256","expectedControlRevision","kind","recipientSnapshot","textBody","templateName",
    "templateLanguageCode","templateParameters","recoveryOutreachAttemptId","updatedAt") VALUES
    (${q(id)},'s1','c1',${q(id)},${template ? q(id) : 'NULL'},${q(hash(raw))},0,
    ${q(template ? 'RECOVERY_FOLLOW_UP_TEMPLATE' : 'HUMAN_TEXT')},'447700900001',
    ${template ? "NULL,'approved_follow_up','en_GB','{\"body\":[{\"name\":\"Taylor\"}]}'::jsonb,'attempt'" : `${q(raw)},NULL,NULL,NULL,NULL`},now());`);
}
function freeze(id) {
  sql(`UPDATE ${commandTable} SET "state"='CLAIMED',"leaseToken"='claim',
    "leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=1 WHERE "id"=${q(id)};`);
  sql(`UPDATE ${commandTable} SET "preparedTextBody"=${q(frozen)},"preparedAt"=now(),
    "preparedWrapperEvidence"=${q(JSON.stringify({ schemaVersion: 1, outcome: 'RENDERED', bodySha256: hash(frozen) }))}::jsonb
    WHERE "id"=${q(id)};`);
}
function assessment(id, { commandId = 'main', messageId = null, subject = 'HUMAN_COMMAND',
  digest = hash(frozen), kind = 'TEXT', shop = 's1', conversation = 'c1' } = {}) {
  return `SELECT whatsapp.arch040_moderation_create_or_reuse(${q(id)},${q(shop)},${q(conversation)},
    ${q(subject)},${messageId === null ? 'NULL' : q(messageId)},${commandId === null ? 'NULL' : q(commandId)},
    ${q(digest)},${q(kind)},'omni-moderation-latest','fixture-v1');`;
}
function seed() {
  sql(`INSERT INTO commerce."Shop" ("id","domain","updatedAt") VALUES
    ('s1','moderation-one.invalid',now()),('s2','moderation-two.invalid',now());
    INSERT INTO commerce."CheckoutRecovery" ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
    ('r1','s1','checkout-one',now(),now()),('r2','s2','checkout-two',now(),now());
    INSERT INTO whatsapp."Conversation" ("id","checkoutRecoveryId","type","updatedAt") VALUES
    ('c1','r1','RECOVERY',now()),('c2','r2','RECOVERY',now());
    INSERT INTO commerce."RecoveryOutreachAttempt" ("id","checkoutRecoveryId","sequence","trigger","recipient","configuredOfferMode","updatedAt") VALUES
    ('attempt','r1',2,'POST_WINDOW_FOLLOW_UP','447700900001','NONE',now());
    INSERT INTO whatsapp."ConversationMessage" ("id","conversationId","direction","senderType","content") VALUES
    ('customer','c1','INBOUND','CUSTOMER','Customer text'),('agent','c1','OUTBOUND','AGENT','Agent text'),
    ('automation','c1','OUTBOUND','AUTOMATION','Automation text');`);
  command('main'); freeze('main'); command('unprepared'); command('template', true);
}
function complete(id) {
  sql(`UPDATE ${assessmentTable} SET "decision"='CHECKING',"attemptCount"=1,
    "leaseToken"='moderation-lease',"leaseExpiresAt"=now()+interval '5 minutes' WHERE "id"=${q(id)};`);
  assert.equal(sql(`SELECT whatsapp.arch040_moderation_complete(${q(id)},'wrong','ALLOW',
    'omni-moderation-latest',false,'{}','{}',NULL,NULL,NULL);`), 'f');
  assert.equal(sql(`SELECT whatsapp.arch040_moderation_complete(${q(id)},'moderation-lease','ALLOW',
    'omni-moderation-latest',false,'{}','{}',NULL,NULL,NULL);`), 't');
}
function preservedFunctions() {
  return sql(`SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname, p.oid)::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='whatsapp'
    AND p.proname IN ('arch040_command_guard','arch040_moderation_guard','arch040_moderation_parent_guard',
    'arch040_moderation_create_or_reuse','arch040_moderation_complete','arch076_r15_clause_subject',
    'arch076_r15_audio_freeze_guard','arch040_moderation_template_input_v1');`);
}
function rowSnapshot() {
  return sql(`SELECT jsonb_build_array(
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM ${commandTable} c),
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM ${assessmentTable} a))::text;`);
}
function verify() {
  assert.equal(sql(assessment('prepared-assessment')), 'prepared-assessment');
  assert.equal(sql(assessment('duplicate')), 'prepared-assessment');
  complete('prepared-assessment');
  assert.equal(sql(`SELECT "decision" FROM ${assessmentTable} WHERE id='prepared-assessment'`), 'ALLOW');
  // The database no longer compares HUMAN_TEXT digests; a distinct digest is
  // only a PENDING record, not permission to send. Background must select the
  // actual frozen body's digest and check ALLOW at dispatch.
  assert.equal(sql(assessment('other-content', { digest: hash('Different content') })), 'other-content');
  assert.equal(sql(`SELECT "decision" FROM ${assessmentTable} WHERE id='other-content'`), 'PENDING');
  reject(`UPDATE ${assessmentTable} SET "decision"='ALLOW',"attemptCount"=1,"assessedAt"=now(),
    "returnedModel"='omni-moderation-latest',"flagged"=false WHERE id='other-content'`, 'moderation invalid classifier transition');
  reject(assessment('unprepared-assessment', { commandId: 'unprepared', digest: hash(raw) }), 'HUMAN text requires frozen prepared content');
  reject(assessment('wrong-tenant', { shop: 's2' }), 'moderation tenant mismatch');
  reject(assessment('wrong-command', { shop: 's2', conversation: 'c2' }), 'moderation command subject/input mismatch');
  reject(assessment('wrong-kind', { kind: 'TEMPLATE_PARAMETERS' }), 'moderation command subject/input mismatch');
  reject(`UPDATE ${commandTable} SET "preparedTextBody"='Changed' WHERE id='main'`, 'prepared HUMAN content is immutable');
  reject(`UPDATE ${assessmentTable} SET "contentSha256"=${q(hash('Changed'))} WHERE id='prepared-assessment'`, 'moderation subject/content/policy identity immutable');
  reject(assessment('bad-template', { commandId: 'template', kind: 'TEMPLATE_PARAMETERS' }), 'moderation HUMAN template digest mismatch');
  const templateDigest = sql(`SELECT encode(sha256(convert_to(whatsapp.arch040_moderation_template_input_v1(
    "templateName","templateLanguageCode","templateParameters"),'UTF8')),'hex') FROM ${commandTable} WHERE id='template'`);
  assert.equal(sql(assessment('good-template', { commandId: 'template', kind: 'TEMPLATE_PARAMETERS', digest: templateDigest })), 'good-template');
  for (const [messageId, subject, content] of [['customer','CUSTOMER_MESSAGE','Customer text'],
    ['agent','AGENT_MESSAGE','Agent text'],['automation','AUTOMATION_MESSAGE','Automation text']]) {
    reject(assessment(`bad-${messageId}`, { commandId: null, messageId, subject, digest: hash('Wrong content') }), 'moderation message text digest mismatch');
    assert.equal(sql(assessment(`good-${messageId}`, { commandId: null, messageId, subject, digest: hash(content) })), `good-${messageId}`);
  }
  reject(assessment('wrong-actor', { commandId: null, messageId: 'agent', subject: 'CUSTOMER_MESSAGE', digest: hash('Agent text') }), 'moderation message actor/direction/input mismatch');
  console.log('PASS prepared HUMAN text, moderation lease, immutable content, tenant, template and nonhuman digest guards');
}
let started = false;
try {
  docker(['run', '-d', '--network', 'none', '--name', container, '-e', 'POSTGRES_PASSWORD=fixture-only',
    '-e', `POSTGRES_DB=${db}`, 'pgvector/pgvector:pg17']);
  started = true;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { if (sql('SELECT 1') === '1') { ready = true; break; } } catch { /* startup probe */ }
    await delay(500);
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  const migrations = readdirSync(root).filter(name => /^\d{14}_/.test(name) && name <= target).sort();
  assert.equal(migrations.at(-1), target);
  for (const name of migrations.slice(0, -1)) migrate(name);
  const guards = preservedFunctions();
  let before;
  if (mode === 'upgrade') {
    seed();
    reject(assessment('before-fix'), 'moderation HUMAN text digest mismatch');
    assert.equal(sql(assessment('historical-raw', { digest: hash(raw) })), 'historical-raw');
    complete('historical-raw');
    before = rowSnapshot();
  }
  migrate(target);
  assert.equal(preservedFunctions(), guards, 'Unrelated guard functions changed');
  if (mode === 'upgrade') assert.equal(rowSnapshot(), before, 'Historical rows changed during migration');
  else seed();
  verify();
  console.log(`PASS human moderation subject guard ${mode}`);
} finally {
  if (started) { docker(['rm', '-f', '-v', container]); console.log(`CLEANUP ${container}`); }
}
