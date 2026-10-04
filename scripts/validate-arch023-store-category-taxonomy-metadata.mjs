import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  path.join(
    root,
    "prisma/migrations/20261004213000_arch023_store_category_taxonomy_metadata/migration.sql",
  ),
  "utf8",
);

for (const field of [
  "referenceTaxonomySource",
  "referenceTaxonomyVersion",
  "referenceTaxonomyCategoryId",
  "referenceTaxonomyCategoryName",
  "referenceTaxonomyCategoryFullName",
]) {
  assert.match(schema, new RegExp(`\\b${field}\\b`), `missing category field ${field}`);
  assert.match(migration, new RegExp(`"${field}"`), `missing migration column ${field}`);
}

for (const field of [
  "taxonomySource",
  "taxonomyVersion",
  "taxonomyCategoryName",
  "taxonomyCategoryFullName",
]) {
  assert.match(schema, new RegExp(`\\b${field}\\b`), `missing mapping field ${field}`);
  assert.match(migration, new RegExp(`"${field}"`), `missing mapping migration column ${field}`);
}

assert.match(
  schema,
  /referenceTaxonomyCategoryId\s+String\?\s+@unique\s+@db\.VarChar\(255\)/,
);
assert.match(
  migration,
  /CommercePromptTemplateCategory_referenceTaxonomyCategoryId_key/,
);
assert.match(
  migration,
  /CommercePromptTemplateCategory_reference_taxonomy_bundle_check/,
);
assert.match(
  migration,
  /CommerceStoreCategoryTaxonomyMapping_taxonomy_metadata_bundle_check/,
);
assert.match(
  schema,
  /shopifyTaxonomyCategoryId\s+String\s+@unique\s+@db\.VarChar\(255\)/,
  "existing Shopify taxonomy identifier must remain intact for compatibility",
);

console.log("ARCH-023 Store Category taxonomy metadata validation passed.");
