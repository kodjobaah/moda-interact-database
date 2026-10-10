import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const target = "20261010093000_arch031_automatic_merchant_pricing_translation_state";
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url),
  "utf8",
);
const migrationNames = readdirSync(new URL("../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_.+$/.test(name))
  .sort();

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

assert.equal(
  migrationNames.at(-1),
  target,
  "ARCH-031 migration must remain the latest ordered migration",
);
assert.deepEqual(
  migrationNames.filter((name) => name.includes("arch031_automatic_merchant_pricing_translation_state")),
  [target],
  "exactly one ARCH-031 automatic Merchant Pricing translation migration is allowed",
);

const translationModel = prismaBlock("model", "CommerceTranslationModelConfiguration");
assert.match(translationModel, /^\s*automaticDefault\s+Boolean\s+@default\(false\)/m);
assert.match(translationModel, /merchantPricingTranslationRuns\s+MerchantPricingTranslationRun\[\]/);
assert.match(migration, /ADD COLUMN "automaticDefault" BOOLEAN NOT NULL DEFAULT false/);
assert.match(migration, /TranslationModel_auto_default_enabled_check/);
assert.match(
  migration,
  /CHECK \(NOT "automaticDefault" OR "enabled"\)/,
  "automatic default models must remain enabled",
);
assert.match(
  migration,
  /CREATE UNIQUE INDEX "CommerceTranslationModelConfiguration_one_automatic_default"[\s\S]*?\("environment", "provider"\)[\s\S]*?WHERE "automaticDefault" = true/,
);
assert.doesNotMatch(migration, /UPDATE\s+"commerce"\."CommerceTranslationModelConfiguration"/i,
  "ARCH-031 must not guess a default from existing model rows");
assert.doesNotMatch(migration, /INSERT\s+INTO/i,
  "ARCH-031 migration must not seed provider/model/business rows");

const run = prismaBlock("model", "MerchantPricingTranslationRun");
for (const field of [
  "shopifyPlanHandle",
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
  "requestedAt",
  "startedAt",
  "readyToApplyAt",
  "appliedAt",
  "completedAt",
  "appliedMerchantPricingPlanId",
  "failureCode",
]) {
  assert.match(run, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(run, /CommerceTranslationModelConfiguration\s+@relation\([\s\S]*onDelete: Restrict/);
assert.match(run, /PlatformAdmin\s+@relation\("MerchantPricingTranslationRunRequester"[\s\S]*onDelete: Restrict/);

const item = prismaBlock("model", "MerchantPricingTranslationItem");
for (const field of [
  "runId",
  "sourceEntityKind",
  "sourceContentKey",
  "sourceField",
  "sourceLanguageTag",
  "targetLanguageTag",
  "sourceText",
  "translatedText",
  "status",
  "failureCode",
  "retryCount",
  "nextAttemptAt",
  "currentBatchId",
  "completedAt",
]) {
  assert.match(item, new RegExp(`^\\s*${field}\\s+`, "m"));
}

const batch = prismaBlock("model", "MerchantPricingTranslationBatch");
for (const field of [
  "runId",
  "provider",
  "model",
  "status",
  "providerBatchId",
  "inputFileId",
  "outputFileId",
  "errorFileId",
  "submissionStartedAt",
  "lastSubmitAttemptAt",
  "submitAttemptCount",
  "nextSubmitAt",
  "submittedAt",
  "lastPolledAt",
  "nextPollAt",
  "pollSequence",
  "completedAt",
  "failureCode",
]) {
  assert.match(batch, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(batch, /@@unique\(\[provider, providerBatchId\], map: "MerchantPricingTranslationBatch_provider_batch_key"\)/);

const batchItem = prismaBlock("model", "MerchantPricingTranslationBatchItem");
assert.match(batchItem, /providerCustomId\s+String\s+@unique\(map: "MerchantPricingTranslationBatchItem_custom_id_key"\)/);
assert.match(batchItem, /@@unique\(\[batchId, translationItemId\], map: "MerchantPricingTranslationBatchItem_batch_item_key"\)/);

const requester = prismaBlock("model", "PlatformAdmin");
assert.match(requester, /requestedMerchantPricingTranslationRuns\s+MerchantPricingTranslationRun\[\]/);

const expectedEnums = {
  MerchantPricingTranslationRunStatus: ["PENDING", "PROCESSING", "READY_TO_APPLY", "APPLIED", "FAILED", "STALE"],
  MerchantPricingTranslationEntityKind: ["PLAN", "HIGHLIGHT"],
  MerchantPricingTranslationField: ["TITLE", "DESCRIPTION"],
  MerchantPricingTranslationItemStatus: ["PENDING", "AVAILABLE", "FAILED"],
  MerchantPricingTranslationBatchStatus: [
    "READY", "SUBMITTING", "SUBMISSION_UNKNOWN", "SUBMITTED", "PROVIDER_COMPLETED",
    "COMPLETED", "FAILED", "EXPIRED", "CANCELLED",
  ],
};
for (const [name, values] of Object.entries(expectedEnums)) {
  const block = prismaBlock("enum", name);
  for (const value of values) assert.match(block, new RegExp(`^\\s*${value}\\s*$`, "m"));
  const sqlValues = values.map((value) => `'${value}'`).join("[\\s\\S]*?");
  assert.match(migration, new RegExp(`CREATE TYPE "billing"\\."${name}" AS ENUM \\([\\s\\S]*?${sqlValues}[\\s\\S]*?\\)`));
}

for (const required of [
  "MerchantPricingTranslationRun_active_handle_source_key",
  "MerchantPricingTranslationRun_source_hash_check",
  "MerchantPricingTranslationRun_source_snapshot_check",
  "MerchantPricingTranslationItem_entity_field_check",
  "MerchantPricingTranslationItem_available_text_check",
  "MerchantPricingTranslationItem_plan_field_locale_key",
  "MerchantPricingTranslationItem_highlight_field_locale_key",
  "MerchantPricingTranslationBatch_submit_count_check",
  "MerchantPricingTranslationBatch_poll_sequence_check",
  "MerchantPricingTranslationBatch_provider_batch_key",
  "MerchantPricingTranslationRun_model_fkey",
  "MerchantPricingTranslationRun_requester_fkey",
  "MerchantPricingTranslationItem_current_batch_fkey",
  "MerchantPricingTranslationBatchItem_custom_id_key",
]) {
  assert.ok(migration.includes(required), `${required} missing from migration`);
}

assert.match(
  migration,
  /MerchantPricingTranslationRun_active_handle_source_key[\s\S]*?\("shopifyPlanHandle", "sourceHash"\)[\s\S]*?WHERE "status" IN \('PENDING', 'PROCESSING', 'READY_TO_APPLY'\)/,
);
assert.match(
  migration,
  /MerchantPricingTranslationItem_entity_field_check[\s\S]*?"sourceEntityKind" = 'PLAN'[\s\S]*?"sourceContentKey" IS NULL[\s\S]*?"sourceField" = 'DESCRIPTION'[\s\S]*?"sourceEntityKind" = 'HIGHLIGHT'[\s\S]*?"sourceContentKey" IS NOT NULL/,
);
assert.match(migration, /"retryCount" >= 0/);
assert.match(migration, /"submitAttemptCount" >= 0/);
assert.match(migration, /"pollSequence" >= 0/);
assert.match(migration, /ON DELETE SET NULL ON UPDATE RESTRICT/);
assert.match(migration, /ON DELETE CASCADE ON UPDATE RESTRICT/);
assert.match(migration, /ON DELETE RESTRICT ON UPDATE RESTRICT/);

for (const finalTable of [
  "MerchantPricingPlan",
  "MerchantPricingPlanTranslation",
  "MerchantPricingPlanHighlight",
  "MerchantPricingPlanHighlightTranslation",
]) {
  assert.doesNotMatch(
    migration,
    new RegExp(`(?:ALTER|DROP) TABLE "billing"\\."${finalTable}"`, "i"),
    `ARCH-031 must not alter/drop final ${finalTable} integrity`,
  );
}
assert.doesNotMatch(migration, /DROP\s+(?:CONSTRAINT|TRIGGER|FUNCTION)/i,
  "ARCH-031 must not remove existing ARCH-014 integrity objects");

const planTranslation = prismaBlock("model", "MerchantPricingPlanTranslation");
assert.match(planTranslation, /@@unique\(\[merchantPricingPlanId, locale\]\)/);
const highlightTranslation = prismaBlock("model", "MerchantPricingPlanHighlightTranslation");
assert.match(highlightTranslation, /@@unique\(\[merchantPricingPlanHighlightId, locale\]\)/);

console.log("ARCH-031 automatic Merchant Pricing translation state validation passed.");
