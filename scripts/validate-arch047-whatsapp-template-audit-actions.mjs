import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const target = '20261023173000_arch047_whatsapp_template_audit_actions';
const sql = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');
const actions = [
  'CREATE_WHATSAPP_TEMPLATE_VARIANT',
  'UPDATE_WHATSAPP_TEMPLATE_VARIANT',
  'ENABLE_WHATSAPP_TEMPLATE_VARIANT',
  'DISABLE_WHATSAPP_TEMPLATE_VARIANT',
  'BULK_ASSIGN_WHATSAPP_TEMPLATE_VARIANT',
  'BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT',
];

function oneBlock(kind, name) {
  const blocks = [...schema.matchAll(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'gm'))];
  assert.equal(blocks.length, 1, `${kind} ${name} must exist exactly once`);
  return blocks[0][1];
}

const actionEnum = oneBlock('enum', 'CommerceAuditAction');
const audit = oneBlock('model', 'CommerceAuditEvent');
const template = oneBlock('model', 'WhatsAppTemplateVariant');
assert.match(actionEnum, /@@schema\("commerce"\)/);
for (const value of actions) {
  assert.equal(actionEnum.split('\n').filter(line => line.trim() === value).length, 1,
    `CommerceAuditAction must declare ${value} once`);
}
for (const legacy of ['CREATE_PROMPT_TEMPLATE', 'UPDATE_PROMPT_TEMPLATE',
  'ENABLE_PROMPT_TEMPLATE', 'DISABLE_PROMPT_TEMPLATE', 'CREATE_RELEASE']) {
  assert.match(actionEnum, new RegExp(`^\\s*${legacy}\\s*$`, 'm'),
    `Existing commerce audit action ${legacy} must remain`);
}
for (const field of ['actorAdminId', 'operationId', 'action', 'shopId', 'reason',
  'metadata', 'createdAt']) {
  assert.match(audit, new RegExp(`^\\s*${field}\\s+\\S+`, 'm'),
    `The existing CommerceAuditEvent.${field} must remain`);
}
for (const index of ['@@index([actorAdminId, createdAt, id])',
  '@@index([shopId, createdAt, id])']) {
  assert.ok(audit.includes(index), `CommerceAuditEvent must preserve ${index}`);
}
assert.match(audit, /@@schema\("commerce"\)/);
assert.match(template, /@@schema\("whatsapp"\)/);
assert.match(template, /@@unique\(\[shopId, providerAccountId, purpose, providerTemplateName, providerLanguageCode\]/);
assert.doesNotMatch(template, /\bverifiedCategory\b|\bmetaCategory\b/);

// The latest archived audit-targets CHECK is exhaustive (ELSE false), so enum
// additions alone cannot persist. Preserve every old predicate byte-for-byte,
// adding only the new shop-scoped admin/operation branch.
const previousSql = readFileSync(new URL(
  '../prisma/migrations/20261013183000_arch038_unified_model_policies/migration.sql',
  import.meta.url,
), 'utf8');
function auditConstraint(source) {
  const start = source.indexOf('ALTER TABLE "commerce"."CommerceAuditEvent" DROP CONSTRAINT "arch020_audit_targets";');
  assert.ok(start >= 0, 'Original existing audit-targets constraint must exist');
  const end = source.indexOf('  END);', start);
  assert.ok(end > start, 'Original audit-targets CHECK must end');
  return source.slice(start, end + '  END);'.length);
}
const previousConstraint = auditConstraint(previousSql);
const newBranch = `    WHEN "action"::text IN ('CREATE_WHATSAPP_TEMPLATE_VARIANT','UPDATE_WHATSAPP_TEMPLATE_VARIANT',
      'ENABLE_WHATSAPP_TEMPLATE_VARIANT','DISABLE_WHATSAPP_TEMPLATE_VARIANT',
      'BULK_ASSIGN_WHATSAPP_TEMPLATE_VARIANT','BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT')
      THEN "shopId" IS NOT NULL AND "actorType"::text = 'PLATFORM_ADMIN'
        AND "actorAdminId" IS NOT NULL AND "operationId" IS NOT NULL
        AND btrim("operationId") <> ''
`;
const expectedConstraint = previousConstraint.replace('    ELSE false', newBranch + '    ELSE false');
assert.notEqual(expectedConstraint, previousConstraint, 'Previous constraint must have an ELSE false guard');
const expectedSql = [
  'BEGIN;',
  ...actions.map(value =>
    `ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS '${value}';`),
  '', expectedConstraint, 'COMMIT;',
].join('\n');
assert.equal(sql.replace(/^--.*$/gm, '').trim(), expectedSql,
  'Migration must add only the six enum values and preserve the existing CHECK except one new branch');
const migrations = readdirSync(new URL('../prisma/migrations/', import.meta.url))
  .filter(name => /^\d{14}_/.test(name)).sort();
assert.ok(migrations.includes(target), 'ARCH-047 migration must exist');
assert.ok(migrations.indexOf(target) > migrations.indexOf('20261022215000_arch045_general_conversation_dispatch_admission'),
  'ARCH-047 must follow the current database baseline');
console.log('PASS ARCH-047 audit enum actions and additive-only migration contract');
