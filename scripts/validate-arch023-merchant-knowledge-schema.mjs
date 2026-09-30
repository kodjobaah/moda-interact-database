import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schemaPath = process.env.ARCH023_SCHEMA_PATH ?? new URL('../prisma/schema.prisma', import.meta.url);
const schema = readFileSync(schemaPath, 'utf8');

const block = (kind, name) => {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(match, `${kind} ${name} missing`);
  return match[1];
};
const declarations = source => Object.fromEntries(source.split('\n')
  .map(line => line.trim().replace(/\s+/g, ' '))
  .filter(line => line && !line.startsWith('@@') && !line.startsWith('//'))
  .map(line => {
    const separator = line.search(/\s/);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const directives = source => source.split('\n')
  .map(line => line.trim().replace(/\s+/g, ' '))
  .filter(line => line.startsWith('@@'));
const assertModel = (name, fields, modelDirectives) => {
  const source = block('model', name);
  assert.deepEqual(declarations(source), fields, `${name} field declarations differ from ARCH-023 contract`);
  assert.deepEqual(directives(source), modelDirectives, `${name} indexes/keys/schema directives differ from ARCH-023 contract`);
};
const assertField = (model, name, expected) => {
  const source = declarations(block('model', model));
  assert.equal(source[name], expected, `${model}.${name} declaration differs from ARCH-023 contract`);
};
const assertDirective = (model, expected) => {
  assert.ok(directives(block('model', model)).includes(expected), `${model} is missing ${expected}`);
};

const enumContracts = {
  MerchantKnowledgeInputKind: ['REMOTE_URL', 'UPLOAD'],
  MerchantKnowledgeRevisionReason: ['CREATE', 'URL_CHANGE', 'FILE_REPLACE', 'REFRESH', 'REPROCESS', 'ENTITLEMENT_CHANGE'],
  MerchantKnowledgeRevisionStatus: ['PENDING', 'PROCESSING', 'ACTIVE', 'FAILED', 'SUPERSEDED'],
  MerchantKnowledgeUploadedAssetStatus: ['PENDING_UPLOAD', 'AVAILABLE', 'FAILED', 'DELETED'],
};
const enumNames = [...schema.matchAll(/^enum (\w+) \{/gm)].map(match => match[1]);
assert.ok(!enumNames.includes('MerchantKnowledgePurpose'), 'Purpose must remain table-backed');
assert.deepEqual(enumNames.filter(name => name.startsWith('MerchantKnowledge')).sort(), Object.keys(enumContracts).sort());
for (const [name, values] of Object.entries(enumContracts)) {
  const source = block('enum', name);
  const actual = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('@@')).map(line => line.split(/\s/)[0]);
  assert.deepEqual(actual, values, `${name} enum values differ from ARCH-023 contract`);
  assert.ok(directives(source).includes('@@schema("commerce")'), `${name} must use the commerce schema`);
}

assertField('BillingPlanFeature', 'configuration', 'Json @default("{}") @db.JsonB');
assertField('MerchantPricingPlanFeature', 'configuration', 'Json @default("{}") @db.JsonB');
assertDirective('BillingPlanFeature', '@@unique([planId, featureId])');
assertDirective('BillingPlanFeature', '@@index([featureId])');
assertDirective('MerchantPricingPlanFeature', '@@id([merchantPricingPlanId, featureId])');
assertDirective('MerchantPricingPlanFeature', '@@index([featureId])');

assertField('CommercePromptTemplateCategory', 'defaultTemplateId', 'String? @unique @db.Text');
assertField('CommercePromptTemplateCategory', 'templates', 'CommercePromptTemplate[] @relation("CommercePromptTemplateCategoryTemplates")');
assertField('CommercePromptTemplateCategory', 'defaultTemplate', 'CommercePromptTemplate? @relation("CommercePromptTemplateCategoryDefault", fields: [defaultTemplateId], references: [id], onDelete: Restrict, onUpdate: Restrict)');
assertField('CommercePromptTemplateCategory', 'taxonomyMappings', 'CommerceStoreCategoryTaxonomyMapping[]');
assertField('CommercePromptTemplateCategory', 'activeShopProfiles', 'CommerceShopProfile[] @relation("CommerceShopProfileActiveCategory")');
assertField('CommercePromptTemplateCategory', 'pendingShopProfiles', 'CommerceShopProfile[] @relation("CommerceShopProfilePendingCategory")');
assertField('CommercePromptTemplate', 'category', 'CommercePromptTemplateCategory @relation("CommercePromptTemplateCategoryTemplates", fields: [categoryId], references: [id], onDelete: Restrict, onUpdate: Restrict)');
assertField('CommercePromptTemplate', 'defaultForCategory', 'CommercePromptTemplateCategory? @relation("CommercePromptTemplateCategoryDefault")');
assertField('CommerceAgentPromptRevision', 'sourceTemplateEditVersion', 'Int?');
assertField('CommerceAgentPromptRevision', 'pendingForShopProfiles', 'CommerceShopProfile[] @relation("CommerceShopProfilePendingPromptRevision")');
assertField('Shop', 'commerceShopProfile', 'CommerceShopProfile?');
assertField('Shop', 'merchantKnowledgeSources', 'MerchantKnowledgeSource[]');
assertField('Shop', 'merchantKnowledgeUploadedAssets', 'MerchantKnowledgeUploadedAsset[]');

assertModel('CommerceStoreCategoryTaxonomyMapping', {
  id: 'String @id @default(cuid()) @db.Text',
  categoryId: 'String @db.Text',
  shopifyTaxonomyCategoryId: 'String @unique @db.VarChar(255)',
  weight: 'Int @default(1)',
  createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
  category: 'CommercePromptTemplateCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
}, ['@@index([categoryId])', '@@schema("commerce")']);

assertModel('CommerceShopProfile', {
  id: 'String @id @default(cuid()) @db.Text',
  shopId: 'String @unique @db.Text',
  activeCategoryId: 'String? @db.Text',
  activeCategoryActivatedAt: 'DateTime? @db.Timestamptz(3)',
  pendingCategoryId: 'String? @db.Text',
  pendingPromptRevisionId: 'String? @db.Text',
  pendingSelectionGeneration: 'Int @default(0)',
  pendingSelectedAt: 'DateTime? @db.Timestamptz(3)',
  createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
  shop: 'Shop @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  activeCategory: 'CommercePromptTemplateCategory? @relation("CommerceShopProfileActiveCategory", fields: [activeCategoryId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  pendingCategory: 'CommercePromptTemplateCategory? @relation("CommerceShopProfilePendingCategory", fields: [pendingCategoryId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  pendingPromptRevision: 'CommerceAgentPromptRevision? @relation("CommerceShopProfilePendingPromptRevision", fields: [pendingPromptRevisionId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
}, ['@@index([activeCategoryId])', '@@index([pendingCategoryId])', '@@index([pendingPromptRevisionId])', '@@schema("commerce")']);

assertModel('MerchantKnowledgePurpose', {
  id: 'String @id @default(cuid()) @db.Text', key: 'String @unique @db.VarChar(64)', displayName: 'String @db.VarChar(160)',
  active: 'Boolean @default(true)', displayOrder: 'Int @default(0)', createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)', dataFormats: 'MerchantKnowledgePurposeDataFormat[]', sources: 'MerchantKnowledgeSource[]',
}, ['@@index([active, displayOrder, key])', '@@schema("commerce")']);

assertModel('MerchantKnowledgeDataFormat', {
  id: 'String @id @default(cuid()) @db.Text', key: 'String @unique @db.VarChar(32)', displayName: 'String @db.VarChar(160)',
  inputKind: 'MerchantKnowledgeInputKind', canonicalExtension: 'String? @db.VarChar(16)', acceptedContentTypes: 'Json @db.JsonB',
  active: 'Boolean @default(true)', displayOrder: 'Int @default(0)', createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)', purposes: 'MerchantKnowledgePurposeDataFormat[]',
  sources: 'MerchantKnowledgeSource[]', uploadedAssets: 'MerchantKnowledgeUploadedAsset[]',
}, ['@@index([active, displayOrder, key])', '@@schema("commerce")']);

assertModel('MerchantKnowledgePurposeDataFormat', {
  purposeId: 'String @db.Text', dataFormatId: 'String @db.Text', createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  purpose: 'MerchantKnowledgePurpose @relation(fields: [purposeId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  dataFormat: 'MerchantKnowledgeDataFormat @relation(fields: [dataFormatId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  sources: 'MerchantKnowledgeSource[] @relation("MerchantKnowledgeSourcePurposeDataFormat")',
}, ['@@id([purposeId, dataFormatId])', '@@index([dataFormatId, purposeId])', '@@schema("commerce")']);

assertModel('MerchantKnowledgeUploadedAsset', {
  id: 'String @id @default(cuid()) @db.Text', shopId: 'String @db.Text', dataFormatId: 'String @db.Text',
  status: 'MerchantKnowledgeUploadedAssetStatus @default(PENDING_UPLOAD)', objectKey: 'String @unique @db.Text',
  originalFileName: 'String @db.VarChar(255)', contentType: 'String? @db.VarChar(128)', sizeBytes: 'BigInt?',
  sha256: 'String? @db.VarChar(64)', uploadExpiresAt: 'DateTime @db.Timestamptz(3)', availableAt: 'DateTime? @db.Timestamptz(3)',
  failureCode: 'String? @db.VarChar(128)', createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
  shop: 'Shop @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  dataFormat: 'MerchantKnowledgeDataFormat @relation(fields: [dataFormatId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  revisions: 'MerchantKnowledgeSourceRevision[]',
}, ['@@index([shopId, status, createdAt])', '@@index([dataFormatId, status])', '@@schema("commerce")']);

assertModel('MerchantKnowledgeSource', {
  id: 'String @id @default(cuid()) @db.Text', shopId: 'String @db.Text', purposeId: 'String @db.Text', dataFormatId: 'String @db.Text',
  name: 'String @db.VarChar(160)', languageTag: 'String @db.VarChar(16)', position: 'Int', currentGeneration: 'Int @default(0)',
  createdAt: 'DateTime @default(now()) @db.Timestamptz(3)', updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
  shop: 'Shop @relation(fields: [shopId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  purpose: 'MerchantKnowledgePurpose @relation(fields: [purposeId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  dataFormat: 'MerchantKnowledgeDataFormat @relation(fields: [dataFormatId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  purposeDataFormat: 'MerchantKnowledgePurposeDataFormat @relation("MerchantKnowledgeSourcePurposeDataFormat", fields: [purposeId, dataFormatId], references: [purposeId, dataFormatId], onDelete: Restrict, onUpdate: Restrict)',
  revisions: 'MerchantKnowledgeSourceRevision[]',
}, ['@@unique([shopId, position])', '@@index([shopId, purposeId, position])', '@@index([shopId, dataFormatId, position])', '@@index([shopId, languageTag])', '@@schema("commerce")']);

assertModel('MerchantKnowledgeSourceRevision', {
  id: 'String @id @default(cuid()) @db.Text', sourceId: 'String @db.Text', uploadedAssetId: 'String? @db.Text', generation: 'Int',
  reason: 'MerchantKnowledgeRevisionReason', requestedUrl: 'String? @db.VarChar(2048)', resolvedUrl: 'String? @db.VarChar(2048)',
  status: 'MerchantKnowledgeRevisionStatus @default(PENDING)', contentType: 'String? @db.VarChar(128)', httpStatus: 'Int?',
  normalizedContent: 'String? @db.Text', contentUnits: 'Int?', contentHash: 'String? @db.VarChar(64)', truncated: 'Boolean @default(false)',
  failureCode: 'String? @db.VarChar(128)', requestedAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  processingStartedAt: 'DateTime? @db.Timestamptz(3)', fetchedAt: 'DateTime? @db.Timestamptz(3)', completedAt: 'DateTime? @db.Timestamptz(3)',
  createdAt: 'DateTime @default(now()) @db.Timestamptz(3)', updatedAt: 'DateTime @default(now()) @updatedAt @db.Timestamptz(3)',
  source: 'MerchantKnowledgeSource @relation(fields: [sourceId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
  uploadedAsset: 'MerchantKnowledgeUploadedAsset? @relation(fields: [uploadedAssetId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
  chunks: 'MerchantKnowledgeChunk[]',
}, ['@@unique([sourceId, generation])', '@@index([sourceId, status, generation])', '@@index([uploadedAssetId])', '@@index([status, requestedAt])', '@@schema("commerce")']);

assertModel('MerchantKnowledgeChunk', {
  id: 'String @id @default(cuid()) @db.Text', revisionId: 'String @db.Text', ordinal: 'Int', content: 'String @db.Text',
  contentUnits: 'Int', contentHash: 'String @db.VarChar(64)', embedding: 'Unsupported("vector")',
  embeddingProvider: 'String @db.VarChar(64)', embeddingModel: 'String @db.VarChar(255)', embeddingDimensions: 'Int',
  embeddingIndexVersion: 'String @db.VarChar(64)', createdAt: 'DateTime @default(now()) @db.Timestamptz(3)',
  revision: 'MerchantKnowledgeSourceRevision @relation(fields: [revisionId], references: [id], onDelete: Cascade, onUpdate: Restrict)',
}, ['@@unique([revisionId, ordinal])', '@@index([revisionId, ordinal])', '@@index([embeddingIndexVersion, embeddingDimensions])', '@@schema("commerce")']);

const modelNames = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]);
const expectedMerchantModels = [
  'MerchantKnowledgePurpose', 'MerchantKnowledgeDataFormat', 'MerchantKnowledgePurposeDataFormat',
  'MerchantKnowledgeUploadedAsset', 'MerchantKnowledgeSource', 'MerchantKnowledgeSourceRevision', 'MerchantKnowledgeChunk',
].sort();
assert.deepEqual(modelNames.filter(name => name.startsWith('MerchantKnowledge')).sort(), expectedMerchantModels);
assert.doesNotMatch(schema, /MerchantKnowledge(?:Plan|Entitlement)\w*\s*\{/m, 'No Merchant Knowledge entitlement model is allowed');
assert.doesNotMatch(schema, /merchant_knowledge/i, 'Merchant Knowledge must not be coupled to a Feature key or plan-specific database rule');
assert.doesNotMatch(schema, /(?:required|mandatory)[^\n]*(?:MerchantKnowledge|merchant_knowledge)|(?:MerchantKnowledge|merchant_knowledge)[^\n]*(?:required|mandatory)/i, 'No Merchant Knowledge-specific required-plan constraint is allowed');
assert.doesNotMatch(schema, /@@index\([^\n]*(?:hnsw|ivfflat)|\b(?:HNSW|IVFFLAT)\b/i, 'No ANN index is allowed');

console.log('ARCH-023 Prisma schema exact contract passed.');
