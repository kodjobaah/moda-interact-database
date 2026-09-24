import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260924103000_arch021_simplify_agent_configuration/migration.sql');
const modelBody = name => schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

for (const model of ['CommerceAgentConfiguration', 'CommerceStudioMerchantAccess']) assert.match(schema, new RegExp(`model ${model} \\{`));
for (const model of ['CommercePlatformModelSelection', 'CommerceShopModelSelection', 'CommercePlatformPromptPointer', 'CommerceShopPromptPointer', 'CommercePromptTemplateRevision']) assert.doesNotMatch(schema, new RegExp(`model ${model} \\{`));
for (const field of ['modelEditVersion', 'promptEditVersion', 'activePromptRevisionId', 'promptText', 'sourceTemplateId', 'operationId', 'actorType', 'agentConfigurationId', 'merchantAccessId']) assert.match(schema, new RegExp(`^\\s*${field}\\s`, 'm'));
for (const model of ['CommerceAgentPrompt', 'CommerceAgentPromptRevision']) {
	const body = modelBody(model);
	for (const field of ['createdByAdminId', 'publishedByAdminId', 'sourceTemplateRevisionId', 'generationId']) assert.doesNotMatch(body, new RegExp(`^\\s*${field}\\s`, 'm'), `${model}.${field} must be removed`);
}
for (const value of ['ADMIN', 'EDITOR', 'VIEWER', 'PLATFORM_ADMIN', 'MERCHANT_ACCESS', 'UPSERT_AGENT_CONFIGURATION', 'SET_AGENT_MODEL', 'CLEAR_AGENT_MODEL', 'SET_AGENT_PROMPT', 'CLEAR_AGENT_PROMPT', 'UPDATE_PROMPT_TEMPLATE_CONTENT', 'GRANT_MERCHANT_STUDIO_ACCESS', 'UPDATE_MERCHANT_STUDIO_ACCESS', 'DISABLE_MERCHANT_STUDIO_ACCESS', 'BIND_MERCHANT_STUDIO_IDENTITY']) assert.match(schema, new RegExp(`^\\s*${value}\\s*$`, 'm'), `${value} missing`);
for (const name of ['CommerceAgentConfiguration_scope_shop_check', 'CommerceStudioMerchantAccess_email_normalized_check', 'CommerceAuditEvent_actor_check', 'CommerceAuditEvent_operation_id_unique', 'CommerceAgentConfiguration_one_platform_per_environment', 'CommerceAgentConfiguration_one_shop_per_environment']) assert.match(migration, new RegExp(name.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')), `${name} missing`);
for (const name of ['arch021_agent_configuration_guard', 'CommerceAgentConfiguration_guard_trigger', 'arch021_merchant_access_identity_guard', 'CommerceStudioMerchantAccess_identity_guard_trigger']) assert.match(migration, new RegExp(name), `${name} missing`);
for (const table of ['CommercePlatformModelSelection', 'CommerceShopModelSelection', 'CommercePlatformPromptPointer', 'CommerceShopPromptPointer', 'CommercePromptTemplateRevision']) assert.match(migration, new RegExp(`DROP TABLE [^;]*${table}`));
assert.equal((migration.match(/CREATE TABLE "commerce"\."CommerceAgentConfiguration"/g) || []).length, 1);
assert.equal((migration.match(/CREATE TABLE "commerce"\."CommerceStudioMerchantAccess"/g) || []).length, 1);
assert.match(migration, /FULL OUTER JOIN "commerce"\."CommerceShopPromptPointer"/);
assert.match(migration, /status" = 'PUBLISHED'/);
assert.match(migration, /operationId" = "id"/);
console.log('ARCH-021 simplification schema contract checks passed.');
