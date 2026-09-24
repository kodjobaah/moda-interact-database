import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migrationPath = 'prisma/migrations/20260924103000_arch021_simplify_agent_configuration/migration.sql';
const sql = readFileSync(new URL(`../${migrationPath}`, import.meta.url), 'utf8');
const position = text => { const value = sql.indexOf(text); assert.notEqual(value, -1, `${text} missing`); return value; };

const createConfiguration = position('CREATE TABLE "commerce"."CommerceAgentConfiguration"');
const createAccess = position('CREATE TABLE "commerce"."CommerceStudioMerchantAccess"');
const templateBackfill = position('UPDATE "commerce"."CommercePromptTemplate" AS template');
const sourceBackfill = position('UPDATE "commerce"."CommerceAgentPromptRevision" AS revision');
const configurationBackfill = position('INSERT INTO "commerce"."CommerceAgentConfiguration"');
const auditBackfill = position('UPDATE "commerce"."CommerceAuditEvent"');
const firstDrop = position('DROP TABLE "commerce"."CommercePlatformModelSelection"');
assert.ok(createConfiguration < configurationBackfill);
assert.ok(createAccess < auditBackfill);
assert.ok(templateBackfill < firstDrop);
assert.ok(sourceBackfill < firstDrop);
assert.ok(configurationBackfill < firstDrop);
assert.ok(auditBackfill < firstDrop);
assert.match(sql, /FULL OUTER JOIN "commerce"\."CommerceShopPromptPointer"/);
assert.match(sql, /ORDER BY revision\."revisionNumber" DESC/);
assert.match(sql, /status" = 'PUBLISHED'/);
assert.match(sql, /operationId" = "id"/);
assert.match(sql, /action"::text IN \([\s\S]*CLEAR_SHOP_PROMPT_POINTER/);
for (const table of ['CommercePlatformModelSelection', 'CommerceShopModelSelection', 'CommercePlatformPromptPointer', 'CommerceShopPromptPointer', 'CommercePromptTemplateRevision']) {
  assert.equal((sql.match(new RegExp(`DROP TABLE "commerce"\."${table}"`, 'g')) || []).length, 1, `${table} must be dropped exactly once`);
}
assert.doesNotMatch(sql, /DROP TABLE "commerce"\."(CommerceModelCatalogueEntry|CommercePromptTemplateCategory|CommercePromptTemplate|CommerceAgentPrompt|CommerceAgentPromptRevision|CommerceAuditEvent)"/);
assert.match(sql, /CommerceAgentConfiguration_guard_trigger/);
assert.match(sql, /CommerceStudioMerchantAccess_identity_guard_trigger/);
assert.match(sql, /OLD\."providerSubject" IS NOT NULL/);
assert.match(sql, /NEW\."providerSubject" IS NULL OR NEW\."providerSubject" IS DISTINCT FROM OLD\."providerSubject"/);
console.log('ARCH-021 simplification migration ordering and backfill checks passed.');
