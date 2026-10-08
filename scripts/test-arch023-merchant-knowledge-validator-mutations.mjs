import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'arch023-validator-mutations-'));
const schemaSourcePath = join(root, 'prisma/schema.prisma');
const migrationSourcePath = join(root, 'prisma/migrations/20260929160000_arch023_merchant_knowledge_schema/migration.sql');
const schemaValidator = join(root, 'scripts/validate-arch023-merchant-knowledge-schema.mjs');
const migrationValidator = join(root, 'scripts/validate-arch023-merchant-knowledge-migration.mjs');
const replaceOnce = (source, before, after, label) => {
  assert.ok(source.includes(before), `Mutation anchor missing: ${label}`);
  return source.replace(before, after);
};
const rejectMutation = (validator, envName, source, sourcePath, expectedMessage, label) => {
  writeFileSync(sourcePath, source);
  const result = spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: 'utf8',
    env: {...process.env, [envName]: sourcePath},
  });
  assert.notEqual(result.status, 0, `${label}: validator unexpectedly accepted mutation`);
  assert.ok(`${result.stdout}\n${result.stderr}`.includes(expectedMessage), `${label}: failed for an unexpected reason\n${result.stdout}\n${result.stderr}`);
  console.log(`PASS rejects ${label}`);
};

try {
  const schema = readFileSync(schemaSourcePath, 'utf8');
  const schemaCases = [
    ['MerchantKnowledgeDataFormat.acceptedContentTypes type', 'acceptedContentTypes Json ', 'acceptedContentTypes String ', 'MerchantKnowledgeDataFormat field declarations differ'],
    ['CommerceStoreCategoryTaxonomyMapping.weight type', 'weight                    Int ', 'weight                    BigInt ', 'CommerceStoreCategoryTaxonomyMapping field declarations differ'],
    ['CommerceShopProfile.shop onDelete action', 'shop                       Shop                            @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: Restrict)', 'shop                       Shop                            @relation(fields: [shopId], references: [id], onDelete: Restrict, onUpdate: Restrict)', 'CommerceShopProfile field declarations differ'],
  ];
  for (const [label, before, after, error] of schemaCases) {
    const mutated = replaceOnce(schema, before, after, label);
    rejectMutation(schemaValidator, 'ARCH023_SCHEMA_PATH', mutated, join(temp, 'schema.prisma'), error, label);
  }

  const migration = readFileSync(migrationSourcePath, 'utf8');
  const migrationCases = [
    ['MerchantKnowledgeDataFormat.canonicalExtension type', '"canonicalExtension" VARCHAR(16)', '"canonicalExtension" TEXT', 'MerchantKnowledgeDataFormat column types/nullability/defaults differ'],
    ['MerchantKnowledgeUploadedAsset dataFormat FK delete action', 'CONSTRAINT "MerchantKnowledgeUploadedAsset_dataFormat_fkey"\n    FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE RESTRICT ON UPDATE RESTRICT', 'CONSTRAINT "MerchantKnowledgeUploadedAsset_dataFormat_fkey"\n    FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE CASCADE ON UPDATE RESTRICT', 'Exact foreign key contract missing'],
  ];
  for (const [label, before, after, error] of migrationCases) {
    const mutated = replaceOnce(migration, before, after, label);
    rejectMutation(migrationValidator, 'ARCH023_MIGRATION_PATH', mutated, join(temp, 'migration.sql'), error, label);
  }
  console.log('ARCH-023 validator mutation regression suite passed.');
} finally {
  rmSync(temp, {recursive: true, force: true});
}
