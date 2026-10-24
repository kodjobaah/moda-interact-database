import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT } from './arch047-template-persistence-contract.mjs';

const defaultSchema = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const normalise = line => line.trim().replace(/\s+/g, ' ');

export function parseModels(schema) {
  const parsed = new Map();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = new Map();
    const directives = [];
    for (const raw of match[2].split('\n')) {
      const line = normalise(raw);
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('@@')) {
        directives.push(line);
      } else {
        const field = line.match(/^(\w+)\s+(.+)$/);
        assert.ok(field, `${match[1]}: unrecognised Prisma declaration: ${line}`);
        assert.ok(!fields.has(field[1]), `${match[1]}.${field[1]} appears twice`);
        fields.set(field[1], field[2]);
      }
    }
    assert.ok(!parsed.has(match[1]), `Duplicate Prisma model ${match[1]}`);
    parsed.set(match[1], { fields, directives: directives.sort() });
  }
  return parsed;
}

export function validateSchemaText(schema) {
  const models = parseModels(schema);
  for (const name of CONTRACT.obsoleteModels) {
    assert.ok(!models.has(name), `Obsolete ${name} model is forbidden`);
  }
  const contractNames = Object.keys(CONTRACT.models);
  const actualNames = [...models.keys()].filter(name =>
    name !== 'WhatsAppTemplateVariant' &&
    (name.startsWith('WhatsAppTemplate') || name === 'WhatsAppConversationWrapperActiveSlot'));
  assert.deepEqual(actualNames.sort(), [...contractNames].sort(),
    `Exactly ${contractNames.length} new ARCH-047 models are required`);
  for (const [name, expected] of Object.entries(CONTRACT.models)) {
    const model = models.get(name);
    assert.ok(model, `Missing ${name} model`);
    const expectedFields = expected.fields;
    for (const [field, expectedDeclaration] of Object.entries(expectedFields)) {
      const actual = model.fields.get(field);
      assert.ok(actual, `Missing ${name}.${field}`);
      assert.equal(actual, normalise(expectedDeclaration),
        `${name}.${field} has wrong Prisma type/nullable/native annotation, default or relation`);
    }
    for (const field of model.fields.keys()) {
      assert.ok(Object.hasOwn(expectedFields, field),
        `Unexpected ${name}.${field}; the 11-model contract is exact`);
    }
    assert.deepEqual(model.directives, expected.directives,
      `${name}: schema, indexes and technical unique identities must match exactly`);
  }
  for (const [modelName, fields] of Object.entries(CONTRACT.existingFields)) {
    const model = models.get(modelName);
    assert.ok(model, `Missing pre-existing ${modelName} model`);
    for (const [field, expected] of Object.entries(fields)) {
      assert.equal(model.fields.get(field), normalise(expected),
        `${modelName}.${field} must preserve exact nullability, relation and FK actions`);
    }
  }
  const variant = models.get('WhatsAppTemplateVariant');
  assert.ok(variant.directives.includes('@@index([metaRegistrationId])'),
    'WhatsAppTemplateVariant must index nullable metaRegistrationId');
  assert.ok(variant.directives.includes(
    '@@unique([shopId, providerAccountId, purpose, providerTemplateName, providerLanguageCode], map: "WhatsAppTemplateVariant_identity_key")'),
    'Preserve historical WhatsAppTemplateVariant identity uniqueness');
  const audit = schema.match(/\benum\s+CommerceAuditAction\s*\{([\s\S]*?)\}/);
  assert.ok(audit, 'CommerceAuditAction enum must exist');
  const labels = audit[1].split('\n').map(normalise).filter(s => s && !s.startsWith('@@') && !s.startsWith('//'));
  for (const action of CONTRACT.actions) {
    assert.equal(labels.filter(x => x === action).length, 1, `Missing or duplicate audit action ${action}`);
  }
  for (const action of [
    'CREATE_WHATSAPP_TEMPLATE_VARIANT', 'UPDATE_WHATSAPP_TEMPLATE_VARIANT',
    'ENABLE_WHATSAPP_TEMPLATE_VARIANT', 'DISABLE_WHATSAPP_TEMPLATE_VARIANT',
    'BULK_ASSIGN_WHATSAPP_TEMPLATE_VARIANT', 'BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT',
  ]) assert.ok(labels.includes(action), `Historical ARCH-047 action ${action} was removed`);
  return { models: contractNames.length, newAuditActions: CONTRACT.actions.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--schema');
  const path = index < 0 ? defaultSchema : process.argv[index + 1];
  assert.ok(path, '--schema requires a path');
  const result = validateSchemaText(readFileSync(path, 'utf8'));
  console.log(`ARCH-047 exact schema PASS: ${result.models} models; ${result.newAuditActions} audit actions`);
}
