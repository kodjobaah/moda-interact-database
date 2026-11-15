import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
const run = promisify(execFile);
const name = `moda-arch076-sender-${randomUUID()}`;
const temporary = mkdtempSync(join(tmpdir(), 'moda-arch076-sender-'));
const fixture = join(temporary, 'prisma');
const source = new URL('../prisma/migrations/', import.meta.url);
const target = '20261113120000_whatsapp_sender_pool';
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 24 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sqlArgs = db => ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db];
const sql = (db, input) => docker(sqlArgs(db), input).trim();
let cases = 0;
let containerCreated = false;
let primaryFailure = null;
const check = (actual, expected) => { assert.deepEqual(actual, expected); cases++; };
function reject(db, statement, reason) {
  assert.throws(() => sql(db, statement), error => String(error.stderr).includes(reason), `${reason}: ${statement}`); cases++;
}
function seed(db) {
  sql(db, `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES ('shop-a','a.fixture.example',now()),('shop-b','b.fixture.example',now());
INSERT INTO commerce."Customer"(id,"shopId","updatedAt") VALUES ('customer-a','shop-a',now());
INSERT INTO commerce."CheckoutRecovery"(id,"shopId","customerId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES ('recovery-a','shop-a','customer-a','token-a',now(),now()),('recovery-a2','shop-a','customer-a','token-a2',now(),now()),('recovery-b','shop-b',NULL,'token-b',now(),now()),('recovery-a3','shop-a','customer-a','token-a3',now(),now());
INSERT INTO commerce."CustomerPhone"(id,"customerId",phone,"updatedAt") VALUES ('legacy-phone','customer-a','15550000001',now());
INSERT INTO whatsapp."Conversation"(id,"checkoutRecoveryId",type,"updatedAt") VALUES ('conversation-a','recovery-a','RECOVERY',now()),('conversation-a2','recovery-a2','RECOVERY',now()),('conversation-b','recovery-b','RECOVERY',now()),('conversation-a3','recovery-a3','RECOVERY',now());
INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId",status) VALUES ('legacy','conversation-a','OUTBOUND','AGENT','legacy body','legacy-meta','READ');
INSERT INTO billing."UsageEvent"(id,"shopId",metric,quantity,"idempotencyKey") VALUES ('legacy-usage','shop-a','RECOVERY_CONVERSATION',1,'legacy-usage-key');
INSERT INTO billing."ShopEntitlementCounter"(id,"shopId",counter,"updatedAt") VALUES ('legacy-counter','shop-a','LIFETIME_FREE_RECOVERY_CREDITS',now());
INSERT INTO billing."UsageReservation"(id,"shopId","counterId","sourceKey",quantity,status,"committedUsageEventId","updatedAt") VALUES ('legacy-reservation','shop-a','legacy-counter','legacy-source',1,'COMMITTED','legacy-usage',now());
INSERT INTO whatsapp."ConversationDeliveryPart"(id,"messageId",ordinal,role,payload,"payloadDigest","sourceIdentity","deadlineAt","providerAccountId","providerPhoneNumberId","updatedAt") VALUES ('legacy-part','legacy',0,'ANSWER','{"schemaVersion":1,"kind":"TEXT","body":"Legacy"}','${'a'.repeat(64)}','{"shopId":"shop-a","conversationId":"conversation-a"}',now()+interval '1 hour','111','222',now());
INSERT INTO whatsapp."ConversationDeliveryStatusReceipt"(id,"providerAccountId","providerPhoneNumberId","providerMessageId",status,"providerTimestamp") VALUES ('legacy-receipt','111','222','legacy-physical','READ',now());
INSERT INTO whatsapp."MetaTemplateAppOperationState"(environment,"appId") VALUES ('PRODUCTION','1234');`);
}
const preservation = db => sql(db, `SELECT jsonb_build_object('shop',(SELECT to_jsonb(s) FROM commerce."Shop" s WHERE id='shop-a'),'recovery',(SELECT to_jsonb(r) FROM commerce."CheckoutRecovery" r WHERE id='recovery-a'),'conversation',(SELECT to_jsonb(c) FROM whatsapp."Conversation" c WHERE id='conversation-a'),'message',(SELECT to_jsonb(m)-'dispatchProviderAccountId'-'dispatchProviderPhoneNumberId' FROM whatsapp."ConversationMessage" m WHERE id='legacy'),'phone',(SELECT to_jsonb(p) FROM commerce."CustomerPhone" p WHERE id='legacy-phone'),'reservation',(SELECT to_jsonb(r) FROM billing."UsageReservation" r WHERE id='legacy-reservation'),'usage',(SELECT to_jsonb(u) FROM billing."UsageEvent" u WHERE id='legacy-usage'),'part',(SELECT to_jsonb(p) FROM whatsapp."ConversationDeliveryPart" p WHERE id='legacy-part'),'receipt',(SELECT to_jsonb(r) FROM whatsapp."ConversationDeliveryStatusReceipt" r WHERE id='legacy-receipt'),'operation',(SELECT to_jsonb(o) FROM whatsapp."MetaTemplateAppOperationState" o WHERE "appId"='1234'))`);
const turn = (id, fields = '', values = '') => `INSERT INTO whatsapp."RecoveryBasketRoutingTurn"("inboundProviderMessageId","threadId","occurredAt","expiresAt"${fields}) VALUES ('${id}','thread-a',now(),now()+interval '1 hour'${values})`;
async function checks(db) {
  const w = 'whatsapp.';
  check(sql(db, `SELECT "dispatchProviderAccountId" IS NULL AND "dispatchProviderPhoneNumberId" IS NULL FROM ${w}"ConversationMessage" WHERE id='legacy'`), 't');
  sql(db, `INSERT INTO ${w}"ConversationMessage"(id,"conversationId",direction,"senderType",content) VALUES ('old-writer','conversation-a','INBOUND','CUSTOMER','Old writer');`);
  reject(db, `UPDATE ${w}"ConversationMessage" SET "dispatchProviderAccountId"='111' WHERE id='legacy'`, 'ConversationMessage_dispatch_sender_check');
  sql(db, `UPDATE ${w}"ConversationMessage" SET "dispatchProviderAccountId"='111',"dispatchProviderPhoneNumberId"='222' WHERE id='legacy'`);
  reject(db, `UPDATE ${w}"ConversationMessage" SET "dispatchProviderAccountId"='444' WHERE id='legacy'`, 'DISPATCH_SENDER_IMMUTABLE');
  sql(db, `INSERT INTO ${w}"WhatsAppPoolSender"("providerPhoneNumberId","providerAccountId","verifiedAt") VALUES ('222','111',now()),('333','111',now());`);
  check(sql(db, `SELECT "allocationEnabled" FROM ${w}"WhatsAppPoolSender" WHERE "providerPhoneNumberId"='222'`),'f');
  reject(db, `INSERT INTO ${w}"WhatsAppPoolSender"("providerPhoneNumberId","providerAccountId","verifiedAt") VALUES ('bad','111',now())`, 'WhatsAppPoolSender_identity_check');
  reject(db, `UPDATE ${w}"WhatsAppPoolSender" SET priority=-1 WHERE "providerPhoneNumberId"='222'`, 'WhatsAppPoolSender_priority_check');
  for (const field of ['providerPhoneNumberId','providerAccountId']) reject(db, `UPDATE ${w}"WhatsAppPoolSender" SET "${field}"='999' WHERE "providerPhoneNumberId"='222'`, 'SENDER_INVENTORY_IDENTITY_IMMUTABLE');
  sql(db, `INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('thread-a','15550000001','222'),('thread-b','15550000001','333');`);
  reject(db, `INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('duplicate','15550000001','222')`, 'RecoverySenderThread_live_recipient_sender_key');
  reject(db, `INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('bad-recipient','+44743','222')`, 'RecoverySenderThread_recipient_check');
  reject(db, `INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('missing','123','999')`, 'RecoverySenderThread_providerPhoneNumberId_fkey');
  for (const [field,value] of [['id',"'rewrite'"],['canonicalRecipient',"'123'"],['providerPhoneNumberId',"'333'"],['openedAt',"now()+interval '1 minute'"]]) reject(db, `UPDATE ${w}"RecoverySenderThread" SET "${field}"=${value} WHERE id='thread-a'`, 'SENDER_THREAD_IDENTITY_IMMUTABLE');
  sql(db, `INSERT INTO ${w}"RecoverySenderRoute"(id,"shopId","threadId","canonicalRecipient","providerPhoneNumberId") VALUES ('route-a','shop-a','thread-a','15550000001','222'),('route-b','shop-b','thread-a','15550000001','222');`);
  reject(db, `INSERT INTO ${w}"RecoverySenderRoute"(id,"shopId","threadId","canonicalRecipient","providerPhoneNumberId") VALUES ('duplicate-route','shop-a','thread-b','15550000001','333')`, 'RecoverySenderRoute_live_recipient_shop_key');
  reject(db, `INSERT INTO ${w}"RecoverySenderRoute"(id,"shopId","threadId","canonicalRecipient","providerPhoneNumberId") VALUES ('bad-thread','shop-a','thread-a','123','222')`, 'RecoverySenderRoute_threadId_canonicalRecipient_providerPh_fkey');
  for (const [field,value] of [['id',"'rewrite'"],['shopId',"'shop-b'"],['threadId',"'thread-b'"],['canonicalRecipient',"'123'"],['providerPhoneNumberId',"'333'"],['openedAt',"now()+interval '1 minute'"]]) reject(db, `UPDATE ${w}"RecoverySenderRoute" SET "${field}"=${value} WHERE id='route-a'`, 'SENDER_ROUTE_IDENTITY_IMMUTABLE');
  sql(db, `INSERT INTO ${w}"RecoverySenderAssignment"("conversationId","routeId") VALUES ('conversation-a','route-a'),('conversation-a2','route-a'),('conversation-b','route-b');`);
  reject(db, `INSERT INTO ${w}"RecoverySenderAssignment"("conversationId","routeId") VALUES ('conversation-a','route-a')`, 'RecoverySenderAssignment_pkey');
  sql(db, `INSERT INTO ${w}"Conversation"(id,"shopId",type,"updatedAt") VALUES ('nonrecovery','shop-a','PRODUCT_DISCOVERY',now())`);
  reject(db, `INSERT INTO ${w}"RecoverySenderAssignment"("conversationId","routeId") VALUES ('nonrecovery','route-a')`, 'SENDER_ASSIGNMENT_OWNER_MISMATCH');
  for (const [field,value] of [['conversationId',"'conversation-b'"],['routeId',"'route-b'"],['assignedAt',"now()+interval '1 minute'"]]) reject(db, `UPDATE ${w}"RecoverySenderAssignment" SET "${field}"=${value} WHERE "conversationId"='conversation-a'`, 'SENDER_ASSIGNMENT_IDENTITY_IMMUTABLE');
  reject(db, `UPDATE ${w}"Conversation" SET type='PRODUCT_DISCOVERY' WHERE id='conversation-a'`, 'SENDER_ASSIGNMENT_PARENT_OWNER_MISMATCH');
  reject(db, `UPDATE ${w}"Conversation" SET "checkoutRecoveryId"=NULL WHERE id='conversation-a'`, 'SENDER_ASSIGNMENT_PARENT_OWNER_MISMATCH');
  reject(db, `UPDATE ${w}"Conversation" SET "shopId"='shop-b' WHERE id='conversation-a'`, 'SENDER_ASSIGNMENT_PARENT_OWNER_MISMATCH');
  reject(db, `UPDATE commerce."CheckoutRecovery" SET "shopId"='shop-b',"customerId"=NULL WHERE id='recovery-a'`, 'SENDER_ASSIGNMENT_PARENT_OWNER_MISMATCH');
  sql(db, `UPDATE ${w}"Conversation" SET "shopId"='shop-a' WHERE id='conversation-a'; UPDATE ${w}"Conversation" SET "shopId"=NULL WHERE id='conversation-a'`);
  sql(db, `INSERT INTO commerce."CheckoutRecovery"(id,"shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES ('owner-race-recovery','shop-a','owner-race-token',now(),now()); INSERT INTO ${w}"Conversation"(id,"checkoutRecoveryId",type,"updatedAt") VALUES ('owner-race-conversation','owner-race-recovery','RECOVERY',now());`);
  const ownerRace=await Promise.allSettled([
    `BEGIN; INSERT INTO ${w}"RecoverySenderAssignment"("conversationId","routeId") VALUES ('owner-race-conversation','route-a'); SELECT pg_sleep(0.1); COMMIT;`,
    `UPDATE ${w}"Conversation" SET type='PRODUCT_DISCOVERY' WHERE id='owner-race-conversation'`
  ].map(statement=>run('docker',[...sqlArgs(db),'-c',statement],{encoding:'utf8'})));
  check(ownerRace.filter(result=>result.status==='fulfilled').length,1);
  const ownerFailure=ownerRace.find(result=>result.status==='rejected');
  assert.match(String(ownerFailure.reason.stderr),/SENDER_ASSIGNMENT_(PARENT_OWNER|OWNER)_MISMATCH/); cases++;
  check(sql(db, `SELECT NOT EXISTS (SELECT 1 FROM ${w}"RecoverySenderAssignment" a JOIN ${w}"Conversation" c ON c.id=a."conversationId" WHERE c.id='owner-race-conversation' AND c.type<>'RECOVERY')`),'t');
  sql(db, `BEGIN; DELETE FROM ${w}"Conversation" WHERE id='owner-race-conversation'; DELETE FROM commerce."CheckoutRecovery" WHERE id='owner-race-recovery'; COMMIT;`);
  reject(db, `DELETE FROM ${w}"RecoverySenderRoute" WHERE id='route-a'`, 'RecoverySenderAssignment_routeId_fkey');
  reject(db, `DELETE FROM ${w}"RecoverySenderThread" WHERE id='thread-a'`, 'RecoverySenderAssignment_routeId_fkey');
  reject(db, `DELETE FROM ${w}"RecoverySenderAssignment" WHERE "conversationId"='conversation-a'`, 'SENDER_ASSIGNMENT_DELETE_FORBIDDEN');
  reject(db, `DELETE FROM ${w}"WhatsAppPoolSender" WHERE "providerPhoneNumberId"='222'`, 'RecoverySenderThread_providerPhoneNumberId_fkey');
  reject(db, `INSERT INTO ${w}"Conversation"(id,"checkoutRecoveryId",type,"updatedAt") VALUES ('second','recovery-a','RECOVERY',now())`, 'Conversation_checkoutRecoveryId_key');
  sql(db,turn('original', ',"inputJson","candidatesJson","configurationSnapshot"', `,'{"text":"Friday?"}','{"offered":["conversation-a"]}','{"version":7}'`));
  check(sql(db, `SELECT "routingDecision" IS NULL FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='original'`),'t');
  reject(db,turn('original'),'RecoveryBasketRoutingTurn_pkey');
  for (const decision of ['[]','null','{}','{"schemaVersion":2}','{"schemaVersion":"1"}','{"schemaVersion":1,"newQuestionClause":"private"}']) reject(db,turn(`bad-${cases}`, ',"routingDecision"', `,'${decision}'`),'RecoveryBasketRoutingTurn_decision_check');
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routingDecision"='{"schemaVersion":1,"role":"CLARIFY"}' WHERE "inboundProviderMessageId"='original'`);
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routingDecision"='{"schemaVersion":1,"role":"NEW_QUESTION"}' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_DECISION_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routingDecision"=NULL WHERE "inboundProviderMessageId"='original'`, 'ROUTING_DECISION_IMMUTABLE');
  check(sql(db, `SELECT "configurationSnapshot"::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='original'`),'{"version": 7}');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "inputJson"='{"text":"another"}' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_INPUT_SNAPSHOT_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "candidatesJson"='[]' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_INPUT_SNAPSHOT_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "configurationSnapshot"='{}' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_CONFIGURATION_IMMUTABLE');
  sql(db, turn('prompt', ',"promptAdmittedAt","promptText","state"', ",now(),'Which shop?','PROMPT_ADMITTED'"));
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptSentAt"=now(),"promptProviderMessageId"='confirmed-prompt' WHERE "inboundProviderMessageId"='prompt'`);
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routeId"='route-a' WHERE "inboundProviderMessageId"='prompt'`);
  check(sql(db, `SELECT "promptScopeRouteId" IS NULL FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='prompt'`),'t');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptScopeRouteId"='route-a' WHERE "inboundProviderMessageId"='prompt'`, 'ROUTING_PROMPT_SCOPE_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routeId"='route-b' WHERE "inboundProviderMessageId"='prompt'`, 'ROUTING_ROUTE_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptText"='Replaced prompt' WHERE "inboundProviderMessageId"='prompt'`, 'ROUTING_PROMPT_TEXT_IMMUTABLE');
  reject(db, turn('foreign-route', ',"routeId"', ",'nonexistent'"),'ROUTING_ROUTE_THREAD_MISMATCH');
  sql(db, `INSERT INTO ${w}"RecoveryBasketRoutingTurn"("inboundProviderMessageId","threadId","occurredAt","expiresAt") VALUES ('other-thread','thread-b',now(),now()+interval '1 hour')`);
  reject(db, turn('bad-parent', ',"parentProviderMessageId"', ",'other-thread'"),'ROUTING_PARENT_THREAD_MISMATCH');
  reject(db, turn('bad-selection', ',"routeId","selectedConversationId"', ",'route-a','conversation-b'"),'ROUTING_SELECTION_REQUIRES_DECISION');
  reject(db, turn('wrong-owner-with-decision', ',"routeId","selectedConversationId","routingDecision","resolutionInboundProviderMessageId",state,"resolvedAt"', `,'route-a','conversation-b','{"schemaVersion":1}','wrong-owner-with-decision','RESOLVED',now()`), 'ROUTING_SELECTED_OWNER_MISMATCH');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET state='RECEIVED' WHERE "inboundProviderMessageId"='prompt'`, 'ROUTING_PROMPT_STATE_REGRESSION');
  sql(db, turn('child-before-decision'));
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "parentProviderMessageId"='prompt' WHERE "inboundProviderMessageId"='child-before-decision'`);
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "parentProviderMessageId"=NULL WHERE "inboundProviderMessageId"='child-before-decision'`, 'ROUTING_PARENT_IMMUTABLE');
  reject(db, `DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='prompt'`, 'RecoveryBasketRoutingTurn_parentProviderMessageId_fkey');
  sql(db, turn('resolved', ',"routeId","selectedConversationId","routingDecision","state","resolvedAt","parentProviderMessageId","resolutionInboundProviderMessageId"', `,'route-a','conversation-a','{"schemaVersion":1,"role":"SELECT_ONLY","currentInboundProviderMessageId":"resolved"}','RESOLVED',now(),'prompt','resolved'`));
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET state='RECEIVED' WHERE "inboundProviderMessageId"='resolved'`, 'ROUTING_TERMINAL_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "selectedConversationId"='conversation-a2' WHERE "inboundProviderMessageId"='resolved'`, 'ROUTING_TERMINAL_IMMUTABLE');
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET state='EXPIRED',"inputJson"=NULL,"candidatesJson"=NULL,"moderationJson"=NULL,"configurationSnapshot"=NULL WHERE "inboundProviderMessageId"='original'`);
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routeId"='route-a' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_TERMINAL_IMMUTABLE');
  sql(db, turn('q1', ',"routeId","inputJson","candidatesJson"', `,'route-a','{"text":"Can it arrive Friday?"}','{"offered":["conversation-a"]}'`));
  sql(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routingDecision"='{"schemaVersion":1,"role":"CLARIFY"}' WHERE "inboundProviderMessageId"='q1'; UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptAdmittedAt"=now(),"promptText"='Which basket?',state='PROMPT_ADMITTED' WHERE "inboundProviderMessageId"='q1'; UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptSentAt"=now(),"promptProviderMessageId"='q1-confirmed' WHERE "inboundProviderMessageId"='q1'`);
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "selectedConversationId"='conversation-a',"resolutionInboundProviderMessageId"='q1',state='RESOLVED',"resolvedAt"=now(),"inputJson"=NULL,"candidatesJson"=NULL,"moderationJson"=NULL,"promptText"=NULL WHERE "inboundProviderMessageId"='q1'`, 'ROUTING_RESOLVER_ROLE_MISMATCH');
  reject(db, turn('forged-current', ',"routeId","selectedConversationId","resolutionInboundProviderMessageId","routingDecision",state,"resolvedAt"', `,'route-a','conversation-a','forged-current','{"schemaVersion":1,"role":"NEW_QUESTION","currentInboundProviderMessageId":"other"}','RESOLVED',now()`), 'ROUTING_RESOLVER_INBOUND_MISMATCH');
  sql(db, turn('q2', ',"parentProviderMessageId","inputJson"', `,'q1','{"text":"1"}'`));
  const resolve = (original='q1', child='q2', prompt='q1-confirmed', role='SELECT_ONLY', promptTurn=original) => `BEGIN;
SELECT 1 FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='${original}' FOR UPDATE;
INSERT INTO ${w}"ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId") SELECT '${original}-admitted','conversation-a','INBOUND','CUSTOMER',q."inputJson"->>'text','${original}-provider' FROM ${w}"RecoveryBasketRoutingTurn" q WHERE q."inboundProviderMessageId"='${original}' AND q.state='PROMPT_ADMITTED' AND EXISTS (SELECT 1 FROM ${w}"RecoveryBasketRoutingTurn" child WHERE child."inboundProviderMessageId"='${child}' AND child.state='RECEIVED') ON CONFLICT(id) DO NOTHING;
INSERT INTO ${w}"ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId") SELECT '${child}-clause','conversation-a','INBOUND','CUSTOMER',c."inputJson"->>'text','${child}-provider' FROM ${w}"RecoveryBasketRoutingTurn" c WHERE c."inboundProviderMessageId"='${child}' AND c.state='RECEIVED' AND '${role}'='SELECT_AND_QUESTION' AND EXISTS (SELECT 1 FROM ${w}"RecoveryBasketRoutingTurn" q WHERE q."inboundProviderMessageId"='${original}' AND q.state='PROMPT_ADMITTED') ON CONFLICT(id) DO NOTHING;
UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routeId"='route-a',"selectedConversationId"='conversation-a',"resolutionInboundProviderMessageId"='${child}',"routingDecision"='{"schemaVersion":1,"role":"${role}","originalTurnId":"${original}","currentInboundProviderMessageId":"${child}","promptTurnId":"${promptTurn}","confirmedPromptProviderMessageId":"${prompt}"}',state='RESOLVED',"resolvedAt"=now(),"inputJson"=NULL WHERE "inboundProviderMessageId"='${child}' AND state='RECEIVED' AND EXISTS (SELECT 1 FROM ${w}"RecoveryBasketRoutingTurn" q WHERE q."inboundProviderMessageId"='${original}' AND q.state='PROMPT_ADMITTED');
UPDATE ${w}"RecoveryBasketRoutingTurn" SET "routeId"='route-a',"selectedConversationId"='conversation-a',"resolutionInboundProviderMessageId"='${child}',state='RESOLVED',"resolvedAt"=now(),"inputJson"=NULL,"candidatesJson"=NULL,"moderationJson"=NULL,"promptText"=NULL WHERE "inboundProviderMessageId"='${original}' AND state='PROMPT_ADMITTED';
UPDATE ${w}"RecoveryBasketRoutingTurn" SET state='IGNORED',"inputJson"=NULL,"candidatesJson"=NULL,"moderationJson"=NULL,"promptText"=NULL WHERE "inboundProviderMessageId"='${promptTurn}' AND '${promptTurn}'<>'${original}' AND state='PROMPT_ADMITTED';
COMMIT;`;
  sql(db, turn('q3', ',"parentProviderMessageId","inputJson"', `,'prompt','{"text":"1"}'`));
  reject(db, resolve('q1','q3'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  reject(db, resolve('q1','q2','forged-receipt'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  reject(db, resolve('q1','q2','q1-confirmed','NEW_QUESTION'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  // Two replicas compete on the same original/child rows. Replays cannot replace decisions.
  await Promise.all([1,2].map(() => run('docker',[...sqlArgs(db),'-c',resolve()],{encoding:'utf8'})));
  check(sql(db, `SELECT state||':'||("routingDecision"->>'role')||':'||"resolutionInboundProviderMessageId"||':'||("inputJson" IS NULL)::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='q1'`),'RESOLVED:CLARIFY:q2:true');
  check(sql(db, `SELECT count(*) FROM ${w}"RecoveryBasketRoutingTurn" WHERE "resolutionInboundProviderMessageId"='q2'`),'2');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "resolutionInboundProviderMessageId"='resolved' WHERE "inboundProviderMessageId"='q1'`, 'ROUTING_RESOLVER_IMMUTABLE');
  check(sql(db, `SELECT count(*)::text||':'||min(content) FROM ${w}"ConversationMessage" WHERE id='q1-admitted'`),'1:Can it arrive Friday?');
  reject(db, `DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='q2'`, 'RecoveryBasketRoutingTurn_resolution_fkey');
  sql(db, `BEGIN; DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId" IN ('q1','q2'); COMMIT;`);
  const pendingOriginal = (id,text) => turn(id, ',"routeId","inputJson","routingDecision","promptAdmittedAt","promptSentAt","promptProviderMessageId",state', `,'route-a','{"text":"${text}"}','{"schemaVersion":1,"role":"CLARIFY"}',now(),now(),'${id}-confirmed','PROMPT_ADMITTED'`);
  sql(db, pendingOriginal('q-extra','Can it arrive Monday?'));
  sql(db, turn('q-extra-child', ',"parentProviderMessageId","inputJson"', `,'q-extra','{"text":"1. Can I collect on Saturday?"}'`));
  sql(db, resolve('q-extra','q-extra-child','q-extra-confirmed','SELECT_AND_QUESTION'));
  check(sql(db, `SELECT substring(content FROM 4) FROM ${w}"ConversationMessage" WHERE id='q-extra-child-clause'`),'Can I collect on Saturday?');
  check(sql(db, `SELECT content FROM ${w}"ConversationMessage" WHERE id='q-extra-admitted'`),'Can it arrive Monday?');
  sql(db, pendingOriginal('q-await','Will it arrive Tuesday?'));
  sql(db, `BEGIN; ${turn('new-question', ',"routeId","routingDecision","selectedConversationId","resolutionInboundProviderMessageId",state,"resolvedAt"', `,'route-a','{"schemaVersion":1,"role":"NEW_QUESTION","currentInboundProviderMessageId":"new-question"}','conversation-a','new-question','RESOLVED',now()`)}; INSERT INTO ${w}"ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId") VALUES ('new-question-admitted','conversation-a','INBOUND','CUSTOMER','Do the shoes come in black?','new-question-provider'); COMMIT;`);
  check(sql(db, `SELECT state||':'||("routingDecision"->>'role') FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='q-await'`),'PROMPT_ADMITTED:CLARIFY');
  sql(db, pendingOriginal('q-race','Can I collect Friday?'));
  for (const child of ['q-race-a','q-race-b']) sql(db, turn(child, ',"parentProviderMessageId","inputJson"', `,'q-race','{"text":"1"}'`));
  await Promise.all(['q-race-a','q-race-b'].map(child=>run('docker',[...sqlArgs(db),'-c',resolve('q-race',child,'q-race-confirmed')],{encoding:'utf8'})));
  check(sql(db, `SELECT count(*) FROM ${w}"RecoveryBasketRoutingTurn" WHERE "parentProviderMessageId"='q-race' AND state='RESOLVED'`),'1');
  check(sql(db, `SELECT count(*) FROM ${w}"ConversationMessage" WHERE id='q-race-admitted'`),'1');
  const raceWinner=sql(db, `SELECT "resolutionInboundProviderMessageId" FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='q-race'`);
  sql(db, resolve('q-race',raceWinner,'q-race-confirmed'));
  check(sql(db, `SELECT count(*) FROM ${w}"ConversationMessage" WHERE id='q-race-admitted'`),'1');
  sql(db, `BEGIN; DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId" IN ('q-extra','q-extra-child','q-await','new-question','q-race','q-race-a','q-race-b'); COMMIT;`);
  // Original Q1, verified-shop prompt holder Q2 and later basket choice Q3.
  sql(db, turn('stage-root', ',"inputJson","routingDecision","promptAdmittedAt","promptSentAt","promptProviderMessageId","promptText",state', `,'{"text":"Which basket arrives Friday?"}','{"schemaVersion":1,"role":"CLARIFY"}',now(),now(),'stage-neutral','Which shop?','PROMPT_ADMITTED'`));
  const stageHolder = (id,parent,route,receipt) => turn(id, ',"parentProviderMessageId","routeId","promptScopeRouteId","inputJson","routingDecision","promptAdmittedAt","promptSentAt","promptProviderMessageId","promptText",state', `,'${parent}','${route}','${route}','{"text":"Shop choice"}','{"schemaVersion":1,"role":"CLARIFY"}',now(),now(),'${receipt}','Which basket?','PROMPT_ADMITTED'`);
  sql(db, stageHolder('stage-shop','stage-root','route-a','stage-basket'));
  sql(db, turn('stage-select', ',"parentProviderMessageId","inputJson"', `,'stage-root','{"text":"1"}'`));
  sql(db, turn('stage-other-root'));
  sql(db, stageHolder('stage-foreign-root-holder','stage-other-root','route-a','stage-foreign-root-prompt'));
  sql(db, stageHolder('stage-wrong-scope-holder','stage-root','route-b','stage-wrong-scope-prompt'));
  sql(db, `INSERT INTO ${w}"RecoveryBasketRoutingTurn"("inboundProviderMessageId","threadId","parentProviderMessageId","occurredAt","expiresAt","routingDecision","promptAdmittedAt","promptSentAt","promptProviderMessageId",state) VALUES ('stage-foreign-thread','thread-b','other-thread',now(),now()+interval '1 hour','{"schemaVersion":1,"role":"CLARIFY"}',now(),now(),'stage-foreign-thread-prompt','PROMPT_ADMITTED')`);
  reject(db, resolve('stage-root','stage-select','stage-foreign-root-prompt','SELECT_ONLY','stage-foreign-root-holder'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  reject(db, resolve('stage-root','stage-select','stage-wrong-scope-prompt','SELECT_ONLY','stage-wrong-scope-holder'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  reject(db, resolve('stage-root','stage-select','stage-foreign-thread-prompt','SELECT_ONLY','stage-foreign-thread'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  reject(db, resolve('stage-root','stage-select','forged-stage-receipt','SELECT_ONLY','stage-shop'), 'ROUTING_RESOLVER_ORIGINAL_OR_PROMPT_MISMATCH');
  sql(db, resolve('stage-root','stage-select','stage-basket','SELECT_ONLY','stage-shop'));
  check(sql(db, `SELECT state||':'||("routingDecision"->>'role')||':'||"routeId"||':'||("promptScopeRouteId" IS NULL)::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='stage-root'`),'RESOLVED:CLARIFY:route-a:true');
  check(sql(db, `SELECT "routingDecision"->>'promptTurnId' FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='stage-select'`),'stage-shop');
  check(sql(db, `SELECT state||':'||("inputJson" IS NULL)::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='stage-shop'`),'IGNORED:true');
  check(sql(db, `SELECT content FROM ${w}"ConversationMessage" WHERE id='stage-root-admitted'`),'Which basket arrives Friday?');
  sql(db, `BEGIN; DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId" IN ('stage-root','stage-shop','stage-select','stage-other-root','stage-foreign-root-holder','stage-wrong-scope-holder','stage-foreign-thread'); COMMIT;`);
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "configurationSnapshot"='{"version":99}' WHERE "inboundProviderMessageId"='original'`, 'ROUTING_TERMINAL_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "promptAdmittedAt"=now() WHERE "inboundProviderMessageId"='original'`, 'ROUTING_TERMINAL_IMMUTABLE');
  sql(db, turn('shop-b-pending', ',"routeId","inputJson"', `,'route-b','{"text":"private"}'`));
  sql(db, turn('neutral-survives'));
  // Physical shop cascade scrubs scoped originals without turning them neutral.
  sql(db, `DELETE FROM commerce."Shop" WHERE id='shop-b'`);
  check(sql(db, `SELECT state||':'||"routeId"||':'||("inputJson" IS NULL)::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='shop-b-pending'`),'EXPIRED:route-b:true');
  check(sql(db, `SELECT state||':'||("routeId" IS NULL)::text FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='neutral-survives'`),'RECEIVED:true');
  // Real parallel transactions use the architecture's recipient lock; exactly one live route/thread.
  const allocate = suffix => `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('447700900123',76)); INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") SELECT 'race-thread-${suffix}','447700900123','222' WHERE NOT EXISTS (SELECT 1 FROM ${w}"RecoverySenderThread" WHERE "canonicalRecipient"='447700900123' AND "providerPhoneNumberId"='222' AND "closedAt" IS NULL); INSERT INTO ${w}"RecoverySenderRoute"(id,"shopId","threadId","canonicalRecipient","providerPhoneNumberId") SELECT 'race-route-${suffix}','shop-a',t.id,t."canonicalRecipient",t."providerPhoneNumberId" FROM ${w}"RecoverySenderThread" t WHERE t."canonicalRecipient"='447700900123' AND t."closedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM ${w}"RecoverySenderRoute" r WHERE r."canonicalRecipient"=t."canonicalRecipient" AND r."shopId"='shop-a' AND r."closedAt" IS NULL); COMMIT;`;
  await Promise.all(['one','two'].map(suffix => run('docker', [...sqlArgs(db),'-c',allocate(suffix)], {encoding:'utf8'})));
  check(sql(db, `SELECT count(*) FROM ${w}"RecoverySenderRoute" WHERE "canonicalRecipient"='447700900123' AND "closedAt" IS NULL`),'1');
  // Existing sibling a2 deliberately keeps this generation open: this is a
  // sibling release/admission race, not the owning service's last-member race.
  const release = `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('15550000001',76)); UPDATE ${w}"RecoverySenderAssignment" SET "releasedAt"=now() WHERE "conversationId"='conversation-a' AND "releasedAt" IS NULL; UPDATE ${w}"RecoverySenderRoute" SET "closedAt"=now() WHERE id='route-a' AND "closedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM ${w}"RecoverySenderAssignment" WHERE "routeId"='route-a' AND "releasedAt" IS NULL); COMMIT;`;
  const add = `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('15550000001',76)); SELECT 1 FROM ${w}"RecoverySenderRoute" WHERE id='route-a' AND "closedAt" IS NULL FOR UPDATE; INSERT INTO ${w}"RecoverySenderAssignment"("conversationId","routeId") SELECT 'conversation-a3',id FROM ${w}"RecoverySenderRoute" WHERE id='route-a' AND "closedAt" IS NULL; COMMIT;`;
  await Promise.all([release,add].map(statement => run('docker',[...sqlArgs(db),'-c',statement],{encoding:'utf8'})));
  check(sql(db, `SELECT "closedAt" IS NULL FROM ${w}"RecoverySenderRoute" WHERE id='route-a'`),'t');
  check(sql(db, `SELECT count(*) FROM ${w}"RecoverySenderAssignment" WHERE "routeId"='route-a' AND "releasedAt" IS NULL`),'2');
  reject(db, `UPDATE ${w}"RecoverySenderAssignment" SET "releasedAt"=NULL WHERE "conversationId"='conversation-a'`, 'SENDER_RELEASE_IMMUTABLE');
  sql(db, `UPDATE ${w}"RecoverySenderAssignment" SET "releasedAt"=now() WHERE "conversationId" IN ('conversation-a2','conversation-a3'); UPDATE ${w}"RecoverySenderRoute" SET "closedAt"=now() WHERE id='route-a'; UPDATE ${w}"RecoverySenderThread" SET "closedAt"=now() WHERE id='thread-a'`);
  reject(db, `UPDATE ${w}"RecoverySenderRoute" SET "closedAt"=NULL WHERE id='route-a'`, 'SENDER_CLOSURE_IMMUTABLE');
  reject(db, `UPDATE ${w}"RecoverySenderThread" SET "closedAt"=NULL WHERE id='thread-a'`, 'SENDER_CLOSURE_IMMUTABLE');
  sql(db, `INSERT INTO ${w}"RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('new-generation','15550000001','222')`);
  check(sql(db, `SELECT "threadId" FROM ${w}"RecoverySenderRoute" WHERE id='route-a'`),'thread-a');
  // Nullable selected pointer deletion must not erase the frozen decision or permit rebinding.
  sql(db, `DELETE FROM whatsapp."Conversation" WHERE id='conversation-a'`);
  check(sql(db, `SELECT ("selectedConversationId" IS NULL)::text||':'||("routingDecision"->>'role') FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='resolved'`),'true:SELECT_ONLY');
  reject(db, `UPDATE ${w}"RecoveryBasketRoutingTurn" SET "selectedConversationId"='conversation-a2' WHERE "inboundProviderMessageId"='resolved'`, 'ROUTING_TERMINAL_IMMUTABLE');
  check(sql(db, `SELECT count(*) FROM ${w}"RecoverySenderAssignment" WHERE "conversationId"='conversation-a'`),'0');
  sql(db, `BEGIN; DELETE FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId" IN ('prompt','child-before-decision','resolved','q3'); COMMIT;`);
  check(sql(db, `SELECT count(*) FROM ${w}"RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"='prompt'`),'0');
  sql(db, `DELETE FROM commerce."Shop" WHERE id='shop-a'`);
  check(sql(db, `SELECT count(*) FROM ${w}"RecoverySenderAssignment"`),'0');
  check(sql(db, `SELECT count(*) FROM ${w}"RecoverySenderRoute"`),'0');
  check(sql(db, `SELECT count(*) FROM ${w}"RecoveryBasketRoutingTurn" WHERE state IN ('RECEIVED','PROMPT_ADMITTED','PROMPT_UNKNOWN') AND "routeId" IS NOT NULL`),'0');
}
try {
  console.log(`Invocation-owned PostgreSQL: ${name}`);
  docker(['run','-d','--name',name,'--label','moda.task=ARCH-076-DATABASE-001','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fixture','pgvector/pgvector:pg17']);
  containerCreated = true;
  let ready=false; for(let i=0;i<40;i++){try{sql('fixture','SELECT 1');ready=true;break;}catch{await delay(500);}}
  assert.ok(ready,'disposable local PostgreSQL ready');
  const mapping=docker(['port',name,'5432/tcp']).trim(); assert.match(mapping,/^127\.0\.0\.1:\d+$/);
  mkdirSync(join(fixture,'migrations'),{recursive:true});
  cpSync(new URL('../prisma/schema.prisma',import.meta.url),join(fixture,'schema.prisma'));
  for(const entry of readdirSync(source).filter(entry=>entry<target || entry==='migration_lock.toml')) cpSync(new URL(entry,source),join(fixture,'migrations',entry),{recursive:true});
  const command=(db,args)=>{
    const url=`postgresql://postgres:fixture-only@${mapping}/${db}`;
    assert.equal(new URL(url).hostname,'127.0.0.1'); assert.ok(['fresh','upgrade'].includes(db));
    return execFileSync(process.execPath,[prisma,...args,'--schema',join(fixture,'schema.prisma')],{encoding:'utf8',env:{...process.env,DATABASE_URL:url,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'},maxBuffer:24*1024*1024,stdio:['pipe','pipe','pipe']});
  };
  sql('fixture','CREATE DATABASE fresh; CREATE DATABASE upgrade;');
  command('upgrade',['migrate','deploy']);
  check(sql('upgrade','SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'),'80');
  seed('upgrade'); const before=preservation('upgrade');
  // Author against actual local PostgreSQL with Prisma migrate dev, then retain
  // the reviewed timestamp and custom integrity SQL rather than rewriting history.
  command('upgrade',['migrate','dev','--create-only','--skip-generate','--name','whatsapp_sender_pool']);
  const authored=readdirSync(join(fixture,'migrations')).filter(entry=>entry.endsWith('_whatsapp_sender_pool'));
  check(authored.length,1);
  const generated=readFileSync(join(fixture,'migrations',authored[0],'migration.sql'),'utf8');
  check((generated.match(/CREATE TABLE/g)||[]).length,5);
  rmSync(join(fixture,'migrations',authored[0]),{recursive:true});
  cpSync(new URL(target,source),join(fixture,'migrations',target),{recursive:true});
  command('fresh',['migrate','deploy']); command('upgrade',['migrate','deploy']);
  check(preservation('upgrade'),before);
  seed('fresh');
  for(const db of ['fresh','upgrade']){
    check(sql(db,'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'),'81');
    assert.ok(command(db,['migrate','deploy']).includes('No pending migrations'));
    await checks(db);
    console.log(`PASS ${db}: full migration history, immutable generations, R15 evidence, replica locks, deletion and old writers`);
  }
  console.log(`PASS ARCH-076-DATABASE-001 ${cases} assertions; no hosted DB/provider calls`);
} catch (error) {
  primaryFailure = error;
} finally {
  try {
    if (containerCreated) docker(['rm','-f','--volumes',name]);
    console.log(`Removed invocation-owned PostgreSQL ${name}`);
  } catch (cleanupError) {
    console.error(`Cleanup failed for invocation-owned PostgreSQL ${name}:`, cleanupError.message);
    primaryFailure ??= cleanupError;
  }
  try {
    rmSync(temporary,{recursive:true,force:true});
    console.log('Removed temporary migration files');
  } catch (cleanupError) {
    console.error('Temporary migration cleanup failed:', cleanupError.message);
    primaryFailure ??= cleanupError;
  }
}
if (primaryFailure) throw primaryFailure;
