import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
const name = `moda-arch076-sender-${randomUUID()}`;
const temporary = mkdtempSync(join(tmpdir(), 'moda-arch076-sender-'));
const fixture = join(temporary, 'prisma');
const source = new URL('../prisma/migrations/', import.meta.url);
const target = '20261115201000_arch076_r15_clause_moderation';
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

const q = v => `'${String(v).replaceAll("'", "''")}'`;
const sha = v => createHash('sha256').update(v,'utf8').digest('hex');
function checks(db) {
  sql(db, `INSERT INTO whatsapp."WhatsAppPoolSender"("providerPhoneNumberId","providerAccountId","verifiedAt") VALUES ('222','111',now());
    INSERT INTO whatsapp."RecoverySenderThread"(id,"canonicalRecipient","providerPhoneNumberId") VALUES ('thread-a','15550000001','222');
    INSERT INTO whatsapp."RecoverySenderRoute"(id,"shopId","threadId","canonicalRecipient","providerPhoneNumberId") VALUES ('route-a','shop-a','thread-a','15550000001','222');
    INSERT INTO whatsapp."RecoverySenderAssignment"("conversationId","routeId") VALUES ('conversation-a','route-a');`);
  const slices=[];
  for(const value of ['abc','😀abc','é\r\né Friday?','2. 😀 Friday?','中文 Friday?']) {
    for(let start=0;start<value.length;start++) for(let end=start+1;end<=value.length;end++) {
      const split=i=>i>0&&i<value.length&&/[\uD800-\uDBFF]/.test(value[i-1])&&/[\uDC00-\uDFFF]/.test(value[i]);
      slices.push(`COALESCE(whatsapp.arch076_utf16_slice(${q(value)},${start},${end}),'INVALID') IS NOT DISTINCT FROM ${q(split(start)||split(end)?'INVALID':value.slice(start,end))}`);
    }
  }
  check(sql(db,`SELECT ${slices.join(' AND ')}`),'t');
  cases+=slices.length-1;
  const rawAudio={content:{type:'audio',mediaId:'fixture-media'}};
  const sourceHash=sql(db,`SELECT whatsapp.arch076_r15_audio_source_sha256(${q(JSON.stringify(rawAudio))}::jsonb)`);
  for(const role of ['NEW_QUESTION','CLARIFY','SELECT_ONLY']) {
    const id=`direct-audio-${role}`;
    const proof={schemaVersion:1,verified:true,sourceSha256:sourceHash,providerMessageId:id,mediaIdSha256:sha('fixture-media'),mediaSha256:null,transcriptSha256:sha('Friday?'),provider:'fixture-speech',model:'fixture-transcription',durationMs:1000,operationRows:[{id:'speech-operation',version:1}]};
    const decision={schemaVersion:1,role,currentInboundProviderMessageId:id,originalTurnId:null,originalInboundProviderMessageId:null,associatedMessages:{originalMessageId:`${id}-message`,currentMessageId:`${id}-message`},audioCurrent:proof,audioOriginal:proof};
    const statement=`INSERT INTO whatsapp."RecoveryBasketRoutingTurn"("inboundProviderMessageId","threadId","occurredAt","expiresAt","routingDecision","inputJson","moderationJson") VALUES (${q(id)},'thread-a',now(),now()+interval '1 hour',${q(JSON.stringify(decision))}::jsonb,${q(JSON.stringify(rawAudio))}::jsonb,${q(JSON.stringify({audioTranscript:{text:'Friday?',provenance:proof}}))}::jsonb)`;
    if(role==='SELECT_ONLY') reject(db,statement,'R15_AUDIO_ATTESTATION_INVALID');
    else {sql(db,statement);check(sql(db,`SELECT "parentProviderMessageId" IS NULL FROM whatsapp."RecoveryBasketRoutingTurn" WHERE "inboundProviderMessageId"=${q(id)}`),'t');}
  }
  let n=0;
  function scenario({text='2. Friday?', stage=false, mutate=()=>{}, full=true, original=true, kind='TEXT', sender='CUSTOMER', subject='CUSTOMER_MESSAGE', fullDecision='ALLOW', audioVerified=true, audioMutate=()=>{}, originalAudio=false, forgeBoth=false, missingTranscript=false, bothMutate=()=>{}, transcriptionState='COMPLETED', actualMediaId='fixture-media', transcriptValue=text}={}) {
    const key=`case${n++}`, root=`${key}-root`, current=`${key}-current`, prompt=stage?`${key}-prompt`:root;
    const message=`${key}-message`, originalMessage=`${key}-original`, fullId=`${key}-full`, originalId=`${key}-original-assessment`, clauseId=`${key}-clause`;
    const clause='Friday?', start=text.indexOf(clause), digest=sha(clause);
    const d={schemaVersion:1,role:'SELECT_AND_QUESTION',currentInboundProviderMessageId:current,originalTurnId:root,originalInboundProviderMessageId:root,promptTurnId:prompt,confirmedPromptProviderMessageId:`${prompt}-receipt`,selectedAssignmentConversationId:'conversation-a',associatedMessages:{originalMessageId:originalMessage,currentMessageId:message},originalTextSha256:sha('When?'),clause:{start,end:start+clause.length,sha256:digest},moderation:{current:{id:fullId,hash:sha(text)},original:{id:originalId,hash:sha('When?')},clause:{id:clauseId,hash:digest}}};
    const audio={schemaVersion:1,verified:true,sourceSha256:sourceHash,providerMessageId:current,mediaIdSha256:sha('fixture-media'),mediaSha256:null,transcriptSha256:sha(String(transcriptValue)),provider:'fixture-speech',model:'fixture-transcription',durationMs:1000,operationRows:[{id:'speech-operation',version:1}]};
    bothMutate(audio);
    if(forgeBoth)audio.sourceSha256='f'.repeat(64);
    const rootAudio={...audio,providerMessageId:root,transcriptSha256:sha('When?')};
    if(originalAudio)d.audioOriginal=rootAudio;
    if(kind==='TRANSCRIPT'&&audioVerified) {d.audioCurrent={...audio};audioMutate(d.audioCurrent);}
    mutate(d);
    const assessment=(id,msg,hash,inputKind='TEXT')=>`INSERT INTO whatsapp."ConversationModerationAssessment"(id,"shopId","conversationId",subject,"conversationMessageId","contentSha256","inputKind","requestedModel","policyVersion","updatedAt") VALUES (${q(id)},'shop-a','conversation-a',${q(subject)},${q(msg)},${q(hash)},${q(inputKind)},'fixture-model','fixture-policy',now());`;
    const allow=(id,outcome='ALLOW')=>`UPDATE whatsapp."ConversationModerationAssessment" SET decision='CHECKING',"attemptCount"=1,"leaseToken"='fixture-lease',"leaseExpiresAt"=now()+interval '1 minute' WHERE id=${q(id)}; SELECT whatsapp.arch040_moderation_complete(${q(id)},'fixture-lease',${q(outcome)},'fixture-model',${outcome==='BLOCK'?'true':'false'},'{}','{}',NULL,'fixture-request',NULL);`;
    const t=(id,parent=null,decision=null)=>`INSERT INTO whatsapp."RecoveryBasketRoutingTurn"("inboundProviderMessageId","threadId","routeId","occurredAt","expiresAt","parentProviderMessageId","routingDecision","inputJson","moderationJson") VALUES (${q(id)},'thread-a','route-a',now(),now()+interval '1 hour',${parent?q(parent):'NULL'},${decision?q(JSON.stringify(decision))+'::jsonb':'NULL'},${(id===current&&kind==='TRANSCRIPT'||id===root&&originalAudio)?q(JSON.stringify({content:{type:'audio',mediaId:'fixture-media'}}))+'::jsonb':'NULL'},${(id===current&&kind==='TRANSCRIPT'||id===root&&originalAudio)?q(JSON.stringify({audioTranscript:{...(missingTranscript?{}:{text:id===root?'When?':transcriptValue}),provenance:id===root?rootAudio:audio}}))+'::jsonb':'NULL'});`;
    const sent=`UPDATE whatsapp."RecoveryBasketRoutingTurn" SET state='PROMPT_ADMITTED',"promptAdmittedAt"=now(),"promptSentAt"=now(),"promptScopeRouteId"='route-a',"promptProviderMessageId"=${q(prompt+'-receipt')} WHERE "inboundProviderMessageId"=${q(prompt)};`;
    const resolve=id=>`UPDATE whatsapp."RecoveryBasketRoutingTurn" SET state='RESOLVED',"resolvedAt"=now(),"selectedConversationId"='conversation-a',"resolutionInboundProviderMessageId"=${q(current)},"inputJson"=NULL,"moderationJson"=NULL WHERE "inboundProviderMessageId"=${q(id)};`;
    return { key, clauseId, message, fullId, d, statement:`BEGIN; ${t(root,null,{schemaVersion:1,role:'CLARIFY',...(originalAudio?{audioCurrent:rootAudio}:{})})} ${stage?t(prompt,root,{schemaVersion:1,role:'CLARIFY'}):''} ${sent} ${t(current,root,d)}
      INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"contentType","transcriptionStatus","providerMessageId","providerMediaId","transcriptionProvider","transcriptionModel","mediaDurationMs","transcriptionCompletedAt") VALUES (${q(originalMessage)},'conversation-a','INBOUND','CUSTOMER','When?',${originalAudio?"'AUDIO','COMPLETED'":"'TEXT','NOT_REQUIRED'"},${q(root)},${originalAudio?"'fixture-media','fixture-speech','fixture-transcription',1000,now()":'NULL,NULL,NULL,NULL,NULL'}),(${q(message)},'conversation-a','INBOUND',${q(sender)},${q(text)},${kind==='TRANSCRIPT'?"'AUDIO'":"'TEXT'"},${kind==='TRANSCRIPT'?q(transcriptionState):"'NOT_REQUIRED'"},${q(current)},${kind==='TRANSCRIPT'?`${q(actualMediaId)},'fixture-speech','fixture-transcription',1000,now()`:'NULL,NULL,NULL,NULL,NULL'});
      ${original?assessment(originalId,originalMessage,sha('When?'),originalAudio?'TRANSCRIPT':'TEXT')+allow(originalId):''}
      ${full?assessment(fullId,message,sha(text),kind)+allow(fullId,fullDecision):''}
      ${resolve(root)} ${resolve(current)} ${assessment(clauseId,message,digest,kind)} ${allow(clauseId)} COMMIT;`};
  }
  for(const args of [{},{stage:true},{text:'😀 2. Friday?'},{text:'2. 😀 Friday?'},{kind:'TRANSCRIPT',text:'😀 2. Friday?',stage:true},{originalAudio:true},{originalAudio:true,kind:'TRANSCRIPT'}]) {
    const s=scenario(args); sql(db,s.statement);
    check(sql(db,`SELECT count(*) FROM whatsapp."ConversationModerationAssessment" WHERE "conversationMessageId"=${q(s.message)} AND decision='ALLOW'`),'2');
    check(sql(db,`SELECT content FROM whatsapp."ConversationMessage" WHERE id=${q(s.message)}`),args.text??'2. Friday?');
    reject(db,`UPDATE whatsapp."ConversationModerationAssessment" SET "contentSha256"=${q('f'.repeat(64))} WHERE id=${q(s.clauseId)}`,'ERROR');
  }
  for(const args of [{kind:'TRANSCRIPT',transcriptValue:123},{kind:'TRANSCRIPT',transcriptValue:' \t\r\n'},{kind:'TRANSCRIPT',transcriptValue:'\u00a0\ufeff'},{kind:'TRANSCRIPT',transcriptionState:'PENDING'},{kind:'TRANSCRIPT',transcriptionState:'FAILED'},{kind:'TRANSCRIPT',actualMediaId:'foreign-media'},{kind:'TRANSCRIPT',bothMutate:p=>{p.operationRows=[{id:'speech-operation',version:1,text:'private'}];}},{kind:'TRANSCRIPT',bothMutate:p=>{p.text='private';}},{kind:'TRANSCRIPT',bothMutate:p=>{p.transcriptSha256='f'.repeat(64);}},{kind:'TRANSCRIPT',forgeBoth:true},{kind:'TRANSCRIPT',missingTranscript:true},{sender:'AGENT'},{subject:'AGENT_MESSAGE'},{subject:'AUTOMATION_MESSAGE'},{subject:'HUMAN_COMMAND'},{full:false},{original:false},{fullDecision:'BLOCK'},{kind:'TRANSCRIPT',audioVerified:false},{kind:'TRANSCRIPT',audioMutate:p=>{p.transcriptSha256='f'.repeat(64);}},{kind:'TRANSCRIPT',audioMutate:p=>{p.verified=false;}},
    ...['sourceSha256','mediaIdSha256','providerMessageId','model','provider'].map(field=>({kind:'TRANSCRIPT',audioMutate:p=>{p[field]='forged';}})),
    {kind:'TRANSCRIPT',audioMutate:p=>{p.operationRows=[];}}, {kind:'TRANSCRIPT',audioMutate:p=>{p.text='private';}}, {kind:'TRANSCRIPT',audioMutate:p=>{p.operationRows=[{id:'speech-operation',version:1,text:'private'}];}},
    ...['SELECT_ONLY','NEW_QUESTION','CLARIFY'].map(role=>({mutate:d=>{d.role=role;}})),
    ...['currentInboundProviderMessageId','originalTurnId','originalInboundProviderMessageId','promptTurnId','confirmedPromptProviderMessageId','selectedAssignmentConversationId'].map(field=>({mutate:d=>{d[field]='forged';}})),
    ...['start','end'].flatMap(field=>[-1,0.5,999999999,'1',null].map(value=>({mutate:d=>{d.clause[field]=value;}}))),
    {mutate:d=>{d.associatedMessages.currentMessageId='forged';}}, {mutate:d=>{d.associatedMessages.originalMessageId='forged';}},
    {mutate:d=>{d.moderation.current.id='forged';}}, {mutate:d=>{d.moderation.original.id='forged';}},
    {mutate:d=>{d.moderation.clause.id='forged';}}, {mutate:d=>{d.clause.sha256='f'.repeat(64);}},
    {mutate:d=>{d.moderation.clause.hash='f'.repeat(64);}},
    {text:'😀 2. Friday?',mutate:d=>{d.clause.start=1;}}]) {
    const s=scenario(args); reject(db,s.statement,(args.audioMutate||args.forgeBoth||args.missingTranscript||args.bothMutate||Object.hasOwn(args,'transcriptValue'))?'R15_AUDIO_ATTESTATION_INVALID':'ARCH040');
  }
  // Released assignment/control changes do not invalidate historical attestation.
  sql(db,`UPDATE whatsapp."RecoverySenderAssignment" SET "releasedAt"=now() WHERE "conversationId"='conversation-a'; UPDATE whatsapp."RecoverySenderRoute" SET "closedAt"=now() WHERE id='route-a';`);
  sql(db,`UPDATE whatsapp."ConversationModerationAssessment" SET "updatedAt"=now() WHERE decision='ALLOW';`);
  check(sql(db,`SELECT count(*)>0 FROM whatsapp."ConversationModerationAssessment" WHERE decision='ALLOW'`),'t');
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
  check(sql('upgrade','SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'),'82');
  seed('upgrade'); const before=preservation('upgrade');
  cpSync(new URL(target,source),join(fixture,'migrations',target),{recursive:true});
  command('fresh',['migrate','deploy']); command('upgrade',['migrate','deploy']);
  check(preservation('upgrade'),before);
  seed('fresh');
  for(const db of ['fresh','upgrade']){
    check(sql(db,'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'),'83');
    assert.ok(command(db,['migrate','deploy']).includes('No pending migrations'));
    checks(db);
    console.log(`PASS ${db}: full migration history and exact R15 clause attestation`);
  }
  console.log(`PASS ARCH-076-DATABASE-001 R15 ${cases} assertions; no hosted DB/provider calls`);
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
