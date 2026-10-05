import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  path.join(
    root,
    "prisma/migrations/20261005170000_arch029_store_category_localisation/migration.sql",
  ),
  "utf8",
);

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

const category = prismaBlock("model", "CommercePromptTemplateCategory");
assert.match(category, /enabled\s+Boolean\s+@default\(false\)/);
assert.match(category, /translations\s+CommercePromptTemplateCategoryTranslation\[\]/);
assert.match(category, /translationRuns\s+CommerceStoreCategoryTranslationRun\[\]/);

const categoryTranslation = prismaBlock(
  "model",
  "CommercePromptTemplateCategoryTranslation",
);
for (const field of ["categoryId", "locale", "displayName", "description"]) {
  assert.match(categoryTranslation, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(categoryTranslation, /@@unique\(\[categoryId, locale\]\)/);
assert.match(categoryTranslation, /@@index\(\[locale, categoryId\]\)/);
assert.match(categoryTranslation, /onDelete: Cascade, onUpdate: Restrict/);

const mapping = prismaBlock("model", "CommerceStoreCategoryTaxonomyMapping");
assert.match(mapping, /conditionKey\s+String\?\s+@db\.VarChar\(128\)/);
assert.match(mapping, /displayName\s+String\?\s+@db\.VarChar\(255\)/);
assert.match(mapping, /editVersion\s+Int\s+@default\(1\)/);
assert.match(mapping, /@@unique\(\[categoryId, conditionKey\]\)/);
assert.match(
  mapping,
  /translations\s+CommerceStoreCategoryTaxonomyMappingTranslation\[\]/,
);

const mappingTranslation = prismaBlock(
  "model",
  "CommerceStoreCategoryTaxonomyMappingTranslation",
);
for (const field of ["mappingId", "locale", "displayName"]) {
  assert.match(mappingTranslation, new RegExp(`^\\s*${field}\\s+`, "m"));
}
assert.match(mappingTranslation, /@@unique\(\[mappingId, locale\]\)/);
assert.doesNotMatch(
  mappingTranslation,
  /^\s*description\s+/m,
  "ARCH-029 v1 intentionally translates only mapping displayName",
);

for (const expected of [
  /ALTER COLUMN "enabled" SET DEFAULT false/,
  /ADD COLUMN "conditionKey" VARCHAR\(128\)/,
  /ADD COLUMN "displayName" VARCHAR\(255\)/,
  /ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 1/,
  /CommerceStoreCategoryTaxonomyMapping_condition_key_check/,
  /CommerceStoreCategoryTaxonomyMapping_categoryId_conditionKey_key/,
  /arch029_store_category_mapping_condition_key_guard/,
  /CREATE TABLE "commerce"\."CommercePromptTemplateCategoryTranslation"/,
  /CREATE TABLE "commerce"\."CommerceStoreCategoryTaxonomyMappingTranslation"/,
  /ON DELETE CASCADE ON UPDATE RESTRICT/,
]) {
  assert.match(migration, expected);
}

assert.doesNotMatch(
  migration,
  /(?:ALTER|CREATE|DROP) TABLE "support"\./,
  "DATABASE-001 must not modify support translation persistence",
);

console.log("ARCH-029 Store Category localisation schema validation passed.");
