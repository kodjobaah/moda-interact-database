import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const expectedModels = [
  'CommerceShopProfile',
  'CommerceStoreCategoryTaxonomyMapping',
  'MerchantKnowledgeChunk',
  'MerchantKnowledgeDataFormat',
  'MerchantKnowledgePurpose',
  'MerchantKnowledgePurposeDataFormat',
  'MerchantKnowledgeSource',
  'MerchantKnowledgeSourceRevision',
  'MerchantKnowledgeUploadedAsset',
].sort();
const expectedEnums = [
  'MerchantKnowledgeInputKind',
  'MerchantKnowledgeRevisionReason',
  'MerchantKnowledgeRevisionStatus',
  'MerchantKnowledgeUploadedAssetStatus',
].sort();
const modelNames = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]);
const enumNames = [...schema.matchAll(/^enum (\w+) \{/gm)].map(match => match[1]);
const merchantModels = modelNames.filter(name => name.startsWith('MerchantKnowledge')).sort();
const merchantEnums = enumNames.filter(name => name.startsWith('MerchantKnowledge')).sort();

assert.deepEqual(merchantModels, expectedModels.filter(name => name.startsWith('MerchantKnowledge')));
assert.deepEqual(merchantEnums, expectedEnums);
assert.ok(!enumNames.includes('MerchantKnowledgePurpose'), 'Purpose must remain table-backed');

const block = (kind, name) => {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  assert.ok(match, `${kind} ${name} missing`);
  return match[1];
};
const field = (source, name, pattern) => {
  assert.match(source, new RegExp(`^\\s*${name}\\s+${pattern}`, 'm'), `${name} field missing or changed`);
};
const has = (source, pattern, label) => assert.match(source, pattern, `${label} missing`);

field(block('model', 'BillingPlanFeature'), 'configuration', 'Json\\s+@default\\("\\{\\}"\\)\\s+@db\\.JsonB');
field(block('model', 'MerchantPricingPlanFeature'), 'configuration', 'Json\\s+@default\\("\\{\\}"\\)\\s+@db\\.JsonB');

const category = block('model', 'CommercePromptTemplateCategory');
field(category, 'defaultTemplateId', 'String\\?\\s+@unique\\s+@db\\.Text');
has(category, /@relation\("CommercePromptTemplateCategoryTemplates"\)/, 'named template-membership relation');
has(category, /@relation\("CommercePromptTemplateCategoryDefault", fields: \[defaultTemplateId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/, 'default template relation');
field(category, 'taxonomyMappings', 'CommerceStoreCategoryTaxonomyMapping\\[\\]');
has(category, /@relation\("CommerceShopProfileActiveCategory"\)/, 'active profile reverse relation');
has(category, /@relation\("CommerceShopProfilePendingCategory"\)/, 'pending profile reverse relation');

const template = block('model', 'CommercePromptTemplate');
has(template, /@relation\("CommercePromptTemplateCategoryTemplates", fields: \[categoryId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict\)/, 'named category relation');
has(template, /defaultForCategory\s+CommercePromptTemplateCategory\?\s+@relation\("CommercePromptTemplateCategoryDefault"\)/, 'default category reverse relation');

field(block('model', 'CommerceAgentPromptRevision'), 'sourceTemplateEditVersion', 'Int\\?');
has(block('model', 'CommerceAgentPromptRevision'), /pendingForShopProfiles\s+CommerceShopProfile\[\]\s+@relation\("CommerceShopProfilePendingPromptRevision"\)/, 'pending profile revision reverse relation');
has(block('model', 'Shop'), /^\s*commerceShopProfile\s+CommerceShopProfile\?$/m, 'Shop profile reverse relation');
field(block('model', 'Shop'), 'merchantKnowledgeSources', 'MerchantKnowledgeSource\\[\\]');
field(block('model', 'Shop'), 'merchantKnowledgeUploadedAssets', 'MerchantKnowledgeUploadedAsset\\[\\]');

const requiredFields = {
  CommerceStoreCategoryTaxonomyMapping: ['id', 'categoryId', 'shopifyTaxonomyCategoryId', 'weight', 'createdAt', 'updatedAt', 'category'],
  CommerceShopProfile: ['id', 'shopId', 'activeCategoryId', 'activeCategoryActivatedAt', 'pendingCategoryId', 'pendingPromptRevisionId', 'pendingSelectionGeneration', 'pendingSelectedAt', 'createdAt', 'updatedAt', 'shop', 'activeCategory', 'pendingCategory', 'pendingPromptRevision'],
  MerchantKnowledgePurpose: ['id', 'key', 'displayName', 'active', 'displayOrder', 'createdAt', 'updatedAt', 'dataFormats', 'sources'],
  MerchantKnowledgeDataFormat: ['id', 'key', 'displayName', 'inputKind', 'canonicalExtension', 'acceptedContentTypes', 'active', 'displayOrder', 'createdAt', 'updatedAt', 'purposes', 'sources', 'uploadedAssets'],
  MerchantKnowledgePurposeDataFormat: ['purposeId', 'dataFormatId', 'createdAt', 'purpose', 'dataFormat', 'sources'],
  MerchantKnowledgeUploadedAsset: ['id', 'shopId', 'dataFormatId', 'status', 'objectKey', 'originalFileName', 'contentType', 'sizeBytes', 'sha256', 'uploadExpiresAt', 'availableAt', 'failureCode', 'createdAt', 'updatedAt', 'shop', 'dataFormat', 'revisions'],
  MerchantKnowledgeSource: ['id', 'shopId', 'purposeId', 'dataFormatId', 'name', 'languageTag', 'position', 'currentGeneration', 'createdAt', 'updatedAt', 'shop', 'purpose', 'dataFormat', 'purposeDataFormat', 'revisions'],
  MerchantKnowledgeSourceRevision: ['id', 'sourceId', 'uploadedAssetId', 'generation', 'reason', 'requestedUrl', 'resolvedUrl', 'status', 'contentType', 'httpStatus', 'normalizedContent', 'contentUnits', 'contentHash', 'truncated', 'failureCode', 'requestedAt', 'processingStartedAt', 'fetchedAt', 'completedAt', 'createdAt', 'updatedAt', 'source', 'uploadedAsset', 'chunks'],
  MerchantKnowledgeChunk: ['id', 'revisionId', 'ordinal', 'content', 'contentUnits', 'contentHash', 'embedding', 'embeddingProvider', 'embeddingModel', 'embeddingDimensions', 'embeddingIndexVersion', 'createdAt', 'revision'],
};
for (const [model, names] of Object.entries(requiredFields)) {
  const source = block('model', model);
  for (const name of names) assert.match(source, new RegExp(`^\\s*${name}\\s+`, 'm'), `${model}.${name} missing`);
}

const indexedContracts = {
  CommerceStoreCategoryTaxonomyMapping: [/@unique/, /@@index\(\[categoryId\]\)/],
  CommerceShopProfile: [/@unique/, /@@index\(\[activeCategoryId\]\)/, /@@index\(\[pendingCategoryId\]\)/, /@@index\(\[pendingPromptRevisionId\]\)/],
  MerchantKnowledgePurpose: [/@unique/, /@@index\(\[active, displayOrder, key\]\)/],
  MerchantKnowledgeDataFormat: [/@unique/, /@@index\(\[active, displayOrder, key\]\)/],
  MerchantKnowledgePurposeDataFormat: [ /@@id\(\[purposeId, dataFormatId\]\)/, /@@index\(\[dataFormatId, purposeId\]\)/],
  MerchantKnowledgeUploadedAsset: [/@unique/, /@@index\(\[shopId, status, createdAt\]\)/, /@@index\(\[dataFormatId, status\]\)/],
  MerchantKnowledgeSource: [/@@unique\(\[shopId, position\]\)/, /@@index\(\[shopId, purposeId, position\]\)/, /@@index\(\[shopId, dataFormatId, position\]\)/, /@@index\(\[shopId, languageTag\]\)/],
  MerchantKnowledgeSourceRevision: [/@@unique\(\[sourceId, generation\]\)/, /@@index\(\[sourceId, status, generation\]\)/, /@@index\(\[uploadedAssetId\]\)/, /@@index\(\[status, requestedAt\]\)/],
  MerchantKnowledgeChunk: [/@@unique\(\[revisionId, ordinal\]\)/, /@@index\(\[revisionId, ordinal\]\)/, /@@index\(\[embeddingIndexVersion, embeddingDimensions\]\)/],
};
for (const [model, patterns] of Object.entries(indexedContracts)) {
  const source = block('model', model);
  for (const pattern of patterns) has(source, pattern, `${model} index/unique contract`);
}

for (const value of ['REMOTE_URL', 'UPLOAD', 'URL_CHANGE', 'FILE_REPLACE', 'REFRESH', 'REPROCESS', 'ENTITLEMENT_CHANGE', 'PENDING', 'PROCESSING', 'ACTIVE', 'FAILED', 'SUPERSEDED', 'PENDING_UPLOAD', 'AVAILABLE', 'DELETED']) {
  assert.ok(schema.includes(value), `Enum value ${value} missing`);
}
assert.match(block('model', 'MerchantKnowledgeChunk'), /embedding\s+Unsupported\("vector"\)/);
assert.doesNotMatch(schema, /MerchantKnowledge\w*\s+\w+.*@default\(\[\]\).*ANN/i, 'No ANN index or vector list contract is allowed');
assert.doesNotMatch(schema, /MerchantKnowledge(?:Plan|Entitlement)\w*\s+\w+\s*\{/m, 'No Merchant Knowledge entitlement model is allowed');

console.log('ARCH-023 Prisma schema contract passed.');