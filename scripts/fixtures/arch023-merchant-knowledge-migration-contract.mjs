import assert from 'node:assert/strict';

const compact = value => value.replace(/\s+/g, ' ').trim();
const expression = value => {
  let normalized = compact(value).toLowerCase();
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let index = 0; index < normalized.length - 1; index += 1) {
      if (normalized[index] === '(') depth += 1;
      if (normalized[index] === ')') depth -= 1;
      if (depth === 0) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression) break;
    normalized = normalized.slice(1, -1);
  }
  return normalized;
};

const tableColumns = {
  CommerceStoreCategoryTaxonomyMapping: [
    '"id" TEXT NOT NULL', '"categoryId" TEXT NOT NULL', '"shopifyTaxonomyCategoryId" VARCHAR(255) NOT NULL',
    '"weight" INTEGER NOT NULL DEFAULT 1', '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  CommerceShopProfile: [
    '"id" TEXT NOT NULL', '"shopId" TEXT NOT NULL', '"activeCategoryId" TEXT', '"activeCategoryActivatedAt" TIMESTAMPTZ(3)',
    '"pendingCategoryId" TEXT', '"pendingPromptRevisionId" TEXT', '"pendingSelectionGeneration" INTEGER NOT NULL DEFAULT 0',
    '"pendingSelectedAt" TIMESTAMPTZ(3)', '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgePurpose: [
    '"id" TEXT NOT NULL', '"key" VARCHAR(64) NOT NULL', '"displayName" VARCHAR(160) NOT NULL',
    '"active" BOOLEAN NOT NULL DEFAULT true', '"displayOrder" INTEGER NOT NULL DEFAULT 0',
    '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgeDataFormat: [
    '"id" TEXT NOT NULL', '"key" VARCHAR(32) NOT NULL', '"displayName" VARCHAR(160) NOT NULL',
    '"inputKind" "commerce"."MerchantKnowledgeInputKind" NOT NULL', '"canonicalExtension" VARCHAR(16)',
    '"acceptedContentTypes" JSONB NOT NULL', '"active" BOOLEAN NOT NULL DEFAULT true', '"displayOrder" INTEGER NOT NULL DEFAULT 0',
    '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgePurposeDataFormat: [
    '"purposeId" TEXT NOT NULL', '"dataFormatId" TEXT NOT NULL', '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgeUploadedAsset: [
    '"id" TEXT NOT NULL', '"shopId" TEXT NOT NULL', '"dataFormatId" TEXT NOT NULL',
    '"status" "commerce"."MerchantKnowledgeUploadedAssetStatus" NOT NULL DEFAULT \'PENDING_UPLOAD\'',
    '"objectKey" TEXT NOT NULL', '"originalFileName" VARCHAR(255) NOT NULL', '"contentType" VARCHAR(128)',
    '"sizeBytes" BIGINT', '"sha256" VARCHAR(64)', '"uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL',
    '"availableAt" TIMESTAMPTZ(3)', '"failureCode" VARCHAR(128)', '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgeSource: [
    '"id" TEXT NOT NULL', '"shopId" TEXT NOT NULL', '"purposeId" TEXT NOT NULL', '"dataFormatId" TEXT NOT NULL',
    '"name" VARCHAR(160) NOT NULL', '"languageTag" VARCHAR(16) NOT NULL', '"position" INTEGER NOT NULL',
    '"currentGeneration" INTEGER NOT NULL DEFAULT 0', '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgeSourceRevision: [
    '"id" TEXT NOT NULL', '"sourceId" TEXT NOT NULL', '"uploadedAssetId" TEXT', '"generation" INTEGER NOT NULL',
    '"reason" "commerce"."MerchantKnowledgeRevisionReason" NOT NULL', '"requestedUrl" VARCHAR(2048)', '"resolvedUrl" VARCHAR(2048)',
    '"status" "commerce"."MerchantKnowledgeRevisionStatus" NOT NULL DEFAULT \'PENDING\'', '"contentType" VARCHAR(128)',
    '"httpStatus" INTEGER', '"normalizedContent" TEXT', '"contentUnits" INTEGER', '"contentHash" VARCHAR(64)',
    '"truncated" BOOLEAN NOT NULL DEFAULT false', '"failureCode" VARCHAR(128)', '"requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '"processingStartedAt" TIMESTAMPTZ(3)', '"fetchedAt" TIMESTAMPTZ(3)', '"completedAt" TIMESTAMPTZ(3)',
    '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP', '"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
  MerchantKnowledgeChunk: [
    '"id" TEXT NOT NULL', '"revisionId" TEXT NOT NULL', '"ordinal" INTEGER NOT NULL', '"content" TEXT NOT NULL',
    '"contentUnits" INTEGER NOT NULL', '"contentHash" VARCHAR(64) NOT NULL', '"embedding" vector NOT NULL',
    '"embeddingProvider" VARCHAR(64) NOT NULL', '"embeddingModel" VARCHAR(255) NOT NULL',
    '"embeddingDimensions" INTEGER NOT NULL', '"embeddingIndexVersion" VARCHAR(64) NOT NULL',
    '"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ],
};

const enumContracts = {
  MerchantKnowledgeInputKind: ['REMOTE_URL', 'UPLOAD'],
  MerchantKnowledgeRevisionReason: ['CREATE', 'URL_CHANGE', 'FILE_REPLACE', 'REFRESH', 'REPROCESS', 'ENTITLEMENT_CHANGE'],
  MerchantKnowledgeRevisionStatus: ['PENDING', 'PROCESSING', 'ACTIVE', 'FAILED', 'SUPERSEDED'],
  MerchantKnowledgeUploadedAssetStatus: ['PENDING_UPLOAD', 'AVAILABLE', 'FAILED', 'DELETED'],
};

const foreignKeys = [
  'CONSTRAINT "CommercePromptTemplateCategory_defaultTemplate_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "commerce"."CommercePromptTemplate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_category_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "CommerceShopProfile_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "CommerceShopProfile_active_category_fkey" FOREIGN KEY ("activeCategoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "CommerceShopProfile_pending_category_fkey" FOREIGN KEY ("pendingCategoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "CommerceShopProfile_pending_prompt_revision_fkey" FOREIGN KEY ("pendingPromptRevisionId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgePurposeDataFormat_purpose_fkey" FOREIGN KEY ("purposeId") REFERENCES "commerce"."MerchantKnowledgePurpose"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgePurposeDataFormat_dataFormat_fkey" FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeUploadedAsset_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeUploadedAsset_dataFormat_fkey" FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSource_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSource_purpose_fkey" FOREIGN KEY ("purposeId") REFERENCES "commerce"."MerchantKnowledgePurpose"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSource_dataFormat_fkey" FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSource_purposeDataFormat_fkey" FOREIGN KEY ("purposeId", "dataFormatId") REFERENCES "commerce"."MerchantKnowledgePurposeDataFormat"("purposeId", "dataFormatId") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSourceRevision_source_fkey" FOREIGN KEY ("sourceId") REFERENCES "commerce"."MerchantKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeSourceRevision_uploadedAsset_fkey" FOREIGN KEY ("uploadedAssetId") REFERENCES "commerce"."MerchantKnowledgeUploadedAsset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT',
  'CONSTRAINT "MerchantKnowledgeChunk_revision_fkey" FOREIGN KEY ("revisionId") REFERENCES "commerce"."MerchantKnowledgeSourceRevision"("id") ON DELETE CASCADE ON UPDATE RESTRICT',
];

const checks = {
  CommerceStoreCategoryTaxonomyMapping_weight_positive: '"weight" > 0',
  CommerceShopProfile_pending_generation_nonnegative: '"pendingSelectionGeneration" >= 0',
  CommerceShopProfile_pending_tuple_check: '(("pendingCategoryId" IS NULL AND "pendingPromptRevisionId" IS NULL AND "pendingSelectedAt" IS NULL) OR ("pendingCategoryId" IS NOT NULL AND "pendingPromptRevisionId" IS NOT NULL AND "pendingSelectedAt" IS NOT NULL))',
  CommerceShopProfile_active_category_timestamp_check: '(("activeCategoryId" IS NULL AND "activeCategoryActivatedAt" IS NULL) OR ("activeCategoryId" IS NOT NULL AND "activeCategoryActivatedAt" IS NOT NULL))',
  MerchantKnowledgeUploadedAsset_available_fields_check: '"status" <> \'AVAILABLE\' OR ("contentType" IS NOT NULL AND btrim("contentType") <> \'\' AND "sizeBytes" IS NOT NULL AND "sizeBytes" > 0 AND "sha256" IS NOT NULL AND "sha256" ~ \'^[0-9a-f]{64}$\' AND "availableAt" IS NOT NULL)',
  MerchantKnowledgeSource_position_nonnegative: '"position" >= 0',
  MerchantKnowledgeSource_generation_nonnegative: '"currentGeneration" >= 0',
  MerchantKnowledgeSourceRevision_locator_check: '("requestedUrl" IS NOT NULL) <> ("uploadedAssetId" IS NOT NULL)',
  MerchantKnowledgeSourceRevision_resolved_url_check: '"resolvedUrl" IS NULL OR "requestedUrl" IS NOT NULL',
  MerchantKnowledgeSourceRevision_generation_positive: '"generation" > 0',
  MerchantKnowledgeSourceRevision_active_content_check: '"status" NOT IN (\'ACTIVE\', \'SUPERSEDED\') OR ("contentUnits" IS NOT NULL AND "contentUnits" >= 0 AND "contentHash" IS NOT NULL AND "contentHash" ~ \'^[0-9a-f]{64}$\')',
  MerchantKnowledgeChunk_ordinal_nonnegative: '"ordinal" >= 0',
  MerchantKnowledgeChunk_content_units_positive: '"contentUnits" > 0',
  MerchantKnowledgeChunk_embedding_dimensions_positive: '"embeddingDimensions" > 0',
  MerchantKnowledgeChunk_embedding_dimensions_match: 'vector_dims("embedding") = "embeddingDimensions"',
  MerchantKnowledgeChunk_content_hash_check: '"contentHash" ~ \'^[0-9a-f]{64}$\'',
};

const indexStatements = [
  'CREATE UNIQUE INDEX "CommercePromptTemplateCategory_defaultTemplateId_key" ON "commerce"."CommercePromptTemplateCategory"("defaultTemplateId");',
  'CREATE UNIQUE INDEX "CommerceStoreCategoryTaxonomyMapping_shopifyTaxonomyCategoryId_key" ON "commerce"."CommerceStoreCategoryTaxonomyMapping"("shopifyTaxonomyCategoryId");',
  'CREATE INDEX "CommerceStoreCategoryTaxonomyMapping_categoryId_idx" ON "commerce"."CommerceStoreCategoryTaxonomyMapping"("categoryId");',
  'CREATE UNIQUE INDEX "CommerceShopProfile_shopId_key" ON "commerce"."CommerceShopProfile"("shopId");',
  'CREATE INDEX "CommerceShopProfile_activeCategoryId_idx" ON "commerce"."CommerceShopProfile"("activeCategoryId");',
  'CREATE INDEX "CommerceShopProfile_pendingCategoryId_idx" ON "commerce"."CommerceShopProfile"("pendingCategoryId");',
  'CREATE INDEX "CommerceShopProfile_pendingPromptRevisionId_idx" ON "commerce"."CommerceShopProfile"("pendingPromptRevisionId");',
  'CREATE UNIQUE INDEX "MerchantKnowledgePurpose_key_key" ON "commerce"."MerchantKnowledgePurpose"("key");',
  'CREATE INDEX "MerchantKnowledgePurpose_active_displayOrder_key_idx" ON "commerce"."MerchantKnowledgePurpose"("active", "displayOrder", "key");',
  'CREATE UNIQUE INDEX "MerchantKnowledgeDataFormat_key_key" ON "commerce"."MerchantKnowledgeDataFormat"("key");',
  'CREATE INDEX "MerchantKnowledgeDataFormat_active_displayOrder_key_idx" ON "commerce"."MerchantKnowledgeDataFormat"("active", "displayOrder", "key");',
  'CREATE INDEX "MerchantKnowledgePurposeDataFormat_dataFormatId_purposeId_idx" ON "commerce"."MerchantKnowledgePurposeDataFormat"("dataFormatId", "purposeId");',
  'CREATE UNIQUE INDEX "MerchantKnowledgeUploadedAsset_objectKey_key" ON "commerce"."MerchantKnowledgeUploadedAsset"("objectKey");',
  'CREATE INDEX "MerchantKnowledgeUploadedAsset_shopId_status_createdAt_idx" ON "commerce"."MerchantKnowledgeUploadedAsset"("shopId", "status", "createdAt");',
  'CREATE INDEX "MerchantKnowledgeUploadedAsset_dataFormatId_status_idx" ON "commerce"."MerchantKnowledgeUploadedAsset"("dataFormatId", "status");',
  'CREATE INDEX "MerchantKnowledgeSource_shopId_purposeId_position_idx" ON "commerce"."MerchantKnowledgeSource"("shopId", "purposeId", "position");',
  'CREATE INDEX "MerchantKnowledgeSource_shopId_dataFormatId_position_idx" ON "commerce"."MerchantKnowledgeSource"("shopId", "dataFormatId", "position");',
  'CREATE INDEX "MerchantKnowledgeSource_shopId_languageTag_idx" ON "commerce"."MerchantKnowledgeSource"("shopId", "languageTag");',
  'CREATE INDEX "MerchantKnowledgeSourceRevision_sourceId_status_generation_idx" ON "commerce"."MerchantKnowledgeSourceRevision"("sourceId", "status", "generation");',
  'CREATE INDEX "MerchantKnowledgeSourceRevision_uploadedAssetId_idx" ON "commerce"."MerchantKnowledgeSourceRevision"("uploadedAssetId");',
  'CREATE INDEX "MerchantKnowledgeSourceRevision_status_requestedAt_idx" ON "commerce"."MerchantKnowledgeSourceRevision"("status", "requestedAt");',
  'CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_one_active_per_source" ON commerce."MerchantKnowledgeSourceRevision" ("sourceId") WHERE "status" = \'ACTIVE\';',
  'CREATE INDEX "MerchantKnowledgeChunk_revisionId_ordinal_idx" ON "commerce"."MerchantKnowledgeChunk"("revisionId", "ordinal");',
  'CREATE INDEX "MerchantKnowledgeChunk_embeddingIndexVersion_embeddingDimensions_idx" ON "commerce"."MerchantKnowledgeChunk"("embeddingIndexVersion", "embeddingDimensions");',
];

const inlineConstraints = [
  'CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "CommerceShopProfile_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgePurpose_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgeDataFormat_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgePurposeDataFormat_pkey" PRIMARY KEY ("purposeId", "dataFormatId")',
  'CONSTRAINT "MerchantKnowledgeUploadedAsset_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgeSource_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgeSource_shopId_position_key" UNIQUE ("shopId", "position")',
  'CONSTRAINT "MerchantKnowledgeSourceRevision_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgeSourceRevision_sourceId_generation_key" UNIQUE ("sourceId", "generation")',
  'CONSTRAINT "MerchantKnowledgeChunk_pkey" PRIMARY KEY ("id")',
  'CONSTRAINT "MerchantKnowledgeChunk_revisionId_ordinal_key" UNIQUE ("revisionId", "ordinal")',
];

const extractCheck = (sql, name) => {
  const marker = new RegExp(`CONSTRAINT "${name}"\\s+CHECK\\s+\\(`);
  const match = marker.exec(sql);
  assert.ok(match, `${name} missing`);
  const open = match.index + match[0].lastIndexOf('(');
  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1;
    if (sql[index] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, index);
    }
  }
  assert.fail(`${name} has an unterminated CHECK expression`);
};

export function validateMigrationContract(sql) {
  const normalized = compact(sql);
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector\s*;/i, 'pgvector extension must be enabled');

  const enumNames = [...sql.matchAll(/CREATE TYPE "commerce"\."(MerchantKnowledge\w+)" AS ENUM \(([^)]*)\);/g)];
  assert.deepEqual(enumNames.map(match => match[1]).sort(), Object.keys(enumContracts).sort(), 'ARCH-023 enum set differs');
  for (const match of enumNames) {
    const actualValues = [...match[2].matchAll(/'([^']+)'/g)].map(value => value[1]);
    assert.deepEqual(actualValues, enumContracts[match[1]], `${match[1]} values differ`);
  }

  const alterations = [
    'ALTER TABLE "billing"."BillingPlanFeature" ADD COLUMN "configuration" JSONB NOT NULL DEFAULT \'{}\'::jsonb;',
    'ALTER TABLE "billing"."MerchantPricingPlanFeature" ADD COLUMN "configuration" JSONB NOT NULL DEFAULT \'{}\'::jsonb;',
    'ALTER TABLE "commerce"."CommercePromptTemplateCategory" ADD COLUMN "defaultTemplateId" TEXT;',
    'ALTER TABLE "commerce"."CommerceAgentPromptRevision" ADD COLUMN "sourceTemplateEditVersion" INTEGER;',
  ];
  for (const statement of alterations) assert.ok(normalized.includes(compact(statement)), `Required exact column alteration missing: ${statement}`);

  const tableNames = [...sql.matchAll(/CREATE TABLE "commerce"\."(\w+)"/g)].map(match => match[1]);
  assert.deepEqual(tableNames.sort(), Object.keys(tableColumns).sort(), 'ARCH-023 created table set differs');
  for (const [name, expectedColumns] of Object.entries(tableColumns)) {
    const match = sql.match(new RegExp(`CREATE TABLE "commerce"\\."${name}" \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(match, `${name} table definition missing`);
    const actualColumns = match[1].split('\n').map(line => line.trim().replace(/,$/, '')).filter(line => line.startsWith('"'));
    assert.deepEqual(actualColumns, expectedColumns, `${name} column types/nullability/defaults differ from contract`);
  }

  for (const statement of inlineConstraints) assert.ok(normalized.includes(compact(statement)), `Required key missing: ${statement}`);
  for (const foreignKey of foreignKeys) assert.ok(normalized.includes(compact(foreignKey)), `Exact foreign key contract missing: ${foreignKey}`);
  const expectedConstraintNames = [
    ...inlineConstraints.map(statement => statement.match(/CONSTRAINT "([^"]+)"/)?.[1]),
    ...foreignKeys.map(statement => statement.match(/CONSTRAINT "([^"]+)"/)?.[1]),
    ...Object.keys(checks),
  ].sort();
  const actualConstraintNames = [...sql.matchAll(/CONSTRAINT "([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(actualConstraintNames, expectedConstraintNames, 'ARCH-023 named constraint set differs');

  const actualIndexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX[^;]+;/g)].map(match => compact(match[0]));
  assert.deepEqual(actualIndexes.sort(), indexStatements.map(compact).sort(), 'ARCH-023 index definitions differ');

  const actualCheckNames = [...sql.matchAll(/CONSTRAINT "([^"]+)"\s+CHECK\s+\(/g)].map(match => match[1]).sort();
  assert.deepEqual(actualCheckNames, Object.keys(checks).sort(), 'ARCH-023 check constraint set differs');
  for (const [name, expected] of Object.entries(checks)) {
    assert.equal(expression(extractCheck(sql, name)), expression(expected), `${name} CHECK semantics differ`);
  }

  assert.match(normalized, /CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_one_active_per_source" ON commerce\."MerchantKnowledgeSourceRevision" \("sourceId"\) WHERE "status" = 'ACTIVE';/);
  assert.doesNotMatch(sql, /USING\s+(?:hnsw|ivfflat)|\b(?:HNSW|IVFFLAT)\b/i, 'ANN indexes are out of scope');
  assert.doesNotMatch(sql, /CREATE\s+TRIGGER|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i, 'ARCH-023 must not add triggers/functions');
  const insertTargets = [...sql.matchAll(/^INSERT INTO "([^"]+)"\."([^"]+)"/gm)].map(match => `${match[1]}.${match[2]}`);
  assert.deepEqual(insertTargets, ['commerce.MerchantKnowledgePurpose', 'commerce.MerchantKnowledgeDataFormat', 'commerce.MerchantKnowledgePurposeDataFormat']);
  assert.doesNotMatch(sql, /'merchant_knowledge'/i, 'Do not seed a Merchant Knowledge Feature, plan, Capability, Tool, or Release');
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|SCHEMA|COLUMN)|TRUNCATE\s+TABLE/i, 'Migration must be additive');
}
