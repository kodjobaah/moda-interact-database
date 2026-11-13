import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
const name = `moda-arch075-${randomUUID()}`;
const target = '20261113004310_arch075_ordered_delivery_parts';
const root = new URL('../prisma/migrations/', import.meta.url);
const run = promisify(execFile);
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sqlArgs = db => ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db];
const sql = (db, input) => docker(sqlArgs(db), input).trim();
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
let cases = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); cases++; };
function reject(db, input, code) {
  assert.throws(() => sql(db, input), error => String(error.stderr).includes(code)); cases++;
}
function seed(db) {
  sql(db, `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('shop','fixture.example',now());
INSERT INTO whatsapp."Conversation"(id,"shopId",type,"updatedAt") VALUES('conversation','shop','PRODUCT_DISCOVERY',now());
INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId",status) VALUES('legacy','conversation','OUTBOUND','AGENT','legacy body','legacy-meta-id','READ');`);
}
const part = (id, ordinal, overrides = {}) => {
  const values = {id, messageId:'legacy', ordinal, role: ordinal === 0 ? 'HEADER' : ordinal === 1 ? 'PRODUCT' : 'ANSWER', payload:JSON.stringify({schemaVersion:1,kind:'TEXT',body:'Fixture answer'}),payloadDigest:'a'.repeat(64),sourceIdentity:JSON.stringify({shopId:'shop',conversationId:'conversation',controlRevision:1,inboundVersion:1}),deadlineAt:'2026-11-13T01:00:00Z',providerAccountId:'account1',providerPhoneNumberId:'phone1',updatedAt:'2026-11-13T00:00:00Z',...overrides};
  return `INSERT INTO whatsapp."ConversationDeliveryPart" (${Object.keys(values).map(k=>`"${k}"`).join(',')}) VALUES (${Object.values(values).map(quote).join(',')})`;
};
const receipt = (id, overrides={}) => {
  const values = {id,providerAccountId:'account1',providerPhoneNumberId:'phone1',providerMessageId:'physical-meta-0',status:'READ',providerTimestamp:'2026-11-13T00:00:01Z',...overrides};
  return `INSERT INTO whatsapp."ConversationDeliveryStatusReceipt" (${Object.keys(values).map(k=>`"${k}"`).join(',')}) VALUES (${Object.values(values).map(quote).join(',')})`;
};
async function checks(db) {
  check(sql(db, `SELECT "providerMessageId"||':'||content||':'||status::text FROM whatsapp."ConversationMessage" WHERE id='legacy'`),'legacy-meta-id:legacy body:READ');
  check(sql(db, `SELECT count(*) FROM whatsapp."ConversationDeliveryPart"`),'0');
  sql(db, `INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content) VALUES('old-writer','conversation','OUTBOUND','AGENT','old writer still works')`);
  check(sql(db, `SELECT "outboundPresentation" IS NULL FROM whatsapp."ConversationMessage" WHERE id='old-writer'`),'t');
  for(let i=0;i<3;i++)sql(db,part(`p${i}`,i));
  check(sql(db, `SELECT string_agg("ordinal"::text,',' ORDER BY "ordinal") FROM whatsapp."ConversationDeliveryPart" WHERE "messageId"='legacy'`),'0,1,2');
  reject(db,part('duplicate',0),'ConversationDeliveryPart_messageId_ordinal_key');
  reject(db,part('negative',-1),'ConversationDeliveryPart_ordinal_check');
  reject(db,part('fourth',3),'ConversationDeliveryPart_ordinal_check');
  reject(db,part('missing-root',0,{messageId:'absent'}),'ConversationDeliveryPart_messageId_fkey');
  reject(db,part('bad-role',0,{messageId:'old-writer',role:'COVER'}),'invalid input value for enum');
  reject(db,part('bad-payload',0,{messageId:'old-writer',payload:'[]'}),'ConversationDeliveryPart_payload_check');
  reject(db,part('large-payload',0,{messageId:'old-writer',payload:JSON.stringify({body:'x'.repeat(65536)})}),'ConversationDeliveryPart_payload_check');
  reject(db,part('bad-source',0,{messageId:'old-writer',sourceIdentity:'[]'}),'ConversationDeliveryPart_source_check');
  reject(db,part('large-source',0,{messageId:'old-writer',sourceIdentity:JSON.stringify({data:'x'.repeat(16384)})}),'ConversationDeliveryPart_source_check');
  reject(db,part('bad-digest',0,{messageId:'old-writer',payloadDigest:'z'.repeat(64)}),'ConversationDeliveryPart_digest_check');
  reject(db,part('empty-account',0,{messageId:'old-writer',providerAccountId:''}),'ConversationDeliveryPart_sender_check');
  reject(db,part('bad-phone',0,{messageId:'old-writer',providerPhoneNumberId:'phone with spaces'}),'ConversationDeliveryPart_sender_check');
  for(const [field,value] of Object.entries({id:'rewritten',messageId:'old-writer',ordinal:1,role:'ANSWER',payload:'{}',payloadDigest:'b'.repeat(64),sourceIdentity:'{}',deadlineAt:'2026-11-14T01:00:00Z',providerAccountId:'foreign',providerPhoneNumberId:'foreign',createdAt:'2026-11-12T00:00:00Z'}))
    reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "${field}"=${quote(value)} WHERE id='p0'`,'DELIVERY_PART_PREPARATION_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "providerDispatchKey"='key-only' WHERE id='p0'`,'ConversationDeliveryPart_dispatch_check');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED' WHERE id='p0'`,'ConversationDeliveryPart_state_evidence_check');
  sql(db, `UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='dispatch-0',"providerDispatchAdmittedAt"=now() WHERE id='p0'`);
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='PREPARED' WHERE id='p0'`,'DELIVERY_PART_OUTCOME_REGRESSION');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "providerDispatchKey"=NULL,"providerDispatchAdmittedAt"=NULL WHERE id='p0'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='dispatch-0',"providerDispatchAdmittedAt"=now() WHERE id='p1'`,'ConversationDeliveryPart_providerDispatchKey_key');
  // A read callback may arrive before ACK persistence, and before delivered.
  sql(db,receipt('early-read'));
  reject(db,`UPDATE whatsapp."ConversationDeliveryStatusReceipt" SET "partId"='p0' WHERE id='early-read'`,'DELIVERY_STATUS_SENDER_OR_MESSAGE_MISMATCH');
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED',"providerMessageId"='physical-meta-0',"acknowledgedAt"=now() WHERE id='p0'`);
  sql(db,`UPDATE whatsapp."ConversationDeliveryStatusReceipt" SET "partId"='p0' WHERE id='early-read'`);
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='READ',"readAt"='2026-11-13T00:00:01Z' WHERE id='p0'`);
  check(sql(db,`SELECT state::text||':'||("deliveredAt" IS NULL)::text FROM whatsapp."ConversationDeliveryPart" WHERE id='p0'`),'READ:true');
  sql(db,receipt('late-delivered',{status:'DELIVERED',providerTimestamp:'2026-11-13T00:00:00Z',partId:'p0'}));
  for(const [field,value] of Object.entries({providerDispatchKey:'another-dispatch',providerDispatchAdmittedAt:'2026-11-14T00:00:00Z',providerMessageId:'another-meta',acknowledgedAt:'2026-11-14T00:00:00Z',readAt:'2026-11-14T00:00:00Z'}))
    reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "${field}"=${quote(value)} WHERE id='p0'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED' WHERE id='p0'`,'DELIVERY_PART_OUTCOME_REGRESSION');
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='dispatch-1',"providerDispatchAdmittedAt"=now() WHERE id='p1'`);
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED',"providerMessageId"='physical-meta-0',"acknowledgedAt"=now() WHERE id='p1'`,'ConversationDeliveryPart_providerMessageId_key');
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='UNKNOWN',"unknownAt"=now() WHERE id='p1'`);
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='PREPARED',"providerDispatchKey"=NULL,"providerDispatchAdmittedAt"=NULL WHERE id='p1'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  // The two real concurrent CAS attempts cannot both acquire one dispatch permit.
  const cas = `UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='dispatch-2',"providerDispatchAdmittedAt"=now() WHERE id='p2' AND state='PREPARED' RETURNING id`;
  const outcomes=await Promise.all([1,2].map(()=>run('docker',[...sqlArgs(db),'-c',cas],{encoding:'utf8'})));
  check(outcomes.map(v=>v.stdout.trim()).sort(),['','p2']);
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='FAILED',"failedAt"=now(),"failureCode"='131000' WHERE id='p2'`);
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "failedAt"=NULL WHERE id='p2'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "failureCode"='other' WHERE id='p2'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED' WHERE id='p2'`,'DELIVERY_PART_OUTCOME_REGRESSION');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "unknownAt"=NULL WHERE id='p1'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  sql(db,part('cancelled',0,{messageId:'old-writer'}));
  sql(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='CANCELLED',"cancelledAt"=now() WHERE id='cancelled'`);
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='forbidden',"providerDispatchAdmittedAt"=now() WHERE id='cancelled'`,'DELIVERY_PART_OUTCOME_REGRESSION');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET "cancelledAt"=NULL WHERE id='cancelled'`,'DELIVERY_PART_OUTCOME_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED',"providerDispatchKey"='forbidden-ack',"providerDispatchAdmittedAt"=now(),"providerMessageId"='forbidden-meta',"acknowledgedAt"=now() WHERE id='cancelled'`,'DELIVERY_PART_OUTCOME_REGRESSION');
  reject(db,receipt('duplicate-receipt'),'ConversationDeliveryStatusReceipt_sender_status_key');
  sql(db,receipt('foreign-account',{providerAccountId:'account2'}));
  reject(db,`UPDATE whatsapp."ConversationDeliveryStatusReceipt" SET "partId"='p0' WHERE id='foreign-account'`,'DELIVERY_STATUS_SENDER_OR_MESSAGE_MISMATCH');
  reject(db,receipt('foreign-phone',{providerPhoneNumberId:'phone2',partId:'p0'}),'DELIVERY_STATUS_SENDER_OR_MESSAGE_MISMATCH');
  reject(db,receipt('foreign-message',{providerMessageId:'other-meta',partId:'p0'}),'DELIVERY_STATUS_SENDER_OR_MESSAGE_MISMATCH');
  reject(db,`UPDATE whatsapp."ConversationDeliveryStatusReceipt" SET status='SENT' WHERE id='early-read'`,'DELIVERY_STATUS_RECEIPT_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationDeliveryStatusReceipt" SET "partId"=NULL WHERE id='early-read'`,'DELIVERY_STATUS_RECEIPT_IMMUTABLE');
  check(sql(db,`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp' AND indexname='ConversationDeliveryPart_state_deadlineAt_idx'`),'1');
  check(sql(db,`SELECT indexdef LIKE '%WHERE ("partId" IS NULL)%' FROM pg_indexes WHERE schemaname='whatsapp' AND indexname='ConversationDeliveryStatusReceipt_unmatched_received_idx'`),'t');
  sql(db,`DELETE FROM whatsapp."ConversationMessage" WHERE id IN ('legacy','old-writer')`);
  check(sql(db,`SELECT count(*) FROM whatsapp."ConversationDeliveryPart"`),'0');
  check(sql(db,`SELECT count(*) FROM whatsapp."ConversationDeliveryStatusReceipt" WHERE "partId" IS NOT NULL`),'0');
  check(sql(db,`SELECT count(*) FROM whatsapp."ConversationDeliveryStatusReceipt" WHERE id='foreign-account'`),'1');
  console.log(`PASS ${db}: legacy compatibility, bounded/immutable parts, concurrent CAS, sender-scoped early callbacks, dedupe, indexes and cascade`);
}
try {
  docker(['run','-d','--name',name,'--label','moda.task=ARCH-075-DATABASE-001','--network','none','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fresh','pgvector/pgvector:pg17']);
  let ready=false;
  for(let i=0;i<30;i++){try{sql('fresh','SELECT 1');ready=true;break;}catch{await delay(500);}}
  assert.ok(ready,'invocation-owned PostgreSQL becomes ready');
  sql('fresh','CREATE DATABASE upgrade');
  const migrations=readdirSync(root).filter(n=>/^\d{14}_/.test(n)).sort();
  assert.equal(migrations.at(-1),target);
  for(const db of ['fresh','upgrade']){
    const ddl=names=>names.map(migration=>readFileSync(new URL(`${migration}/migration.sql`,root),'utf8')).join('\n');
    if(db==='upgrade'){
      sql(db,ddl(migrations.slice(0,-1)));
      seed(db);const before=sql(db,'SELECT to_jsonb(m) FROM whatsapp."ConversationMessage" m');
      sql(db,ddl([target]));
      check(sql(db,'SELECT to_jsonb(m) FROM whatsapp."ConversationMessage" m'),before);
    }else{sql(db,ddl(migrations));seed(db);}
    await checks(db);
  }
  console.log(`PASS ARCH-075 ${cases} real PostgreSQL assertions across fresh and populated upgrade`);
}finally{docker(['rm','-f',name]);console.log('Invocation-owned disposable PostgreSQL removed');}
