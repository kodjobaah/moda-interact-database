import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tables,enums,auditActions,functions,triggerNames,checkNames,requiredFields} from './fixtures/arch021-agent-configuration-schema-contract.mjs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const sql = read('prisma/migrations/20260923150000_arch021_agent_configuration/migration.sql');
const erd = read('docs/generated/prisma-erd.puml');
assert.equal((sql.match(/CREATE TABLE "commerce"\."Commerce/g) || []).length, 10);
assert.equal((sql.match(/CREATE TYPE "commerce"\."Commerce(ModelProvider|AgentPromptScope|PromptRevisionStatus)"/g) || []).length, 3);
for (const name of tables) { assert.match(schema, new RegExp(`model ${name} \\{`), `${name} missing from Prisma schema`); assert.match(sql, new RegExp(`CREATE TABLE "commerce"\."${name}"`)); assert.match(erd, new RegExp(`entity "${name}"`)); for (const field of requiredFields[name]) assert.match(schema, new RegExp(`^\\s*${field}\\s`, 'm'), `${name}.${field} missing`); }
for (const name of enums) assert.match(schema, new RegExp(`enum ${name} \\{`));
for (const action of auditActions) assert.match(schema, new RegExp(`^\\s*${action}\\s*$`, 'm'));
for (const name of ['CommerceAgentPrompt_one_platform_idx','CommerceAgentPrompt_one_shop_idx',...checkNames]) assert.match(sql, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} missing`);
for (const name of [...functions,...triggerNames]) assert.match(sql, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} missing`);
assert.match(sql, /length\("promptText"\) <= 32000/); assert.match(sql, /\^\[0-9a-f\]\{64\}\$/); assert.match(sql, /publication_shape_check/);
assert.doesNotMatch(sql, /^\s*(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\b/m, 'migration contains business-data DML');
assert.doesNotMatch(sql, /DROP\s+(TABLE|SCHEMA|INDEX)|ALTER TABLE .*\b(RENAME)\b/i, 'migration contains destructive DDL');
assert.match(sql, /DROP\s+CONSTRAINT\s+arch020_audit_targets/, 'migration must replace the ARCH-020 audit target check to admit ARCH-021 actions');
console.log('ARCH-021 static schema, migration and ERD contract checks passed.');
