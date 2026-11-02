import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { assertColumnShape } from './fixtures/arch055/assertions.mjs';
import { legacyBaseSql, templateCommandSql } from './fixtures/arch055/legacy-fixtures.mjs';

const args=process.argv.slice(2);
assert.ok(args.length===2 && args[0]==='--mode' && ['fresh','upgrade'].includes(args[1]),'Usage: --mode fresh|upgrade');
const mode=args[1], migrationDir=new URL('../prisma/migrations/',import.meta.url);
const targets=['20261102120000_arch055_rest_read_lifecycle','20261102121000_arch055_human_follow_up_claim_identity','20261102122000_arch055_upload_intake_identity'];
const migrations=readdirSync(migrationDir).filter(n=>/^\d{14}_/.test(n)).sort();
const targetIndexes=targets.map(name=>migrations.indexOf(name));
assert.ok(targetIndexes.every(index=>index>=0),'All ARCH-055 target migrations must exist');
assert.ok(targetIndexes.every((index,position)=>position===0||targetIndexes[position-1]<index),
 'ARCH-055 target migrations must remain in prescribed relative order');
const targetStart=targetIndexes[0],targetEnd=targetIndexes.at(-1);
const migrationThroughTarget=migrations.slice(0,targetEnd+1);
const container=`moda-arch055-${randomUUID()}`, mainDb='arch055_contracts'; let started=false;
const sha=s=>createHash('sha256').update(s).digest('hex');
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const digest=n=>`decode(repeat('${Number(n).toString(16).padStart(2,'0')}',32),'hex')`;
function docker(a,o={}){return execFileSync('docker',a,{encoding:'utf8',maxBuffer:64*1024*1024,...o});}
function sql(db,s,capture=false){return docker(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',...(capture?['-A','-t']:[]),'-U','postgres','-d',db],{input:s}).trim();}
function scalar(db,s){return sql(db,s,true).split('\n').at(-1)?.trim()??'';}
function json(db,s){return JSON.parse(scalar(db,`SELECT ${s};`));}
function applyMany(db,names){for(const name of names){const source=readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8');sql(db,source);console.log(`APPLIED ${name} sha256=${sha(source)}`);}}
function apply(db,name){applyMany(db,[name]);}
function createDb(n){sql('postgres',`CREATE DATABASE "${n}";`);}
function dropDb(n){sql('postgres',`DROP DATABASE IF EXISTS "${n}" WITH (FORCE);`);}
const prior=migrations.slice(0,targetStart);
function applyPrior(db){applyMany(db,prior);}
function seedBase(db,commands=false){
 let base=legacyBaseSql(); sql(db,base);
 if(commands)sql(db,commandFixtures());
}
function commandFixtures(){
 let sql='BEGIN;\n';
 const ids=['accepted','claimed','admitted','unknown','sent','failed','cancelled'];
 const c=(id,key,tail='')=>templateCommandSql(id,key,tail);
 const claim=id=>`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='CLAIMED',"leaseToken"=${q(`lease-${id}`)},"leaseExpiresAt"=now()+interval '5 minutes',"dispatchAttemptCount"=1,"updatedAt"=now() WHERE "id"=${q(id)};`;
 const admit=id=>{const k=`provider-${id}`;return `UPDATE "whatsapp"."ConversationMessage" SET "providerDispatchKey"=${q(k)},"providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=1 WHERE "id"=${q(`msg-${id}`)};
 UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='DISPATCH_ADMITTED',"providerDispatchKey"=${q(k)},"providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=1,"providerDispatchRestrictionRevision"=0,"outboundMessageId"=${q(`msg-${id}`)},"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=now() WHERE "id"=${q(id)};`;};
 for(const name of ids){const id=`a55-${name}`;sql+=`INSERT INTO "commerce"."CheckoutRecovery" ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES (${q(`rec-${id}`)},'a55-shop',${q(`token-${id}`)},now(),now());\n`;
  sql+=`INSERT INTO "whatsapp"."Conversation" ("id","shopId","checkoutRecoveryId","type","updatedAt") VALUES (${q(`conv-${id}`)},NULL,${q(`rec-${id}`)},'RECOVERY',now());\n`;
  sql+=`INSERT INTO "commerce"."RecoveryOutreachAttempt" ("id","checkoutRecoveryId","recipient","sequence","trigger","configuredOfferMode","initiatedBy","initiationKey","claimedAt","updatedAt") VALUES (${q(`attempt-${id}`)},${q(`rec-${id}`)},'447700900055',2,'POST_WINDOW_FOLLOW_UP','NONE','HUMAN',${q(name==='cancelled'?'key-cancelled':`historical-${id}-key`)},now(),now());\n`;
  sql+=`INSERT INTO "whatsapp"."ConversationMessage" ("id","conversationId","direction","senderType","content") VALUES (${q(`msg-${id}`)},${q(`conv-${id}`)},'OUTBOUND','HUMAN','fixture');\n`;
  sql+=`INSERT INTO "whatsapp"."ConversationControlEvent" ("id","conversationId","fromMode","toMode","fromRevision","toRevision") VALUES (${q(`event-${id}`)},${q(`conv-${id}`)},'AI','HUMAN',0,1);\n`;
  sql+=`UPDATE "whatsapp"."Conversation" SET "controlMode"='HUMAN',"controlRevision"=1,"controlChangedAt"=now(),"updatedAt"=now() WHERE "id"=${q(`conv-${id}`)};\n`;
 }
 sql+=c('a55-accepted','key-accepted');
 sql+=c('a55-claimed','key-claimed',claim('a55-claimed'));
 sql+=c('a55-admitted','key-admitted',claim('a55-admitted')+admit('a55-admitted'));
 sql+=c('a55-unknown','key-unknown',claim('a55-unknown')+admit('a55-unknown')+`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='UNKNOWN',"updatedAt"=now() WHERE "id"='a55-unknown';`);
 sql+=c('a55-sent','key-sent',claim('a55-sent')+admit('a55-sent')+`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='SENT',"completedAt"=now(),"updatedAt"=now() WHERE "id"='a55-sent';`);
 sql+=c('a55-failed','key-failed',claim('a55-failed')+`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='FAILED',"failureCode"='fixture_failed',"leaseToken"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=now() WHERE "id"='a55-failed';`);
 sql+=c('a55-cancelled','key-cancelled',`UPDATE "whatsapp"."MerchantConversationSendCommand" SET "state"='CANCELLED',"completedAt"=now(),"updatedAt"=now() WHERE "id"='a55-cancelled';`);
 sql+=`UPDATE "commerce"."RecoveryOutreachAttempt" SET "initiatedBy"=NULL,"initiationKey"=NULL,"claimedAt"=NULL,"updatedAt"=now() WHERE "id"='attempt-a55-cancelled';
 UPDATE "commerce"."RecoveryOutreachAttempt" SET "initiatedBy"='HUMAN',"initiationKey"='later-owner-key',"claimedAt"=now(),"updatedAt"=now() WHERE "id"='attempt-a55-cancelled';
 INSERT INTO "whatsapp"."MerchantConversationSendCommand" ("id","shopId","conversationId","idempotencyKey","payloadSha256","expectedControlRevision","kind","recipientSnapshot","templateName","templateLanguageCode","templateParameters","recoveryOutreachAttemptId","updatedAt") VALUES ('a55-reclaimed','a55-shop','conv-a55-cancelled','later-owner-key',repeat('a',64),1,'RECOVERY_FOLLOW_UP_TEMPLATE','447700900055','approved_template','en_GB','{"body":[]}'::jsonb,'attempt-a55-cancelled',now());`;
 sql+=`INSERT INTO "whatsapp"."MerchantConversationSendCommand" ("id","shopId","conversationId","idempotencyKey","payloadSha256","expectedControlRevision","kind","recipientSnapshot","textBody","updatedAt") VALUES ('a55-human','a55-shop','conv-a55-accepted','key-human',repeat('b',64),1,'HUMAN_TEXT','447700900055','Fixture text',now());`;
 return sql+'\nCOMMIT;';
}
function rowSnapshots(db, stripNew=false){
 const expr=(column)=>`coalesce(jsonb_agg(${column} ORDER BY t."id"),'[]'::jsonb)`;
 return {
  attempts:json(db,`${expr('to_jsonb(t)')} FROM "woocommerce"."WooCommerceRestReadAttempt" t`),
  commands:json(db,`${expr(stripNew?"to_jsonb(t)-'followUpClaimKey'":'to_jsonb(t)')} FROM "whatsapp"."MerchantConversationSendCommand" t`),
  assets:json(db,`${expr(stripNew?"to_jsonb(t)-'intentPurposeKey'":'to_jsonb(t)')} FROM "commerce"."MerchantKnowledgeUploadedAsset" t`),
  revisions:json(db,`${expr('to_jsonb(t)')} FROM "commerce"."MerchantKnowledgeSourceRevision" t`),
  outreachAttempts:json(db,`${expr('to_jsonb(t)')} FROM "commerce"."RecoveryOutreachAttempt" t`),
  messages:json(db,`${expr('to_jsonb(t)')} FROM "whatsapp"."ConversationMessage" t`),
 };
}
function nonTargetCatalog(db){
 return {
  functions:json(db,`coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND NOT (n.nspname='woocommerce' AND p.proname='arch026_rest_read_attempt_guard')`),
  constraints:json(db,`coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',r.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY n.nspname,r.relname,c.conname),'[]'::jsonb) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND NOT (n.nspname='woocommerce' AND r.relname='WooCommerceRestReadAttempt' AND c.conname='WooCommerceRestReadAttempt_consumption_time_check')`),
  indexes:json(db,`coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef) ORDER BY schemaname,tablename,indexname),'[]'::jsonb) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%' AND indexname<>'MerchantKnowledgeSourceRevision_original_intake_asset_key'`),
  triggers:json(db,`coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',r.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY n.nspname,r.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'`),
 };
}
function catalog(db){return {
 funcs:json(db,`coalesce(jsonb_agg(jsonb_build_object('n',p.proname,'d',pg_get_functiondef(p.oid)) ORDER BY p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='woocommerce' AND p.proname IN ('arch026_rest_read_grant_guard','arch026_rest_read_attempt_commit_guard')`),
 triggers:json(db,`coalesce(jsonb_agg(jsonb_build_object('s',n.nspname,'t',c.relname,'n',g.tgname,'d',pg_get_triggerdef(g.oid),'e',g.tgenabled) ORDER BY n.nspname,c.relname,g.tgname),'[]'::jsonb) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='woocommerce' AND c.relname IN ('WooCommerceRestReadAttempt','WooCommerceRestReadGrant')) OR (n.nspname='whatsapp' AND c.relname='MerchantConversationSendCommand')`)
};}
function checkColumns(db){const a=JSON.parse(scalar(db,`SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'name',column_name,'length',character_maximum_length,'nullable',is_nullable='YES','defaultValue',column_default))::text FROM information_schema.columns WHERE (table_schema='whatsapp' AND table_name='MerchantConversationSendCommand' AND column_name='followUpClaimKey') OR (table_schema='commerce' AND table_name='MerchantKnowledgeUploadedAsset' AND column_name='intentPurposeKey')`));assert.equal(a.length,2);assertColumnShape(a,{schema:'whatsapp',table:'MerchantConversationSendCommand',name:'followUpClaimKey',length:255});assertColumnShape(a,{schema:'commerce',table:'MerchantKnowledgeUploadedAsset',name:'intentPurposeKey',length:64});console.log('PASS F01 nullable storage fields');}
function checkCatalog(db,before){const def=scalar(db,`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='WooCommerceRestReadAttempt_consumption_time_check'`);assert.match(def,/FAILED/);const idx=scalar(db,`SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid='commerce."MerchantKnowledgeSourceRevision_original_intake_asset_key"'::regclass`);assert.match(idx,/UNIQUE INDEX/);assert.match(idx,/uploadedAssetId/);assert.match(idx,/CREATE/);assert.match(idx,/FILE_REPLACE/);assert.deepEqual(catalog(db),before);assert.equal(scalar(db,`SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid WHERE c.relname='MerchantConversationSendCommand' AND g.tgname='arch040_command_guard' AND g.tgenabled<>'O'`),'0');console.log('PASS F02 expected constraint/index and existing guards/triggers preserved');}
function rejected(db,label,s,pattern=/23514|23505/){try{sql(db,s);}catch(e){assert.match(String(e.stderr??e.message),pattern,label);return;}assert.fail(`${label} unexpectedly succeeded`);}
function attemptSql(id,n,expiry="now()+interval '5 minutes'"){return `INSERT INTO "woocommerce"."WooCommerceRestReadAttempt" ("id","installationId","shopId","tokenDigest","credentialVersionSnapshot","expiresAt") VALUES (${q(id)},'a55-install','a55-shop',${digest(n)},1,${expiry});`;}
function grantForAttemptSql(attemptId,grantId){return `INSERT INTO "woocommerce"."WooCommerceRestReadGrant" ("id","installationId","shopId","authorizationAttemptId","authorizationAttemptSequence","credentialVersionSnapshot","rotationVersion","status","credentialCiphertext","credentialNonce","credentialAuthTag","encryptionKeyId","providerKeyId","authorizedScope","verifiedAt") VALUES (${q(grantId)},'a55-install','a55-shop',${q(attemptId)},(SELECT "attemptSequence" FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"=${q(attemptId)}),(SELECT "credentialVersion" FROM "woocommerce"."WooCommerceInstallation" WHERE "id"='a55-install'),1,'ACTIVE',decode('a1b2c3','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),'fixture-key','123','read',now());`;}
async function testAttempt(db){
 sql(db,attemptSql('a55-fail-expired',70,"now()+interval '1 second'")+attemptSql('a55-fail-rotated',71)+attemptSql('a55-success-expired',72,"now()+interval '1 second'")+attemptSql('a55-before-created',73)+attemptSql('a55-success-rotated',75));
 await delay(1200);
 const identity=scalar(db,`SELECT jsonb_build_object('id',"id",'install',"installationId",'shop',"shopId",'digest',encode("tokenDigest",'hex'),'seq',"attemptSequence",'version',"credentialVersionSnapshot",'expires',"expiresAt",'created',"createdAt")::text FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"='a55-fail-expired'`);
 sql(db,`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='FAILED',"consumedAt"=now(),"failureCode"='expired' WHERE "id"='a55-fail-expired';`);
 assert.equal(scalar(db,`SELECT "status" FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"='a55-fail-expired'`),'FAILED');assert.equal(scalar(db,`SELECT count(*) FROM "woocommerce"."WooCommerceRestReadGrant"`),'0');
 assert.equal(scalar(db,`SELECT jsonb_build_object('id',"id",'install',"installationId",'shop',"shopId",'digest',encode("tokenDigest",'hex'),'seq',"attemptSequence",'version',"credentialVersionSnapshot",'expires',"expiresAt",'created',"createdAt")::text FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"='a55-fail-expired'`),identity);
 rejected(db,'expired successful attempt',`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='SUCCEEDED',"consumedAt"=now() WHERE "id"='a55-success-expired'`);
 rejected(db,'failure time before creation',`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='FAILED',"consumedAt"="createdAt"-interval '1 second',"failureCode"='bad' WHERE "id"='a55-before-created'`);
 sql(db,attemptSql('a55-no-grant',74));rejected(db,'successful attempt without grant',`BEGIN; UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='SUCCEEDED',"consumedAt"=now() WHERE "id"='a55-no-grant'; SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`);assert.equal(scalar(db,`SELECT "status" FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"='a55-no-grant'`),'PENDING');
 sql(db,`UPDATE "woocommerce"."WooCommerceInstallation" SET "credentialVersion"=2 WHERE "id"='a55-install'; UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='FAILED',"consumedAt"=now(),"failureCode"='rotated' WHERE "id"='a55-fail-rotated';`);
 assert.equal(scalar(db,`SELECT "consumptionTransactionId" IS NOT NULL FROM "woocommerce"."WooCommerceRestReadAttempt" WHERE "id"='a55-fail-rotated'`),'t');
 rejected(db,'stale successful attempt after credential rotation',`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='SUCCEEDED',"consumedAt"=now() WHERE "id"='a55-success-rotated'`);
 rejected(db,'terminal FAILED attempt cannot be retried',`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "status"='FAILED',"consumedAt"=now(),"failureCode"='retry' WHERE "id"='a55-fail-expired'`);
 rejected(db,'failed attempt cannot mint a grant',grantForAttemptSql('a55-fail-expired','a55-forbidden-failed-grant'));
 rejected(db,'REST attempt identity cannot be edited while failing',`UPDATE "woocommerce"."WooCommerceRestReadAttempt" SET "tokenDigest"=${digest(76)},"status"='FAILED',"consumedAt"=now(),"failureCode"='identity_edit' WHERE "id"='a55-before-created'`);
 console.log('PASS F03/F04 failed terminalisation after expiry/rotation; stale success, failed grant, terminal retry, identity edit and grant-transaction guards reject');
}
function testIntakes(db){rejected(db,'second CREATE/FILE_REPLACE intake',`INSERT INTO "commerce"."MerchantKnowledgeSourceRevision" ("id","sourceId","uploadedAssetId","generation","reason","status","updatedAt") VALUES ('a55-second','a55-source','a55-complete-asset',9,'FILE_REPLACE','PENDING',now())`,/23505/);sql(db,`INSERT INTO "commerce"."MerchantKnowledgeSourceRevision" ("id","sourceId","uploadedAssetId","generation","reason","status","requestedUrl","updatedAt") VALUES ('a55-reprocess2','a55-source','a55-complete-asset',9,'REPROCESS','PENDING',NULL,now()),('a55-entitlement2','a55-source','a55-complete-asset',10,'ENTITLEMENT_CHANGE','PENDING',NULL,now()),('a55-null-web','a55-source',NULL,11,'CREATE','PENDING','https://example.invalid/new',now());`);console.log('PASS F05 original-intake partial uniqueness; reprocess/entitlement/null revisions remain legal');}
function testBackfill(db,beforeRows){const rows=JSON.parse(scalar(db,`SELECT json_agg("followUpClaimKey" ORDER BY "followUpClaimKey")::text FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id" LIKE 'a55-%' AND "kind"='RECOVERY_FOLLOW_UP_TEMPLATE'`));assert.deepEqual(rows,['key-accepted','key-admitted','key-cancelled','key-claimed','key-failed','key-sent','key-unknown','later-owner-key']);assert.equal(scalar(db,`SELECT "followUpClaimKey" IS NULL FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='a55-human'`),'t');for(const [id,state] of [['a55-accepted','ACCEPTED'],['a55-claimed','CLAIMED'],['a55-admitted','DISPATCH_ADMITTED'],['a55-unknown','UNKNOWN'],['a55-sent','SENT'],['a55-failed','FAILED'],['a55-cancelled','CANCELLED'],['a55-reclaimed','ACCEPTED']])assert.equal(scalar(db,`SELECT "state"::text FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='${id}'`),state);assert.equal(scalar(db,`SELECT count(*) FROM "commerce"."MerchantKnowledgeUploadedAsset" WHERE "intentPurposeKey" IS NOT NULL`),'0');assert.equal(scalar(db,`SELECT count(*) FROM "commerce"."MerchantKnowledgeUploadedAsset" WHERE "status"='DELETED'`),'1');assert.equal(scalar(db,`SELECT "initiationKey" FROM "commerce"."RecoveryOutreachAttempt" WHERE "id"='attempt-a55-cancelled'`),'later-owner-key');assert.equal(scalar(db,`SELECT "followUpClaimKey" FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='a55-cancelled'`),'key-cancelled');assert.equal(scalar(db,`SELECT "followUpClaimKey" FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='a55-reclaimed'`),'later-owner-key');assert.deepEqual(rowSnapshots(db,true),beforeRows,'U01/U02/U04 every pre-existing column and row is unchanged, including attempt/provider evidence');console.log('PASS U01/U02 actual cancellation/reclaim pair backfills each command from its own key; U04 legacy upload/history rows unchanged');}
async function ready(){for(let i=0;i<90;i++){try{docker(['exec',container,'pg_isready','-q','-U','postgres','-d',mainDb]);return;}catch{await delay(500);}}throw Error('PostgreSQL container did not become ready');}
async function main(){try{
 docker(['run','--detach','--name',container,'--network','none','-e','POSTGRES_PASSWORD=arch055','-e',`POSTGRES_DB=${mainDb}`,'pgvector/pgvector:pg17']);started=true;await ready();console.log(`ISOLATION image=pgvector/pgvector:pg17 network=none container=${container}`);
 if(process.env.ARCH055_TEST_FORCE_TOP_LEVEL_ASSERTION==='1')assert.fail('ARCH-055 forced top-level assertion failure for cleanup validation');
 const db=mainDb;applyPrior(db);if(mode==='upgrade')seedBase(db,true);const before=catalog(db);const beforeNonTarget=nonTargetCatalog(db);const beforeRows=mode==='upgrade'?rowSnapshots(db,false):null;
 applyMany(db,migrationThroughTarget.slice(targetStart));
 checkColumns(db);checkCatalog(db,before);assert.deepEqual(nonTargetCatalog(db),beforeNonTarget,'U06 no unrelated schema functions, constraints, indexes, or triggers changed');console.log('PASS U06 non-target catalogue snapshot preserved');
 if(mode==='fresh')seedBase(db,true);else testBackfill(db,beforeRows);
 await testAttempt(db);testIntakes(db);
 const failDb='arch055_rollback';createDb(failDb);applyPrior(failDb);apply(failDb,targets[0]);seedBase(failDb,true);const rollbackRows=rowSnapshots(failDb,false);
 const m2=readFileSync(new URL(`../prisma/migrations/${targets[1]}/migration.sql`,import.meta.url),'utf8').replace('UPDATE "whatsapp"."MerchantConversationSendCommand"\n  SET "followUpClaimKey" = "idempotencyKey"','SELECT 1/0;\n UPDATE "whatsapp"."MerchantConversationSendCommand" SET "followUpClaimKey"="idempotencyKey"');
 try{sql(failDb,m2);assert.fail('rollback injection should fail');}catch(e){assert.match(String(e.stderr??e.message),/22012|division by zero/);}
 assert.equal(scalar(failDb,`SELECT count(*) FROM information_schema.columns WHERE table_schema='whatsapp' AND table_name='MerchantConversationSendCommand' AND column_name='followUpClaimKey'`),'0');assert.equal(scalar(failDb,`SELECT tgenabled FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid WHERE c.relname='MerchantConversationSendCommand' AND g.tgname='arch040_command_guard'`),'O');assert.deepEqual(rowSnapshots(failDb,false),rollbackRows,'U03 failed migration restores all seeded rows');apply(failDb,targets[1]);console.log('PASS U03 rollback restores column, data, and original enabled trigger; retry succeeds');dropDb(failDb);
 const dup='arch055_duplicate';createDb(dup);applyPrior(dup);applyMany(dup,targets.slice(0,2));seedBase(dup,false);sql(dup,`INSERT INTO "commerce"."MerchantKnowledgeSourceRevision" ("id","sourceId","uploadedAssetId","generation","reason","status","updatedAt") VALUES ('a55-dupe','a55-source','a55-complete-asset',12,'FILE_REPLACE','PENDING',now());`);const duplicateRows=rowSnapshots(dup,false);
 try{apply(dup,targets[2]);assert.fail('duplicate history must block migration');}catch(e){assert.match(String(e.stderr??e.message),/23505|1 assets/);}
 assert.equal(scalar(dup,`SELECT count(*) FROM information_schema.columns WHERE table_schema='commerce' AND table_name='MerchantKnowledgeUploadedAsset' AND column_name='intentPurposeKey'`),'0');assert.equal(scalar(dup,`SELECT count(*) FROM pg_indexes WHERE indexname='MerchantKnowledgeSourceRevision_original_intake_asset_key'`),'0');assert.deepEqual(rowSnapshots(dup,false),duplicateRows,'U05 failed migration preserves all duplicate intake history and seeded rows');console.log('PASS U05 duplicate intake blocks migration transaction without adding schema/index or changing history');dropDb(dup);
 console.log(`PASS ARCH-055 PostgreSQL ${mode}; migrations through target; cleanup verified`);
 }finally{if(started){docker(['rm','--force','--volumes',container]);console.log(`CLEANUP ${container}`);}}}
await main();
