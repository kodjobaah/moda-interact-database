import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSchemaText } from './validate-arch047-template-persistence-schema.mjs';
import { validateMigrationText } from './validate-arch047-template-persistence-migration.mjs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../prisma/migrations/20261024133000_arch047_template_persistence/migration.sql', import.meta.url), 'utf8');
function replaceOnce(original, before, after) {
  assert.ok(original.includes(before), `Mutation fixture missing expected input: ${before}`);
  return original.replace(before, after);
}
function replaceModelOnce(original, name, before, after) {
  const matcher = new RegExp(`^model ${name} [{][\\s\\S]*?^[}]`, 'm');
  const block = original.match(matcher)?.[0];
  assert.ok(block, `Expected model ${name} missing from fixture`);
  return original.replace(block, replaceOnce(block, before, after));
}
function probe(name, verifier, mutant, expected) {
  assert.throws(() => verifier(mutant), expected, `${name} must fail for the correct contract reason`);
  console.log(`PASS rejects ${name}`);
}
validateSchemaText(schema);
validateMigrationText(migration);

probe('localeAst JsonB changed to text', validateSchemaText,
  replaceOnce(schema, 'localeAst            Json?     @db.JsonB', 'localeAst            String?   @db.Text'),
  /WhatsAppTemplateLocale\.localeAst/);
probe('required Prisma FK cascade instead of restrict', validateSchemaText,
  replaceModelOnce(schema, 'WhatsAppTemplateTranslationRun', 'translationModel CommerceTranslationModelConfiguration @relation(fields: [translationModelConfigurationId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
    'translationModel CommerceTranslationModelConfiguration @relation(fields: [translationModelConfigurationId], references: [id], onDelete: Cascade, onUpdate: Restrict)'),
  /WhatsAppTemplateTranslationRun\.translationModel/);
probe('missing translation-model SQL foreign key', validateMigrationText,
  migration.replace(/^ALTER TABLE "whatsapp"\."WhatsAppTemplateTranslationRun"[^\n]*FOREIGN KEY \("translationModelConfigurationId"\)[^\n]*\n/m, ''),
  /FK declarations/);
probe('missing provider identity unique key', validateMigrationText,
  migration.replace(/^CREATE UNIQUE INDEX "WhatsAppTemplateMetaRegistration_wabaId_providerTemplateNam_key"[^\n]*\n/m, ''),
  /technical unique constraints/);
probe('required legacy nullable registration reference', validateSchemaText,
  schema.replace(/metaRegistrationId\s+String\?\s+@db\.Text/, 'metaRegistrationId String @db.Text'),
  /WhatsAppTemplateVariant\.metaRegistrationId/);
probe('missing frozen parameter binding declaration', validateSchemaText,
  replaceOnce(schema, 'parameterBindingsSnapshot Json      @db.JsonB\n', ''),
  /WhatsAppTemplateMetaRegistration\.parameterBindingsSnapshot/);
probe('parameterBindingsSnapshot JSONB changed to TEXT', validateMigrationText,
  replaceOnce(migration, '"parameterBindingsSnapshot" JSONB NOT NULL', '"parameterBindingsSnapshot" TEXT NOT NULL'),
  /WhatsAppTemplateMetaRegistration\.parameterBindingsSnapshot/);
probe('wrong-typed provider observation', validateSchemaText,
  replaceOnce(schema, 'lastObservedContentHash   String?   @db.VarChar(64)',
    'lastObservedContentHash   Int?'),
  /WhatsAppTemplateMetaRegistration\.lastObservedContentHash/);
probe('removed provider observation', validateMigrationText,
  replaceOnce(migration, '    "lastObservedContentHash" VARCHAR(64),\n', ''),
  /WhatsAppTemplateMetaRegistration/);
probe('missing publication target languageTag', validateSchemaText,
  replaceOnce(schema, '  languageTag        String    @db.VarChar(16)\n  metaRegistrationId String',
    '  metaRegistrationId String'),
  /WhatsAppTemplatePublicationTarget\.languageTag/);
probe('obsolete shop-only publication uniqueness', validateMigrationText,
  replaceOnce(migration, '"operationId", "shopId", "languageTag"', '"operationId", "shopId"'),
  /technical unique constraints/);
probe('invalid definition-level wabaId', validateSchemaText,
  replaceOnce(schema, '  sourceLanguageTag      String    @db.VarChar(16)',
    '  wabaId                 String    @db.VarChar(191)\n  sourceLanguageTag      String    @db.VarChar(16)'),
  /Unexpected WhatsAppTemplateDefinition\.wabaId/);
probe('obsolete release table introduced', validateMigrationText,
  replaceOnce(migration, 'COMMIT;', 'CREATE TABLE "whatsapp"."WhatsAppTemplateRelease" ("id" TEXT PRIMARY KEY);\nCOMMIT;'),
  /CREATE TABLE must create exactly/);
probe('new SQL business CHECK added', validateMigrationText,
  replaceOnce(migration, '    "kind" VARCHAR(40) NOT NULL', '    "kind" VARCHAR(40) NOT NULL CHECK ("kind" = \'META_RECOVERY\')'),
  /No new template business CHECK|wrong SQL type/);
probe('missing required Meta registration FK on publication target', validateMigrationText,
  migration.replace(/^ALTER TABLE "whatsapp"\."WhatsAppTemplatePublicationTarget"[^\n]*FOREIGN KEY \("metaRegistrationId"\)[^\n]*\n/m, ''),
  /FK declarations/);
probe('legacy variant registration made nonnullable by SQL', validateMigrationText,
  replaceOnce(migration, 'ADD COLUMN "metaRegistrationId" TEXT;', 'ADD COLUMN "metaRegistrationId" TEXT NOT NULL;'),
  /WhatsAppTemplateVariant\.metaRegistrationId/);
probe('historical audit guard weakened', validateMigrationText,
  replaceOnce(migration, 'WHEN "action"::text = \'UPDATE_FEATURE_BEHAVIOUR\' THEN "featureId" IS NOT NULL',
    'WHEN "action"::text = \'UPDATE_FEATURE_BEHAVIOUR\' THEN true'),
  /Historic arch020_audit_targets/);
console.log('ARCH-047 schema/migration mutation probes PASS');
