/**
 * Safe developer rehearsal (never uses a default DATABASE_URL):
 * 1. Start your own disposable PostgreSQL 15 container, localhost-bound.
 * 2. Create empty databases arch020_test_fresh and arch020_test_upgrade in it.
 * 3. npm run prisma:generate
 * 4. DATABASE_URL=<isolated fresh URL> npm run test:arch020-commerce-capability-migration -- --mode fresh
 * 5. DATABASE_URL=<isolated upgrade URL> npm run test:arch020-commerce-capability-migration -- --mode upgrade
 * 6. Retain logs/revision and remove ONLY the container/databases you created.
 * Commands refuse non-local hosts, unexpected names/URL overrides and nonempty
 * targets. Upgrade stages all predecessors before seeding, then deploys ARCH-020;
 * every existing table's count/hash must remain identical. No automatic reset.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedLegacy, runCases } from './fixtures/arch020-commerce-capability-cases.mjs';

// Fail closed BEFORE making any connection. Never derive a default/shared URL.
const mode=process.argv[process.argv.indexOf('--mode')+1];
let target;
try { target=new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Explicit isolated DATABASE_URL required'); }
assert.ok(['postgres:','postgresql:'].includes(target.protocol));
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname),'Local isolated target required');
assert.ok(['fresh','upgrade'].includes(mode),'Pass --mode fresh|upgrade');
assert.equal(target.pathname,`/arch020_test_${mode}`,'Refusing non-test/shared database name');
assert.equal(target.search,'','Connection parameter overrides are not allowed');
assert.equal(target.hash,'');
const db=new PrismaClient(); const second=new PrismaClient();
const root=new URL('..',import.meta.url);
const migration='20260920182429_arch020_commerce_capability_releases';
let scratch;
const migrate=schema=>{
  try { const out=execFileSync('npx',['--no-install','prisma','migrate','deploy','--schema',schema],{cwd:root,encoding:'utf8',env:process.env});
    // Prisma prints database host/name, never emit connection credentials.
    console.log(out.replaceAll(process.env.DATABASE_URL,'[isolated test URL]'));
  } catch { throw new Error('Migration deploy failed; inspect the isolated database migration log'); }
};
const snapshot=async tables=>{
  const result={};
  for (const {table_schema:s,table_name:t} of tables) {
    const q=`"${s.replaceAll('"','""')}"."${t.replaceAll('"','""')}"`;
    result[`${s}.${t}`]=(await db.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\\n' ORDER BY to_jsonb(r)::text),'')) AS hash FROM ${q} r`))[0];
  } return result;
};
try {
  const existing=await db.$queryRawUnsafe(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`);
  assert.equal(existing[0].n,0,'Target must be completely empty; refusing to reset or reuse data');
  console.log(`ISOLATION ${target.hostname}:${target.port} ${target.pathname.slice(1)} empty database; mode=${mode}`);
  console.log('POSTGRES_VERSION',await db.$queryRawUnsafe('SELECT version()'));
  if (mode==='upgrade') {
    scratch=mkdtempSync(join(tmpdir(),'arch020-predecessor-'));
    cpSync(new URL('prisma/schema.prisma',root),join(scratch,'schema.prisma'));
    mkdirSync(join(scratch,'migrations'));
    for (const name of readdirSync(new URL('prisma/migrations',root))) {
      if (name!==migration) cpSync(new URL(`prisma/migrations/${name}`,root),join(scratch,'migrations',name),{recursive:true});
    }
    migrate(join(scratch,'schema.prisma'));
    await seedLegacy(db);
    const tables=await db.$queryRawUnsafe(`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('commerce','whatsapp','billing','shopify','public','support') AND table_name<>'_prisma_migrations' ORDER BY 1,2`);
    const before=await snapshot(tables);
    const existingIndexes=()=>db.$queryRawUnsafe(`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('commerce','whatsapp','billing','shopify','public','support') AND tablename NOT LIKE 'Commerce%' AND tablename<>'_prisma_migrations' ORDER BY 1,2,3`);
    const indexesBefore=await existingIndexes();
    migrate('prisma/schema.prisma');
    const after=await snapshot(tables);
    assert.deepEqual(await existingIndexes(),indexesBefore); console.log('PRESERVATION_INDEXES',indexesBefore.length,'unchanged');
    assert.deepEqual(after,before); console.log('PRESERVATION',JSON.stringify({before,after}));
  } else { migrate('prisma/schema.prisma'); await seedLegacy(db); }
  const newTables=await db.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema='commerce' AND table_name LIKE 'Commerce%' ORDER BY 1`);
  assert.equal(newTables.length,9);
  for (const {table_name} of newTables) assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int n FROM commerce."${table_name}"`))[0].n,0,'Migration must not seed commerce rows');
  const passed=await runCases(db,second);
  console.log(`ARCH-020 ${mode}: ${passed} behaviour cases passed; no shared data touched.`);
} finally {
  await Promise.all([db.$disconnect(),second.$disconnect()]);
  if (scratch) rmSync(scratch,{recursive:true,force:true});
}
// No automatic reset/drop. The invoking developer removes only the disposable
// test databases/container they created. A second run refuses the populated DB.
