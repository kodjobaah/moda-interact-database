import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const require=createRequire(import.meta.url);
const prisma=require.resolve('prisma/build/index.js');
const name=`moda-arch075-history-${randomUUID()}`;
const target='20261113004310_arch075_ordered_delivery_parts';
const temporary=mkdtempSync(join(tmpdir(),'moda-arch075-history-'));
const fixture=join(temporary,'prisma');
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
const sql=input=>docker(['exec','-i',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','fixture'],input).trim();
try{
  docker(['run','-d','--name',name,'--label','moda.task=ARCH-075-DATABASE-001','-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=fixture','pgvector/pgvector:pg17']);
  let ready=false;for(let i=0;i<30;i++){try{sql('SELECT 1');ready=true;break;}catch{await delay(500);}}
  assert.ok(ready,'invocation-owned PostgreSQL becomes ready');
  const mapping=docker(['port',name,'5432/tcp']).trim();
  assert.match(mapping,/^127\.0\.0\.1:\d+$/);
  const databaseUrl=`postgresql://postgres:fixture-only@${mapping}/fixture`;
  const parsed=new URL(databaseUrl);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/fixture');
  mkdirSync(join(fixture,'migrations'),{recursive:true});
  cpSync(new URL('../prisma/schema.prisma',import.meta.url),join(fixture,'schema.prisma'));
  const source=new URL('../prisma/migrations/',import.meta.url);
  for(const entry of readdirSync(source).filter(entry=>entry!==target))cpSync(new URL(entry,source),join(fixture,'migrations',entry),{recursive:true});
  const deploy=()=>execFileSync(process.execPath,[prisma,'migrate','deploy','--schema',join(fixture,'schema.prisma')],{encoding:'utf8',env:{...process.env,DATABASE_URL:databaseUrl},maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']});
  deploy();
  // This synthetic historical audit exists ONLY in the invocation-owned fixture.
  // It proves deploy behavior without repairing or rewriting any hosted history.
  sql(`INSERT INTO public._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count) VALUES('${randomUUID()}','${'a'.repeat(64)}','fixture_applied_but_missing_local_file',now(),1)`);
  const before=sql(`SELECT checksum||':'||finished_at::text FROM public._prisma_migrations WHERE migration_name='fixture_applied_but_missing_local_file'`);
  cpSync(new URL(target,source),join(fixture,'migrations',target),{recursive:true});
  const output=deploy();assert.ok(output.includes(target));
  assert.equal(sql(`SELECT checksum||':'||finished_at::text FROM public._prisma_migrations WHERE migration_name='fixture_applied_but_missing_local_file'`),before);
  assert.equal(sql(`SELECT count(*) FROM public._prisma_migrations WHERE migration_name='${target}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`),'1');
  assert.equal(sql(`SELECT to_regclass('whatsapp."ConversationDeliveryPart"') IS NOT NULL`),'t');
  assert.ok(deploy().includes('No pending migrations'));
  console.log('PASS ARCH-075 real Prisma migrate deploy applies pending additive migration with historical applied-but-missing file, preserves historical audit, and reruns as no-op');
}finally{docker(['rm','-f',name]);rmSync(temporary,{recursive:true,force:true});console.log('Invocation-owned disposable PostgreSQL and migration fixture removed');}
