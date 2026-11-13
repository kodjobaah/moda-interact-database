import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const name=`moda-arch075-human-${randomUUID()}`;
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=input=>docker(['exec','-i',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','fixture'],input).trim();
const sha=value=>createHash('sha256').update(value).digest('hex');
try{
  docker(['run','-d','--name',name,'--label','moda.task=ARCH-075-DATABASE-001','--network','none','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fixture','pgvector/pgvector:pg17']);
  let ready=false;for(let i=0;i<30;i++){try{sql('SELECT 1');ready=true;break;}catch{await delay(500);}}
  assert.ok(ready,'invocation-owned PostgreSQL becomes ready');
  const root=new URL('../prisma/migrations/',import.meta.url);
  sql(readdirSync(root).filter(n=>/^\d{14}_/.test(n)).sort().map(migration=>readFileSync(new URL(`${migration}/migration.sql`,root),'utf8')).join('\n'));
  sql(`INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('shop','human-layout.example',now());
    INSERT INTO commerce."CheckoutRecovery"(id,"shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES('recovery','shop','fixture-checkout',now(),now());
    INSERT INTO whatsapp."Conversation"(id,"shopId","checkoutRecoveryId",type,"updatedAt") VALUES('conversation','shop','recovery','RECOVERY',now());
    BEGIN;
    UPDATE whatsapp."Conversation" SET "controlMode"='HUMAN',"controlRevision"=1,"controlChangedAt"=clock_timestamp(),"updatedAt"=now() WHERE id='conversation';
    INSERT INTO whatsapp."ConversationControlEvent"(id,"conversationId","fromMode","toMode","fromRevision","toRevision") VALUES('control','conversation','AI','HUMAN',0,1);
    COMMIT;
    INSERT INTO whatsapp."MerchantConversationSendCommand"(id,"shopId","conversationId","idempotencyKey","payloadSha256","expectedControlRevision",kind,"recipientSnapshot","textBody","updatedAt") VALUES('command','shop','conversation','fixture-command','${sha('Human answer')}',1,'HUMAN_TEXT','447700900001','Human answer',now());
    UPDATE whatsapp."MerchantConversationSendCommand" SET state='CLAIMED',"leaseToken"='original-lease',"leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=1,"updatedAt"=now() WHERE id='command';
    UPDATE whatsapp."MerchantConversationSendCommand" SET "preparedTextBody"='Prepared HUMAN answer',"preparedWrapperEvidence"='{"schemaVersion":1,"outcome":"RENDERED"}',"preparedAt"=now(),"updatedAt"=now() WHERE id='command';
    BEGIN;
    INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerDispatchKey","providerDispatchAdmittedAt","providerDispatchControlRevision") VALUES('human-root','conversation','OUTBOUND','HUMAN','Prepared HUMAN answer','logical-dispatch',now(),1);
    INSERT INTO whatsapp."ConversationDeliveryPart"(id,"messageId",ordinal,role,payload,"payloadDigest","sourceIdentity","deadlineAt","providerAccountId","providerPhoneNumberId","updatedAt") VALUES
      ('header','human-root',0,'HEADER','{"kind":"TEXT","body":"Shop details and checkout"}','${'a'.repeat(64)}','{"sourceKind":"HUMAN_COMMAND","sourceId":"command","controlRevision":1}',now()+interval '5 minutes','account','phone',now()),
      ('answer','human-root',1,'ANSWER','{"kind":"TEXT","body":"Human answer and checkout"}','${'b'.repeat(64)}','{"sourceKind":"HUMAN_COMMAND","sourceId":"command","controlRevision":1}',now()+interval '5 minutes','account','phone',now());
    UPDATE whatsapp."MerchantConversationSendCommand" SET state='DISPATCH_ADMITTED',"providerDispatchKey"='logical-dispatch',"providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=1,"providerDispatchRestrictionRevision"=0,"outboundMessageId"='human-root',"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=now() WHERE id='command';
    COMMIT;
    UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='physical-header',"providerDispatchAdmittedAt"=now() WHERE id='header';
    UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED',"providerMessageId"='header-meta',"acknowledgedAt"=now() WHERE id='header';`);
  assert.equal(sql(`SELECT state::text FROM whatsapp."MerchantConversationSendCommand" WHERE id='command'`),'DISPATCH_ADMITTED');
  assert.equal(sql(`SELECT status::text||':'||("providerMessageId" IS NULL)::text FROM whatsapp."ConversationMessage" WHERE id='human-root'`),'PENDING:true');
  // Later parts remain children of the original admitted command; no new lease
  // or scalar root provider identity is needed or allowed as a retry authority.
  assert.throws(()=>sql(`UPDATE whatsapp."MerchantConversationSendCommand" SET state='CLAIMED',"leaseToken"='new-lease',"leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=2 WHERE id='command'`),error=>String(error.stderr).includes('admitted command cannot be resent'));
  sql(`UPDATE whatsapp."ConversationDeliveryPart" SET state='READ',"readAt"=now() WHERE id='header';
    UPDATE whatsapp."ConversationDeliveryPart" SET state='ADMITTED',"providerDispatchKey"='physical-answer',"providerDispatchAdmittedAt"=now() WHERE id='answer';
    UPDATE whatsapp."ConversationDeliveryPart" SET state='ACKNOWLEDGED',"providerMessageId"='answer-meta',"acknowledgedAt"=now() WHERE id='answer';
    BEGIN;
    UPDATE whatsapp."ConversationMessage" SET status='SENT',"sentAt"=now() WHERE id='human-root';
    UPDATE whatsapp."MerchantConversationSendCommand" SET state='SENT',"completedAt"=now(),"updatedAt"=now() WHERE id='command';
    COMMIT;`);
  assert.equal(sql(`SELECT cmd.state::text||':'||m.status::text||':'||(m."providerMessageId" IS NULL)::text||':'||(cmd."providerDispatchKey"=m."providerDispatchKey")::text FROM whatsapp."MerchantConversationSendCommand" cmd JOIN whatsapp."ConversationMessage" m ON m.id=cmd."outboundMessageId" WHERE cmd.id='command'`),'SENT:SENT:true:true');
  assert.equal(sql(`SELECT count(*) FROM whatsapp."ConversationDeliveryPart" WHERE "messageId"='human-root' AND "providerMessageId" IS NOT NULL`),'2');
  console.log('PASS ARCH-075 HUMAN original-lease admission, logical root/parts linkage, partial-prefix remains pending, no reclaim, aggregate SENT with null scalar root MetaID');
}finally{docker(['rm','-f',name]);console.log('Invocation-owned disposable PostgreSQL removed');}
