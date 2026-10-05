import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  path.join(
    root,
    "prisma/migrations/20261005171500_arch029_translation_runtime_configuration/migration.sql",
  ),
  "utf8",
);

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

const credential = prismaBlock("model", "CommerceTranslationProviderCredential");
for (const field of [
  "environment",
  "provider",
  "ciphertext",
  "nonce",
  "authTag",
  "keyId",
  "editVersion",
  "updatedByAdminId",
]) {
  assert.match(credential, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(credential, /@@unique\(\[environment, provider\]\)/);
assert.doesNotMatch(
  credential,
  /^\s*(?:apiKey|plaintextApiKey|secret)\s+/m,
  "plaintext translation credentials must not be persisted",
);

const model = prismaBlock("model", "CommerceTranslationModelConfiguration");
for (const field of [
  "environment",
  "provider",
  "providerModelId",
  "displayName",
  "enabled",
  "editVersion",
  "createdByAdminId",
  "updatedByAdminId",
]) {
  assert.match(model, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(model, /@@unique\(\[environment, provider, providerModelId\]\)/);
assert.match(model, /@@unique\(\[environment, displayName\]\)/);
assert.match(
  model,
  /fields: \[environment, provider\], references: \[environment, provider\]/,
);

const run = prismaBlock("model", "CommerceStoreCategoryTranslationRun");
for (const field of [
  "categoryId",
  "environment",
  "translationModelConfigurationId",
  "provider",
  "providerModelId",
  "modelConfigurationVersion",
  "sourceSchemaVersion",
  "sourceHash",
  "sourceSnapshot",
  "status",
  "requestedByAdminId",
]) {
  assert.match(run, new RegExp(`^\\s*${field}\\s+`, "m"));
}

const item = prismaBlock("model", "CommerceStoreCategoryTranslationItem");
for (const field of [
  "runId",
  "sourceEntityKind",
  "sourceEntityId",
  "sourceField",
  "sourceLanguageTag",
  "targetLanguageTag",
  "sourceText",
  "translatedText",
  "status",
  "retryCount",
  "currentBatchId",
]) {
  assert.match(item, new RegExp(`^\\s*${field}\\s+`, "m"));
}

const batch = prismaBlock("model", "CommerceStoreCategoryTranslationBatch");
for (const field of [
  "runId",
  "provider",
  "model",
  "status",
  "providerBatchId",
  "inputFileId",
  "outputFileId",
  "errorFileId",
  "submitAttemptCount",
  "nextSubmitAt",
  "nextPollAt",
  "pollSequence",
]) {
  assert.match(batch, new RegExp(`^\\s*${field}\\s+`, "m"));
}

const batchItem = prismaBlock(
  "model",
  "CommerceStoreCategoryTranslationBatchItem",
);
assert.match(batchItem, /providerCustomId\s+String\s+@unique/);
assert.match(batchItem, /@@unique\(\[batchId, translationItemId\]\)/);

for (const enumName of [
  "CommerceStoreCategoryTranslationRunStatus",
  "CommerceStoreCategoryTranslationEntityKind",
  "CommerceStoreCategoryTranslationField",
  "CommerceStoreCategoryTranslationItemStatus",
  "CommerceStoreCategoryTranslationBatchStatus",
]) {
  prismaBlock("enum", enumName);
}

for (const expected of [
  /CommerceTranslationProviderCredential_ciphertext_length_check/,
  /CommerceTranslationProviderCredential_nonce_length_check/,
  /CommerceTranslationProviderCredential_auth_tag_length_check/,
  /CommerceTranslationModelConfiguration_credential_fkey/,
  /CommerceStoreCategoryTranslationRun_one_active_per_category/,
  /CommerceStoreCategoryTranslationItem_entity_field_check/,
  /CommerceStoreCategoryTranslationBatch_provider_providerBatchId_key/,
  /CommerceAuditEvent_translationModelConfigurationId_fkey/,
  /REQUEST_PROMPT_TEMPLATE_CATEGORY_TRANSLATION/,
  /DROP CONSTRAINT "arch020_audit_targets"[\s\S]*ADD CONSTRAINT "arch020_audit_targets"/,
]) {
  assert.match(migration, expected);
}

const auditAction = prismaBlock("enum", "CommerceAuditAction");
for (const action of [
  "SET_TRANSLATION_PROVIDER_CREDENTIAL",
  "REPLACE_TRANSLATION_PROVIDER_CREDENTIAL",
  "REMOVE_TRANSLATION_PROVIDER_CREDENTIAL",
  "CREATE_TRANSLATION_MODEL_CONFIGURATION",
  "UPDATE_TRANSLATION_MODEL_CONFIGURATION",
  "ENABLE_TRANSLATION_MODEL_CONFIGURATION",
  "DISABLE_TRANSLATION_MODEL_CONFIGURATION",
  "REQUEST_PROMPT_TEMPLATE_CATEGORY_TRANSLATION",
]) {
  assert.match(auditAction, new RegExp(`^\\s*${action}\\s*$`, "m"));
  assert.match(migration, new RegExp(`ADD VALUE '${action}'`));
}

assert.doesNotMatch(
  migration,
  /(?:ALTER|CREATE|DROP) TABLE "support"\./,
  "DATABASE-002 must not modify existing support translation tables",
);
assert.doesNotMatch(
  migration,
  /ALTER TYPE "support"\./,
  "DATABASE-002 must not modify support translation enums",
);

console.log("ARCH-029 translation runtime schema validation passed.");
