import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const schema = readFileSync(new URL('prisma/schema.prisma', root), 'utf8');
const migrationName = '20261015160000_arch032_mcp_platform_policy_jsonb';
const migration = readFileSync(new URL(`prisma/migrations/${migrationName}/migration.sql`, root), 'utf8');
const model = schema.match(/model PlatformBillingPolicy \{([\s\S]*?)\n\}/)?.[1];
assert.ok(model, 'Existing singleton PlatformBillingPolicy must be retained');
assert.match(model, /^\s*id\s+String\s+@id\s+@default\("default"\)/m);
assert.match(model, /^\s*version\s+Int\s+@default\(0\)/m);
assert.match(model, /^\s*mcpExecutionPolicy\s+Json\?\s+@db\.JsonB\s*$/m);
assert.match(model, /@@schema\("billing"\)/);
assert.equal((model.match(/mcpExecutionPolicy/g) ?? []).length, 1);
assert.doesNotMatch(schema, /model (?:McpExecutionPolicy|MCPExecutionPolicy)\s*\{/);
const labels = schema.match(/enum CommerceEnvironment \{([\s\S]*?)\n\}/)?.[1]
  .split('\n').map(x => x.trim()).filter(x => /^[A-Z][A-Z_]+$/.test(x));
assert.deepEqual(labels, ['LOCAL', 'TEST', 'DEVELOPMENT', 'STAGING', 'PRODUCTION']);
assert.match(schema, /enum CommerceEnvironment \{[\s\S]*?@@schema\("commerce"\)/);
const sqlWithoutComments = migration.replace(/^--.*$/gm, '').trim();
assert.match(sqlWithoutComments, /^ALTER TABLE "billing"\."PlatformBillingPolicy"\s+ADD COLUMN "mcpExecutionPolicy" JSONB;/);
assert.match(sqlWithoutComments, /INSERT INTO "billing"\."PlatformBillingPolicy"/);
assert.match(sqlWithoutComments, /ON CONFLICT \("id"\) DO NOTHING/);
assert.match(sqlWithoutComments, /WHERE "id" = 'default' AND "mcpExecutionPolicy" IS NULL/);
assert.match(sqlWithoutComments, /"version" = "version" \+ 1/);
assert.doesNotMatch(sqlWithoutComments, /CREATE TABLE|DROP TABLE|ALTER TABLE[^;]*ADD COLUMN "version"/);
for (const environment of labels) assert.ok(migration.includes(`"${environment}"`), `Missing ${environment} seed`);
for (const [field, value] of Object.entries({ toolDeadlineMs: 10000, providerResponseTimeoutMs: 10000,
  maxProviderRequests: 12, maxResponseBytes: 262144 })) {
  assert.match(migration, new RegExp(`"${field}"\\s*:\\s*${value}`));
}
const seed = readFileSync(new URL('prisma/seed.mjs', root), 'utf8');
const policyLiteral = migration.match(/mcp_defaults JSONB := \$policy\$\s*([\s\S]*?)\s*\$policy\$::jsonb;/)?.[1];
assert.ok(policyLiteral, 'Migration must embed the canonical seeded MCP policy');
const policyDefaults = JSON.parse(policyLiteral);
assert.deepEqual(policyDefaults, {
  schemaVersion: 1, environments: Object.fromEntries(labels.map(key => [key, {
    toolDeadlineMs: 10000, providerResponseTimeoutMs: 10000,
    maxProviderRequests: 12, maxResponseBytes: 262144,
  }]))
});
const jsPolicyLiteral = seed.match(/const MCP_POLICY_DEFAULTS = ([\s\S]*?);\n/)?.[1];
assert.ok(jsPolicyLiteral, 'Prisma development seed must reuse the migration policy');
assert.deepEqual(JSON.parse(jsPolicyLiteral), policyDefaults);
assert.match(seed, /mcpExecutionPolicy: MCP_POLICY_DEFAULTS/);
assert.match(seed, /Skipping Shopify demo data: no Shopify session was found/);
assert.match(seed, /mcpExecutionPolicy: MCP_POLICY_DEFAULTS,[\s\S]*?update: \{\},/,
  'Repeating the demo seed must never overwrite existing platform-policy edits');
assert.equal(readdirSync(new URL('prisma/migrations/', root))
  .filter(name => /^\d{14}_.+/.test(name)).sort().at(-1), migrationName,
  'Target migration must be newest in this uploaded baseline');
console.log('PASS ARCH-032 MCP singleton JSONB schema, migration seed and reset safety');
