import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { session, waitBlocked } from './arch040-postgres-lock-sessions.mjs';

const require = createRequire(import.meta.url);
const prisma = require.resolve('prisma/build/index.js');
const { PrismaClient } = require('@prisma/client');
let mapping;
const run = promisify(execFile);
const name = `moda-arch076-allowance-${randomUUID()}`;
const temporary = mkdtempSync(join(tmpdir(), 'moda-arch076-allowance-'));
const fixture = join(temporary, 'prisma');
const migrations = new URL('../prisma/migrations/', import.meta.url);
const target = '20261115130322_conversation_allowance_blocks';
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sqlArgs = db => ['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db];
const sql = (db, input) => docker(sqlArgs(db), input).trim();
const blocks = 'billing."ConversationAllowanceBlock"';
let cases = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); cases++; };
function reject(db, statement, reason) {
  assert.throws(() => sql(db, statement), error => String(error.stderr).includes(reason)); cases++;
}
function seed(db) {
  sql(db, `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('s1','one.fixture.example',now()),('s2','two.fixture.example',now());
INSERT INTO commerce."CheckoutRecovery"(id,"shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES('r1','s1','t1',now(),now()),('r2','s2','t2',now(),now()),('r3','s1','t3',now(),now());
INSERT INTO whatsapp."Conversation"(id,"checkoutRecoveryId",type,"updatedAt") VALUES('c1','r1','RECOVERY',now()),('c2','r2','RECOVERY',now()),('c3','r3','RECOVERY',now());
INSERT INTO whatsapp."Conversation"(id,"shopId",type,"updatedAt") VALUES('standalone','s1','PRODUCT_DISCOVERY',now());
INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId",status) VALUES('legacy','c1','OUTBOUND','AGENT','Original basket reply','legacy-provider','READ');
INSERT INTO billing."UsageEvent"(id,"shopId",metric,quantity,"idempotencyKey") VALUES('legacy-usage','s1','OUTBOUND_AUTOMATED_MESSAGE',1,'legacy-message-usage');
INSERT INTO billing."ShopEntitlementCounter"(id,"shopId",counter,"updatedAt") VALUES('counter1','s1','LIFETIME_FREE_RECOVERY_CREDITS',now()),('counter2','s2','LIFETIME_FREE_RECOVERY_CREDITS',now());
INSERT INTO billing."UsageReservation"(id,"shopId","counterId","sourceKey",quantity,status,"updatedAt") VALUES('credit1','s1','counter1','initial:s1:r1',1,'COMMITTED',now()),('credit2','s1','counter1','continuation:b1',1,'RESERVED',now()),('credit3','s1','counter1','followup:r1',1,'RESERVED',now()),('credit-other','s2','counter2','other:initial',1,'COMMITTED',now());`);
}
const block = (id, ordinal = 0, extras = {}) => {
  const values = {id,shopId:'s1',conversationId:'c1',ordinal,fundingKind: ordinal === 0 ? 'INITIAL' : 'CONTINUATION',state:ordinal === 0 ? 'ACTIVE' : 'PENDING',hardMessageLimit:20,terminalReservedSlots:1,...extras};
  const quote = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  return `INSERT INTO ${blocks} (${Object.keys(values).map(k=>`"${k}"`).join(',')}) VALUES (${Object.values(values).map(quote).join(',')})`;
};
const pending = (id, ordinal, extras = {}) => block(id, ordinal, {predecessorId:'b0',repairDeadlineAt:'2099-01-01T00:00:00Z',repairAt:'2098-01-01T00:00:00Z',...extras});
async function checks(db) {
  check(sql(db, `SELECT content||':'||status::text||':'||"providerMessageId" FROM whatsapp."ConversationMessage" WHERE id='legacy'`), 'Original basket reply:READ:legacy-provider');
  check(sql(db, `SELECT quantity=1 FROM billing."UsageEvent" WHERE id='legacy-usage'`), 't');
  check(sql(db, `SELECT "allowanceBlockId" IS NULL FROM whatsapp."ConversationMessage" WHERE id='legacy'`), 't');
  check(sql(db, `SELECT "shopId" IS NULL FROM whatsapp."Conversation" WHERE id='c1'`), 't');
  check(sql(db, `SELECT count(*) FROM ${blocks}`), '0');
  sql(db,block('b0',0,{creditReservationId:'credit1'}));
  reject(db,`UPDATE whatsapp."Conversation" SET "shopId"='s2' WHERE id='c1'`,'ALLOWANCE_PARENT_OWNER_MISMATCH');
  reject(db,`UPDATE whatsapp."Conversation" SET type='PRODUCT_DISCOVERY',"checkoutRecoveryId"=NULL WHERE id='c1'`,'ALLOWANCE_PARENT_OWNER_MISMATCH');
  reject(db,`UPDATE commerce."CheckoutRecovery" SET "shopId"='s2' WHERE id='r1'`,'ALLOWANCE_PARENT_OWNER_MISMATCH');
  reject(db,block('wrong-shop',0,{shopId:'s2',conversationId:'c3'}),'ALLOWANCE_OWNER_MISMATCH');
  reject(db,block('standalone',0,{conversationId:'standalone'}),'ALLOWANCE_OWNER_MISMATCH');
  reject(db,block('missing',0,{conversationId:'absent'}),'ALLOWANCE_CONVERSATION_MISSING');
  reject(db,block('invalid-limit',0,{conversationId:'c3',hardMessageLimit:0}),'Allowance_limits_check');
  reject(db,block('invalid-reserve',0,{conversationId:'c3',terminalReservedSlots:21}),'Allowance_limits_check');
  reject(db,block('invalid-kind',0,{conversationId:'c3',fundingKind:'RENEWAL'}),'Allowance_funding_kind_check');
  reject(db,block('invalid-state',0,{conversationId:'c3',state:'RESERVED'}),'Allowance_state_check');
  reject(db,pending('wrong-predecessor',1,{predecessorId:'absent'}),'ALLOWANCE_PREDECESSOR_MISMATCH');
  reject(db,pending('foreign-predecessor',1,{conversationId:'c3'}),'ALLOWANCE_PREDECESSOR_MISMATCH');
  reject(db,pending('missing-deadline',1,{repairDeadlineAt:null,repairAt:null}),'Allowance_repair_check');
  reject(db,pending('unpaired-lease',1,{repairLeaseToken:'owner'}),'Allowance_repair_check');
  reject(db,pending('foreign-credit',1,{creditReservationId:'credit-other'}),'ConversationAllowanceBlock_creditReservationId_shopId_fkey');
  reject(db,pending('reuse-initial-credit',1,{creditReservationId:'credit1'}),'ConversationAllowanceBlock_creditReservationId_key');
  sql(db,pending('b1',1));
  check(sql(db,`SELECT string_agg(state,',' ORDER BY ordinal) FROM ${blocks}`),'ACTIVE,PENDING');
  reject(db,pending('duplicate-pending',2),'Allowance_one_pending_per_conversation');
  reject(db,`UPDATE ${blocks} SET state='ACTIVE',"repairAt"=NULL,"repairDeadlineAt"="repairDeadlineAt" WHERE id='b1'`,'Allowance_funding_proof_check');
  sql(db,`UPDATE ${blocks} SET "creditReservationId"='credit2' WHERE id='b1'`);
  reject(db,`UPDATE ${blocks} SET "creditReservationId"='credit3' WHERE id='b1'`,'ALLOWANCE_RESERVATION_IMMUTABLE');
  reject(db,`UPDATE ${blocks} SET "creditReservationId"=NULL WHERE id='b1'`,'ALLOWANCE_RESERVATION_IMMUTABLE');
  for (const [field,value] of [['shopId',"'s2'"],['conversationId',"'c2'"],['ordinal','4'],['hardMessageLimit','30'],['terminalReservedSlots','2'],['predecessorId','NULL'],['fundingKind',"'FOLLOW_UP'"]])
    reject(db,`UPDATE ${blocks} SET "${field}"=${value} WHERE id='b1'`,'ALLOWANCE_IDENTITY_IMMUTABLE');
  reject(db,`UPDATE ${blocks} SET "repairDeadlineAt"='2100-01-01' WHERE id='b1'`,'ALLOWANCE_REPAIR_DEADLINE_IMMUTABLE');
  // Two real replicas race for the same pending intent's lease.
  const acquire = owner => `UPDATE ${blocks} SET "repairLeaseToken"='${owner}',"repairLeaseUntil"=now()+interval '1 minute' WHERE id='b1' AND "repairLeaseToken" IS NULL RETURNING id`;
  const leases = await Promise.all(['owner-a','owner-b'].map(owner=>run('docker',[...sqlArgs(db),'-c',acquire(owner)],{encoding:'utf8'})));
  check(leases.map(x=>x.stdout.trim()).sort(),['','b1']);
  check(sql(db,`WITH changed AS (UPDATE ${blocks} SET "repairLeaseToken"=NULL,"repairLeaseUntil"=NULL WHERE id='b1' AND "repairLeaseToken"='stale' RETURNING 1) SELECT count(*) FROM changed`),'0');
  sql(db,`UPDATE ${blocks} SET "repairLeaseToken"=NULL,"repairLeaseUntil"=NULL,"repairAt"=NULL WHERE id='b1'`);
  check(sql(db,`SELECT state FROM ${blocks} WHERE id='b1'`),'PENDING');
  reject(db,pending('parked-replacement',2),'Allowance_one_pending_per_conversation');
  // Root message pin is insert-only; provider updates are still allowed.
  sql(db,`INSERT INTO whatsapp."ConversationMessage"(id,"conversationId","allowanceBlockId",direction,"senderType",content) VALUES('opening','c1','b1','OUTBOUND','AGENT','Answer')`);
  reject(db,`UPDATE whatsapp."ConversationMessage" SET "allowanceBlockId"='b0' WHERE id='opening'`,'MESSAGE_ALLOWANCE_PIN_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationMessage" SET "allowanceBlockId"='b0' WHERE id='legacy'`,'MESSAGE_ALLOWANCE_PIN_IMMUTABLE');
  reject(db,`UPDATE whatsapp."ConversationMessage" SET "conversationId"='c2' WHERE id='opening'`,'MESSAGE_ALLOWANCE_PIN_IMMUTABLE');
  reject(db,`INSERT INTO whatsapp."ConversationMessage"(id,"conversationId","allowanceBlockId",direction,"senderType",content) VALUES('foreign-message','c2','b1','OUTBOUND','AGENT','wrong owner')`,'ConversationMessage_allowanceBlockId_conversationId_fkey');
  sql(db,`UPDATE whatsapp."ConversationMessage" SET status='SENT',"providerMessageId"='opening-provider',"sentAt"=now() WHERE id='opening'`);
  reject(db,`UPDATE ${blocks} SET state='ACTIVE' WHERE id='b1'`,'Allowance_one_active_per_conversation');
  sql(db,`BEGIN; UPDATE ${blocks} SET state='EXHAUSTED' WHERE id='b0'; UPDATE ${blocks} SET state='CLOSED' WHERE id='b0'; UPDATE ${blocks} SET state='ACTIVE' WHERE id='b1'; COMMIT;`);
  check(sql(db,`SELECT string_agg(state,',' ORDER BY ordinal) FROM ${blocks}`),'CLOSED,ACTIVE');
  reject(db,`UPDATE ${blocks} SET state='PENDING',"repairAt"='2098-01-01' WHERE id='b1'`,'ALLOWANCE_STATE_REGRESSION');
  reject(db,`DELETE FROM ${blocks} WHERE id='b0'`,'ALLOWANCE_HISTORY_DELETE_FORBIDDEN');
  reject(db,`DELETE FROM billing."UsageReservation" WHERE id='credit2'`,'ConversationAllowanceBlock_creditReservationId_shopId_fkey');
  reject(db,pending('old-ordinal',1),'ALLOWANCE_ORDINAL_NOT_MONOTONIC');
  // Concurrent continuation intents cannot create two funded boundaries.
  sql(db,`UPDATE ${blocks} SET state='EXHAUSTED' WHERE id='b1'`);
  const attempts=await Promise.allSettled(['next-a','next-b'].map(id=>run('docker',[...sqlArgs(db),'-c',pending(id,2,{predecessorId:'b1'})],{encoding:'utf8'})));
  check(attempts.filter(x=>x.status==='fulfilled').length,1);
  const winner=sql(db,`SELECT id FROM ${blocks} WHERE state='PENDING'`);
  sql(db,`UPDATE ${blocks} SET state='CANCELLED',"repairAt"=NULL WHERE id='${winner}'`);
  reject(db,pending('reuse-cancelled-ordinal',2,{predecessorId:'b1'}),'ALLOWANCE_ORDINAL_NOT_MONOTONIC');
  sql(db,pending('retry',3,{predecessorId:'b1'}));
  check(sql(db,`SELECT count(*) FROM ${blocks} WHERE state='CANCELLED'`),'1');
  check(sql(db,`SELECT count(*) FROM pg_constraint WHERE conrelid IN ('${blocks}'::regclass,'whatsapp."ConversationMessage"'::regclass) AND conname IN ('ConversationAllowanceBlock_creditReservationId_shopId_fkey','ConversationAllowanceBlock_predecessorId_conversationId_fkey','ConversationMessage_allowanceBlockId_conversationId_fkey') AND condeferrable AND condeferred`),'3');
  // Whole-owner cascades remain legal despite deferred historical evidence FKs.
  sql(db,`DELETE FROM whatsapp."Conversation" WHERE id='c1'`);
  check(sql(db,`SELECT count(*) FROM ${blocks}`),'0');
  check(sql(db,`SELECT count(*) FROM billing."UsageEvent" WHERE id='legacy-usage'`),'1');
  sql(db,block('shop-delete',0,{conversationId:'c2',shopId:'s2',creditReservationId:'credit-other'}));
  sql(db,`DELETE FROM commerce."Shop" WHERE id='s2'`);
  check(sql(db,`SELECT count(*) FROM ${blocks}`),'0');
  const client = new PrismaClient({datasourceUrl:`postgresql://postgres:fixture-only@${mapping}/${db}`});
  try {
    const created = await client.conversationAllowanceBlock.create({data:{id:'prisma-created',shopId:'s1',conversationId:'c3',ordinal:0,fundingKind:'INITIAL',state:'ACTIVE',hardMessageLimit:20,terminalReservedSlots:1}});
    check(created.state,'ACTIVE');
    const message = await client.conversationMessage.create({data:{id:'prisma-message',conversationId:'c3',allowanceBlockId:created.id,direction:'OUTBOUND',senderType:'AGENT',content:'Prisma pin'}});
    check(message.allowanceBlockId,created.id);
    await client.conversationAllowanceBlock.update({where:{id:created.id},data:{state:'CANCELLED'}});
    check((await client.conversationAllowanceBlock.findUnique({where:{id:created.id}})).state,'CANCELLED');
    await client.conversation.delete({where:{id:'c3'}});
    check(await client.conversationAllowanceBlock.count(),0);
  } finally { await client.$disconnect(); }
  sql(db,`INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content) VALUES('old-writer','standalone','OUTBOUND','HUMAN','Still works')`);
  check(sql(db,`SELECT "allowanceBlockId" IS NULL FROM whatsapp."ConversationMessage" WHERE id='old-writer'`),'t');
}
async function parentOwnerRaces(db) {
  sql(db, `CREATE TABLE public.allowance_test_result(name text PRIMARY KEY,result text NOT NULL);
INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('s-race2','race-other.fixture.example',now());
INSERT INTO commerce."CheckoutRecovery"(id,"shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES('race-r1','s1','race-t1',now(),now()),('race-r2','s1','race-t2',now(),now());
INSERT INTO whatsapp."Conversation"(id,"checkoutRecoveryId",type,"updatedAt") VALUES('race-c1','race-r1','RECOVERY',now()),('race-c2','race-r2','RECOVERY',now());`);
  const child = session(() => sqlArgs(db), 'allowance-child');
  const parent = session(() => sqlArgs(db), 'allowance-parent');
  try {
    // Child first: the parent's non-key owner UPDATE must really wait until the
    // child commits, then its reciprocal deferred guard must see/reject it.
    await child.send(`BEGIN; SET application_name='allowance-child'; ${block('race-b1',0,{conversationId:'race-c1'})};`);
    await parent.send("BEGIN; SET application_name='allowance-parent';");
    const changingParent = parent.send(`DO $race$ DECLARE result text:='allowed'; BEGIN BEGIN
UPDATE commerce."CheckoutRecovery" SET "shopId"='s-race2' WHERE id='race-r1'; SET CONSTRAINTS ALL IMMEDIATE;
EXCEPTION WHEN check_violation THEN result:=SQLSTATE; END;
INSERT INTO public.allowance_test_result VALUES('parent-after-child',result); END $race$;`);
    await waitBlocked(q=>sql(db,q),'allowance-parent');
    await child.send('COMMIT;'); await changingParent; await parent.send('COMMIT;');
    check(sql(db,"SELECT result FROM public.allowance_test_result WHERE name='parent-after-child'"),'23514');
    check(sql(db,`SELECT r."shopId"=b."shopId" FROM commerce."CheckoutRecovery" r JOIN whatsapp."Conversation" c ON c."checkoutRecoveryId"=r.id JOIN ${blocks} b ON b."conversationId"=c.id WHERE c.id='race-c1'`),'t');
    // Parent first: the child's recovery read waits for the owner mutation and
    // validates the committed owner rather than admitting a stale-shop block.
    await parent.send(`BEGIN; UPDATE commerce."CheckoutRecovery" SET "shopId"='s-race2' WHERE id='race-r2';`);
    await child.send('BEGIN;');
    const insertingChild = child.send(`DO $race$ DECLARE result text:='allowed'; BEGIN BEGIN
${block('race-b2',0,{conversationId:'race-c2'})};
EXCEPTION WHEN check_violation THEN result:=SQLSTATE; END;
INSERT INTO public.allowance_test_result VALUES('child-after-parent',result); END $race$;`);
    await waitBlocked(q=>sql(db,q),'allowance-child');
    await parent.send('COMMIT;'); await insertingChild; await child.send('COMMIT;');
    check(sql(db,"SELECT result FROM public.allowance_test_result WHERE name='child-after-parent'"),'23514');
    check(sql(db,`SELECT count(*) FROM ${blocks} WHERE id='race-b2'`),'0');
  } finally { await child.close(); await parent.close(); }
  console.log(`PASS ${db}: both real parent-owner/child-insert lock orderings reject stale ownership`);
}

try {
  docker(['run','-d','--name',name,'--label','moda.task=ARCH-076-DATABASE-002','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fixture','pgvector/pgvector:pg17']);
  let ready=false;for(let i=0;i<40;i++){try{sql('fixture','SELECT 1');ready=true;break;}catch{await delay(500);}}assert.ok(ready);
  mapping=docker(['port',name,'5432/tcp']).trim();assert.match(mapping,/^127\.0\.0\.1:\d+$/);
  mkdirSync(join(fixture,'migrations'),{recursive:true});cpSync(new URL('../prisma/schema.prisma',import.meta.url),join(fixture,'schema.prisma'));
  for(const entry of readdirSync(migrations).filter(entry=>entry!==target))cpSync(new URL(entry,migrations),join(fixture,'migrations',entry),{recursive:true});
  const deploy=db=>{assert.ok(['fresh','upgrade'].includes(db));const url=`postgresql://postgres:fixture-only@${mapping}/${db}`;assert.equal(new URL(url).hostname,'127.0.0.1');return execFileSync(process.execPath,[prisma,'migrate','deploy','--schema',join(fixture,'schema.prisma')],{encoding:'utf8',env:{...process.env,DATABASE_URL:url},maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});};
  sql('fixture','CREATE DATABASE fresh; CREATE DATABASE upgrade;');deploy('upgrade');seed('upgrade');
  const snapshot=db=>sql(db,`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM whatsapp."ConversationMessage" m),'usage',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM billing."UsageEvent" u),'reservations',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM billing."UsageReservation" u))`);
  const before=JSON.parse(snapshot('upgrade'));
  cpSync(new URL(target,migrations),join(fixture,'migrations',target),{recursive:true});deploy('fresh');seed('fresh');deploy('upgrade');
  const after=JSON.parse(snapshot('upgrade'));for(const message of after.messages)delete message.allowanceBlockId;check(after,before);
  for(const db of ['fresh','upgrade']){assert.ok(deploy(db).includes('No pending migrations'));await checks(db);await parentOwnerRaces(db);console.log(`PASS ${db}: full Prisma history, ownership/immutability/repair/concurrency/cascade and old writers`);}
  console.log(`PASS ARCH-076-DATABASE-002 ${cases} assertions; no hosted database or provider calls`);
} finally {
  docker(['rm','-f','--volumes',name]);rmSync(temporary,{recursive:true,force:true});console.log('Removed invocation-owned PostgreSQL and migration fixtures');
}
