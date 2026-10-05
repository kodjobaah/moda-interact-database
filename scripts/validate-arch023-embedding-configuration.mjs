import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  path.join(
    root,
    "prisma/migrations/20261005093000_arch023_embedding_configuration/migration.sql",
  ),
  "utf8",
);

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

const purpose = prismaBlock("enum", "CommerceEmbeddingPurpose");
for (const value of ["MERCHANT_KNOWLEDGE", "REFERENCE_TAXONOMY"]) {
  assert.match(purpose, new RegExp(`^\\s*${value}\\s*$`, "m"), `missing purpose ${value}`);
}

const configuration = prismaBlock("model", "CommerceEmbeddingConfiguration");
for (const field of [
  "environment",
  "purpose",
  "embeddingProvider",
  "embeddingModel",
  "embeddingDimensions",
  "embeddingIndexVersion",
  "ciphertext",
  "nonce",
  "authTag",
  "keyId",
  "editVersion",
  "updatedByAdminId",
]) {
  assert.match(configuration, new RegExp(`^\\s*${field}\\s+`, "m"), `missing field ${field}`);
}

assert.match(configuration, /environment\s+CommerceEnvironment/);
assert.match(configuration, /purpose\s+CommerceEmbeddingPurpose/);
assert.match(configuration, /embeddingProvider\s+String\s+@db\.VarChar\(64\)/);
assert.match(configuration, /embeddingModel\s+String\s+@db\.VarChar\(255\)/);
assert.match(configuration, /embeddingDimensions\s+Int/);
assert.match(configuration, /embeddingIndexVersion\s+String\s+@db\.VarChar\(64\)/);
assert.match(configuration, /@@unique\(\[environment, purpose\]\)/);
assert.match(configuration, /@@index\(\[purpose, environment\]\)/);

assert.doesNotMatch(
  configuration,
  /^\s*(?:apiKey|plaintextApiKey|secret|credential)\s+/m,
  "plaintext embedding credentials must not be persisted",
);

const platformAdmin = prismaBlock("model", "PlatformAdmin");
assert.match(
  platformAdmin,
  /updatedCommerceEmbeddingConfigurations\s+CommerceEmbeddingConfiguration\[\]\s+@relation\("CommerceEmbeddingConfigurationUpdater"\)/,
);

const auditAction = prismaBlock("enum", "CommerceAuditAction");
for (const action of [
  "SET_EMBEDDING_CONFIGURATION",
  "REPLACE_EMBEDDING_CONFIGURATION",
  "REMOVE_EMBEDDING_CONFIGURATION",
]) {
  assert.match(auditAction, new RegExp(`^\\s*${action}\\s*$`, "m"), `missing audit action ${action}`);
  assert.match(migration, new RegExp(`ADD VALUE '${action}'`), `migration missing audit action ${action}`);
}

for (const constraint of [
  "CommerceEmbeddingConfiguration_provider_check",
  "CommerceEmbeddingConfiguration_model_check",
  "CommerceEmbeddingConfiguration_dimensions_check",
  "CommerceEmbeddingConfiguration_index_version_check",
  "CommerceEmbeddingConfiguration_ciphertext_length_check",
  "CommerceEmbeddingConfiguration_nonce_length_check",
  "CommerceEmbeddingConfiguration_auth_tag_length_check",
  "CommerceEmbeddingConfiguration_key_id_check",
  "CommerceEmbeddingConfiguration_edit_version_check",
]) {
  assert.match(migration, new RegExp(constraint), `migration missing constraint ${constraint}`);
}

assert.match(
  migration,
  /CREATE UNIQUE INDEX "CommerceEmbeddingConfiguration_environment_purpose_key"/,
);
assert.match(
  migration,
  /FOREIGN KEY \("updatedByAdminId"\) REFERENCES "public"\."PlatformAdmin"\("id"\)/,
);

assert.match(
  migration,
  /DROP CONSTRAINT "arch020_audit_targets"[\s\S]*ADD CONSTRAINT "arch020_audit_targets"/,
  "migration must preserve and extend the Commerce audit target contract",
);
assert.match(
  migration,
  /SET_OPENROUTER_CREDENTIAL[\s\S]*SET_EMBEDDING_CONFIGURATION[\s\S]*"environment" IS NOT NULL/,
  "embedding configuration audit events must remain environment-scoped",
);

console.log("ARCH-023 embedding configuration validation passed.");
