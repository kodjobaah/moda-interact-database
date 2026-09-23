import {columns,enums,indexFields} from './fixtures/arch020-commerce-schema-contract.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const schema=read('prisma/schema.prisma');
const names=['CommerceCapability','CommerceCapabilityRevision','CommerceRelease','CommerceReleaseCapability','CommerceReleasePointer','CommerceAuditEvent','CommerceConversationGrant','CommerceTool','CommerceToolRevision'];
const dirs=readdirSync(new URL('../prisma/migrations',import.meta.url)).filter(s=>s.endsWith('_arch020_commerce_capability_releases'));
assert.equal(dirs.length,1);
const sql=read(`prisma/migrations/${dirs[0]}/migration.sql`);
const erd=read('docs/generated/prisma-erd.puml');
for(const n of names){
 const model=schema.match(new RegExp(`model ${n} \\{([\\s\\S]*?)\\n\\}`))?.[1];
 assert.ok(model,`${n} missing`); assert.match(model, /@@schema\("commerce"\)/);
 assert.ok(sql.includes(`CREATE TABLE "commerce"."${n}"`));
 assert.ok(erd.includes(`entity "${n}"`),`${n} ERD missing`);
}
assert.equal((sql.match(/CREATE TABLE /g)||[]).length,9);
assert.equal((sql.match(/CREATE TYPE /g)||[]).length,4);
assert.doesNotMatch(sql,/DROP\s+(TABLE|SCHEMA|INDEX)|TRUNCATE|ALTER INDEX|RENAME CONSTRAINT|ALTER TABLE "billing"/i);
assert.doesNotMatch(sql,/^\s*(INSERT INTO|UPDATE|DELETE FROM) /m,'Migration must not seed/backfill existing rows');
for(const f of ['arch020_current_snapshot','arch020_object','arch020_string','arch020_strings','arch020_bindings','arch020_grant_tools','arch020_definition','arch020_response_contract','arch020_immutable','arch020_identity','arch020_revision','arch020_member','arch020_pointer','arch020_audit','arch020_grant','arch020_parent_owner']) assert.ok(sql.includes(`CREATE FUNCTION commerce.${f}(`),f);
for(const trigger of ['capability_identity','tool_identity','capability_revision','tool_revision','member_insert','pointer','audit_insert','grant_insert','conversation_owner','recovery_owner','release_immutable','member_immutable','audit_immutable','grant_immutable']) assert.ok(sql.includes(`CREATE TRIGGER arch020_${trigger} `),trigger);
for(const bytes of [8192,16384,65536]) assert.ok(sql.includes(`>${bytes}`)||sql.includes(`<=${bytes}`));
assert.ok(sql.includes('ON DELETE CASCADE ON UPDATE RESTRICT'));
assert.ok(sql.includes('"CommerceCapability_one_base_idx"'));
assert.ok(sql.includes('FOR UPDATE'));
assert.ok(sql.includes('FOR SHARE'));
assert.ok(sql.includes('complete tool union'));
assert.ok(sql.includes('REFERENCES "public"."PlatformAdmin"'));
for(const [name,fields] of Object.entries(columns)) {
 const model=schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))[1];
 for(const entry of fields.split(' ')) {
   const [field,type]=entry.split(':');
   const line=model.split('\n').find(l=>l.trim().startsWith(`${field} `));
   assert.ok(line,`${name}.${field} missing`);
   const optional=type.endsWith('?'); const base=type.replace('?', '');
   const prismaType=base==='text'||base.startsWith('varchar')?'String':base==='int4'?'Int':base==='bool'?'Boolean':base==='timestamptz'?'DateTime':base==='jsonb'?'Json':base;
   assert.equal(line.trim().split(/\s+/)[1],prismaType+(optional?'?':''),`${name}.${field} type/nullability`);
   if(base==='timestamptz') assert.ok(line.includes('@db.Timestamptz(3)'));
   if(base==='text') assert.ok(line.includes('@db.Text'));
   if(base==='jsonb') assert.ok(line.includes('@db.JsonB'));
   if(base.startsWith('varchar')) assert.ok(line.includes(`@db.VarChar(${base.slice(7)})`));
   if(field==='responseContract'||field==='responseContractHash') assert.ok(!line.includes('@default('),'C16 requires explicit release response fields');
   if(field==='id') assert.ok(line.includes('@default(cuid())'));
   if(field==='createdAt'||field==='updatedAt') assert.ok(line.includes('@default(now())'));
   if(field==='updatedAt') assert.ok(line.includes('@updatedAt'));
 }
 for(const fields of indexFields[name]) {
   if(fields.includes(',')) assert.ok(model.replaceAll(' ','').includes(`[${fields}]`),`${name} index ${fields}`);
   else assert.ok(model.includes(`@@index([${fields}])`)||model.split('\n').some(l=>l.trim().startsWith(`${fields} `)&&l.includes('@unique')),`${name} index ${fields}`);
 }
}
for(const [name,values] of Object.entries(enums)) {
 const block=schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`))[1];
 assert.deepEqual(block.split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('@@')).slice(0,values.length),values);
}
console.log('ARCH-020 static schema/migration/ERD checks passed (no database connection).');
