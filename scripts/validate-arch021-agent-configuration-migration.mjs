import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,cpSync,readdirSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {seedLegacy} from './fixtures/arch020-commerce-capability-cases.mjs';
import {runCases} from './fixtures/arch021-agent-configuration-cases.mjs';
const mode = process.argv[process.argv.indexOf('--mode') + 1];
assert.ok(['fresh','upgrade'].includes(mode), 'Pass --mode fresh|upgrade');
let target; try { target = new URL(process.env.DATABASE_URL ?? ''); } catch { throw new Error('Explicit isolated DATABASE_URL required'); }
assert.ok(['postgres:','postgresql:'].includes(target.protocol));
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname), 'Local isolated target required');
assert.equal(target.pathname, `/arch021_test_${mode}`, 'Refusing non-test/shared database name');
assert.equal(target.search, '', 'Connection parameter overrides are not allowed');
const db = new PrismaClient(); const second = new PrismaClient();
const root = new URL('..', import.meta.url); const migration = '20260923150000_arch021_agent_configuration'; let scratch;
const migrate = schema => execFileSync('npx',['--no-install','prisma','migrate','deploy','--schema',schema], {cwd:root, encoding:'utf8', env:process.env}).replaceAll(process.env.DATABASE_URL,'[isolated test URL]');
const snapshot = async tables => Object.fromEntries(await Promise.all(tables.map(async ({table_schema:s,table_name:t}) => { const q=`"${s}"."${t}"`; const row=(await db.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),'')) AS hash FROM ${q} r`))[0]; return [`${s}.${t}`,row]; })));
try {
  const empty = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`); assert.equal(empty[0].n,0,'Target must be empty; refusing reset/reuse');
  let before; let predecessorSchema = null;
  if (mode === 'upgrade') {
    scratch=mkdtempSync(join(tmpdir(),'arch021-predecessor-')); predecessorSchema=join(scratch,'schema.prisma'); cpSync(new URL('prisma/schema.prisma',root),predecessorSchema); mkdirSync(join(scratch,'migrations'));
    for (const name of readdirSync(new URL('prisma/migrations',root))) if (name !== migration) cpSync(new URL(`prisma/migrations/${name}`,root),join(scratch,'migrations',name),{recursive:true});
    migrate(predecessorSchema); await seedLegacy(db);
    const tables=await db.$queryRawUnsafe(`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') AND table_name<>'_prisma_migrations' ORDER BY 1,2`); before=await snapshot(tables);
    const indexes=await db.$queryRawUnsafe(`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`);
    migrate('prisma/schema.prisma'); assert.deepEqual(await snapshot(tables),before); const afterIndexes=await db.$queryRawUnsafe(`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`); const afterIndexMap=new Map(afterIndexes.map(index => [`${index.schemaname}.${index.tablename}.${index.indexname}`, index.indexdef])); for (const index of indexes) assert.equal(afterIndexMap.get(`${index.schemaname}.${index.tablename}.${index.indexname}`), index.indexdef, `Predecessor index changed or missing: ${index.indexname}`); console.log('UPGRADE_PRESERVATION passed');
  } else { migrate('prisma/schema.prisma'); await seedLegacy(db); }
  const tables=await db.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema='commerce' AND table_name IN ('CommerceModelCatalogueEntry','CommercePlatformModelSelection','CommerceShopModelSelection','CommercePromptTemplateCategory','CommercePromptTemplate','CommercePromptTemplateRevision','CommerceAgentPrompt','CommerceAgentPromptRevision','CommercePlatformPromptPointer','CommerceShopPromptPointer')`); assert.equal(tables.length,10);
  const passed=await runCases(db,second); console.log(`ARCH-021 ${mode}: ${passed} behaviour cases passed; isolated target preserved.`);
} finally { await Promise.all([db.$disconnect(),second.$disconnect()]); if(scratch) rmSync(scratch,{recursive:true,force:true}); }
