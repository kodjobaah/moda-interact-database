import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const name = `moda-arch066-${randomUUID()}`;
const target='20261108173000_arch066_conversation_product_context';
const root=new URL('../prisma/migrations/',import.meta.url);
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,maxBuffer:16*1024*1024});
const sql=(db,input)=>docker(['exec','-i',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input).trim();
const table='whatsapp."CommerceConversationProductContext"';
function reject(db,statement,state){sql(db,`DO $test$ DECLARE caught text; BEGIN BEGIN ${statement}; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; IF caught <> '${state}' THEN RAISE; END IF; END; IF caught IS NULL THEN RAISE EXCEPTION 'Expected ${state}'; END IF; END $test$;`);}
function seed(db){sql(db,`INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('s1','one.example',now()),('s2','two.example',now()); INSERT INTO whatsapp."Conversation"(id,"shopId",type,"updatedAt") VALUES('c1','s1','PRODUCT_DISCOVERY',now()),('c2','s2','PRODUCT_DISCOVERY',now()),('old','s1','PRODUCT_DISCOVERY',now());`);}
const insert=(c,s)=>`INSERT INTO ${table}("conversationId","shopId","sourceInboundVersion","references","expiresAt","updatedAt") VALUES('${c}','${s}',0,'{"schemaVersion":1,"shopId":"${s}","conversationId":"${c}","platform":"SHOPIFY","references":[],"updatedAt":"2026-11-08T00:00:00Z"}',now()+interval '24 hours',now())`;
function checks(db){
 assert.equal(sql(db,`SELECT count(*) FROM ${table}`),'0'); assert.equal(sql(db,`SELECT count(*) FROM whatsapp."Conversation" WHERE id='old'`),'1');
 sql(db,insert('c1','s1')); reject(db,insert('c1','s1'),'23505'); reject(db,insert('missing','s1'),'23503'); reject(db,insert('c2','missing'),'23503');
 for(const [column,value] of [['schemaVersion','2'],['revision','0'],['sourceInboundVersion','-1']]) reject(db,`UPDATE ${table} SET "${column}"=${value}`,'23514');
 // Many distinct chunks avoid relying on TOAST compression to reject a repeated label.
 reject(db,`UPDATE ${table} SET "references"=(SELECT jsonb_agg(md5(i::text)) FROM generate_series(1,2000)i)`,'23514');
 assert.equal(sql(db,`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp' AND tablename='CommerceConversationProductContext' AND indexdef LIKE '%("shopId", "expiresAt")%'`),'1');
 assert.equal(sql(db,`SELECT "schemaVersion"||':'||revision||':'||"sourceInboundVersion" FROM ${table}`),'1:1:0');
 sql(db,`DELETE FROM whatsapp."Conversation" WHERE id='c1'`); assert.equal(sql(db,`SELECT count(*) FROM ${table}`),'0');
 sql(db,insert('c2','s2'));sql(db,`DELETE FROM commerce."Shop" WHERE id='s2'`);assert.equal(sql(db,`SELECT count(*) FROM ${table}`),'0');
 assert.equal(sql(db,`SELECT count(*) FROM whatsapp."Conversation" WHERE id='old'`),'1');
 console.log(`PASS ${db}: old conversation/no backfill, PK/FKs/cascades/defaults/checks/index`);
}
try{
 docker(['run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fresh','pgvector/pgvector:pg17']);
 let ready=false;for(let n=0;n<60;n++){try{sql('fresh','SELECT 1');ready=true;break;}catch{await delay(1000);}}assert.ok(ready);
 sql('fresh','CREATE DATABASE upgrade');
 const names=readdirSync(root).filter(n=>/^\d{14}_/.test(n)&&n<=target).sort();assert.equal(names.at(-1),target);
 for(const db of ['fresh','upgrade']){
  for(const n of names){if(n===target&&db==='upgrade'){seed(db);const before=sql(db,'SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM whatsapp."Conversation" c');sql(db,readFileSync(new URL(`${n}/migration.sql`,root),'utf8'));assert.equal(sql(db,'SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM whatsapp."Conversation" c'),before);}else sql(db,readFileSync(new URL(`${n}/migration.sql`,root),'utf8'));}
  if(db==='fresh')seed(db);checks(db);
 }
}finally{docker(['rm','-f',name]);console.log('Disposable container removed');}
