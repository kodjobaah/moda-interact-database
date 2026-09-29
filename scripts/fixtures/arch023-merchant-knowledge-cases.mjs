import assert from 'node:assert/strict';

const execute = (db, sql) => db.$executeRawUnsafe(sql);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonHash = 'a'.repeat(64);
const timestamp = '2026-09-29T00:00:00.000Z';

async function reject(db, name, sql, expectedNames) {
  try {
    await execute(db, sql);
  } catch (error) {
    const details = `${error.meta?.message ?? ''} ${error.message ?? ''}`;
    assert.ok(expectedNames.some(expected => details.includes(expected)), `${name}: expected ${expectedNames.join(' or ')}; got ${details}`);
    console.log(`PASS rejects ${name}`);
    return;
  }
  assert.fail(`${name}: invalid write unexpectedly succeeded`);
}

async function insert(db, table, values) {
  const names = Object.keys(values);
  const columns = names.map(name => `"${name}"`).join(', ');
  const entries = names.map(name => values[name]);
  await execute(db, `INSERT INTO ${table} (${columns}) VALUES (${entries.join(', ')})`);
}

export async function seedArch023Cases(database) {
  return database.$transaction(async db => {
  await insert(db, 'public."PlatformAdmin"', {
    id: quote('arch023-admin'), email: quote('arch023@example.invalid'), role: quote('SUPER_ADMIN'), updatedAt: quote(timestamp),
  });
  await insert(db, 'commerce."Shop"', {id: quote('arch023-shop'), domain: quote('arch023.invalid'), updatedAt: quote(timestamp)});
  await insert(db, 'commerce."Shop"', {id: quote('arch023-shop-pending'), domain: quote('arch023-pending.invalid'), updatedAt: quote(timestamp)});
  await insert(db, 'commerce."Shop"', {id: quote('arch023-shop-active'), domain: quote('arch023-active.invalid'), updatedAt: quote(timestamp)});
  await insert(db, 'billing."Feature"', {
    id: quote('arch023-feature'), key: quote('arch023_fixture'), displayName: quote('ARCH-023 fixture'),
    activationMode: quote('ALWAYS_ENABLED'), updatedAt: quote(timestamp),
  });
  await insert(db, 'billing."BillingPlan"', {
    id: quote('arch023-billing-plan'), shopifyPlanHandle: quote('arch023_fixture'), name: quote('Fixture'), kind: quote('FREE'), updatedAt: quote(timestamp),
  });
  await insert(db, 'billing."BillingPlanFeature"', {
    id: quote('arch023-billing-plan-feature'), planId: quote('arch023-billing-plan'), featureId: quote('arch023-feature'),
  });
  await insert(db, 'billing."MerchantPricingPlan"', {
    id: quote('arch023-merchant-plan'), shopifyPlanHandle: quote('arch023_merchant_fixture'), displayName: quote('Fixture'),
    planKind: quote('FREE'), cataloguePosition: '0', includedRecoveryCredits: '0', allowancePeriod: quote('LIFETIME'),
    billingPeriod: quote('EVERY_30_DAYS'), recurringAmountMinor: '0', currency: quote('USD'), updatedAt: quote(timestamp),
  });
  for (const locale of ['cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant']) {
    await insert(db, 'billing."MerchantPricingPlanTranslation"', {
      id: quote(`arch023-merchant-plan-translation-${locale}`), merchantPricingPlanId: quote('arch023-merchant-plan'),
      locale: quote(locale), merchantDescription: quote('ARCH-023 fixture'), updatedAt: quote(timestamp),
    });
  }
  await insert(db, 'billing."MerchantPricingPlanFeature"', {
    merchantPricingPlanId: quote('arch023-merchant-plan'), featureId: quote('arch023-feature'), createdAt: quote(timestamp),
  });
  await insert(db, 'commerce."CommercePromptTemplateCategory"', {
    id: quote('arch023-category'), slug: quote('arch023-category'), displayName: quote('ARCH-023 Category'),
    createdByAdminId: quote('arch023-admin'), updatedByAdminId: quote('arch023-admin'), updatedAt: quote(timestamp),
  });
  await insert(db, 'commerce."CommercePromptTemplate"', {
    id: quote('arch023-template'), key: quote('arch023_template'), categoryId: quote('arch023-category'), displayName: quote('ARCH-023 Template'),
    createdByAdminId: quote('arch023-admin'), updatedByAdminId: quote('arch023-admin'), updatedAt: quote(timestamp),
  });
  await insert(db, 'commerce."CommerceAgentPrompt"', {id: quote('arch023-prompt'), scope: quote('SHOP'), shopId: quote('arch023-shop')});
  await insert(db, 'commerce."CommerceAgentPromptRevision"', {
    id: quote('arch023-prompt-revision'), promptId: quote('arch023-prompt'), revisionNumber: '1', promptText: quote('Fixture prompt'), updatedAt: quote(timestamp),
  });
  });
}

export async function verifyConfigurationDefaultsAndRoundTrip(db) {
  const billing = await db.$queryRawUnsafe('SELECT "configuration" FROM billing."BillingPlanFeature" WHERE id = \'arch023-billing-plan-feature\'');
  const merchant = await db.$queryRawUnsafe('SELECT "configuration" FROM billing."MerchantPricingPlanFeature" WHERE "merchantPricingPlanId" = \'arch023-merchant-plan\'');
  assert.deepEqual(billing[0].configuration, {});
  assert.deepEqual(merchant[0].configuration, {});
  const payload = '{"allowedSourceTypes":["WEB_PAGE","CSV"],"limit":7}';
  await execute(db, `UPDATE billing."MerchantPricingPlanFeature" SET "configuration"='${payload}'::jsonb WHERE "merchantPricingPlanId"='arch023-merchant-plan'`);
  const roundTrip = await db.$queryRawUnsafe('SELECT "configuration" FROM billing."MerchantPricingPlanFeature" WHERE "merchantPricingPlanId" = \'arch023-merchant-plan\'');
  assert.deepEqual(roundTrip[0].configuration, {allowedSourceTypes: ['WEB_PAGE', 'CSV'], limit: 7});
  console.log('PASS plan feature defaults and JSONB round-trip');
}

export async function runArch023Cases(db) {
  const purposeIds = Object.fromEntries((await db.$queryRawUnsafe('SELECT id, key FROM commerce."MerchantKnowledgePurpose"')).map(row => [row.key, row.id]));
  const formatIds = Object.fromEntries((await db.$queryRawUnsafe('SELECT id, key FROM commerce."MerchantKnowledgeDataFormat"')).map(row => [row.key, row.id]));
  const purpose = key => quote(purposeIds[key]);
  const format = key => quote(formatIds[key]);
  const shop = quote('arch023-shop');
  const category = quote('arch023-category');
  const profileTable = 'commerce."CommerceShopProfile"';
  const taxonomyTable = 'commerce."CommerceStoreCategoryTaxonomyMapping"';
  const assetTable = 'commerce."MerchantKnowledgeUploadedAsset"';
  const sourceTable = 'commerce."MerchantKnowledgeSource"';
  const revisionTable = 'commerce."MerchantKnowledgeSourceRevision"';
  const chunkTable = 'commerce."MerchantKnowledgeChunk"';

  await insert(db, taxonomyTable, {id: quote('arch023-taxonomy-valid'), categoryId: category, shopifyTaxonomyCategoryId: quote('shopify/test/valid'), weight: '1'});
  await reject(db, 'taxonomy mapping non-positive weight', `INSERT INTO ${taxonomyTable} ("id","categoryId","shopifyTaxonomyCategoryId","weight") VALUES ('arch023-taxonomy-invalid',${category},'shopify/test/invalid',0)`, ['CommerceStoreCategoryTaxonomyMapping_weight_positive']);

  await insert(db, profileTable, {id: quote('arch023-profile-valid'), shopId: shop});
  await insert(db, profileTable, {
    id: quote('arch023-profile-pending-valid'), shopId: quote('arch023-shop-pending'), pendingCategoryId: category,
    pendingPromptRevisionId: quote('arch023-prompt-revision'), pendingSelectionGeneration: '1', pendingSelectedAt: quote(timestamp),
  });
  await insert(db, profileTable, {
    id: quote('arch023-profile-active-valid'), shopId: quote('arch023-shop-active'), activeCategoryId: category, activeCategoryActivatedAt: quote(timestamp),
  });
  await reject(db, 'profile negative pending generation', `INSERT INTO ${profileTable} ("id","shopId","pendingSelectionGeneration") VALUES ('arch023-profile-generation',${shop},-1)`, ['CommerceShopProfile_pending_generation_nonnegative']);
  await reject(db, 'profile partial pending tuple', `INSERT INTO ${profileTable} ("id","shopId","pendingCategoryId") VALUES ('arch023-profile-pending',${shop},${category})`, ['CommerceShopProfile_pending_tuple_check']);
  await reject(db, 'profile active category without timestamp', `INSERT INTO ${profileTable} ("id","shopId","activeCategoryId") VALUES ('arch023-profile-active',${shop},${category})`, ['CommerceShopProfile_active_category_timestamp_check']);
  await reject(db, 'profile active timestamp without category', `INSERT INTO ${profileTable} ("id","shopId","activeCategoryActivatedAt") VALUES ('arch023-profile-time',${shop},'${timestamp}')`, ['CommerceShopProfile_active_category_timestamp_check']);

  const baseAsset = {shopId: shop, dataFormatId: format('CSV'), objectKey: quote('arch023/object'), originalFileName: quote('fixture.csv'), uploadExpiresAt: quote(timestamp)};
  await insert(db, assetTable, {id: quote('arch023-asset-available'), ...baseAsset, status: quote('AVAILABLE'), contentType: quote('text/csv'), sizeBytes: '10', sha256: quote(jsonHash), availableAt: quote(timestamp)});
  await reject(db, 'available asset missing metadata', `INSERT INTO ${assetTable} ("id","shopId","dataFormatId","status","objectKey","originalFileName","uploadExpiresAt") VALUES ('arch023-asset-missing',${shop},${format('CSV')},'AVAILABLE','arch023/missing','fixture.csv','${timestamp}')`, ['MerchantKnowledgeUploadedAsset_available_fields_check']);
  await reject(db, 'available asset non-positive size', `INSERT INTO ${assetTable} ("id","shopId","dataFormatId","status","objectKey","originalFileName","contentType","sizeBytes","sha256","uploadExpiresAt","availableAt") VALUES ('arch023-asset-size',${shop},${format('CSV')},'AVAILABLE','arch023/size','fixture.csv','text/csv',0,'${jsonHash}','${timestamp}','${timestamp}')`, ['MerchantKnowledgeUploadedAsset_available_fields_check']);
  await reject(db, 'available asset malformed hash', `INSERT INTO ${assetTable} ("id","shopId","dataFormatId","status","objectKey","originalFileName","contentType","sizeBytes","sha256","uploadExpiresAt","availableAt") VALUES ('arch023-asset-hash',${shop},${format('CSV')},'AVAILABLE','arch023/hash','fixture.csv','text/csv',10,'${'A'.repeat(64)}','${timestamp}','${timestamp}')`, ['MerchantKnowledgeUploadedAsset_available_fields_check']);

  const source = (id, position, generation, purposeId = purpose('PRODUCT_INFORMATION'), formatId = format('WEB_PAGE')) =>
    `INSERT INTO ${sourceTable} ("id","shopId","purposeId","dataFormatId","name","languageTag","position","currentGeneration") VALUES ('${id}',${shop},${purposeId},${formatId},'Fixture source','en',${position},${generation})`;
  await execute(db, source('arch023-source', 0, 0));
  await reject(db, 'source negative position', source('arch023-source-position', -1, 0), ['MerchantKnowledgeSource_position_nonnegative']);
  await reject(db, 'source negative generation', source('arch023-source-generation', 1, -1), ['MerchantKnowledgeSource_generation_nonnegative']);
  await reject(db, 'unsupported purpose/data format pair', source('arch023-source-pair', 1, 0, purpose('FAQ'), format('CSV')), ['MerchantKnowledgeSource_purposeDataFormat_fkey']);

  const revision = (id, sourceId, generation, status = 'PENDING', locator = `"requestedUrl","status"`, values = `'https://example.invalid/knowledge','${status}'`) =>
    `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason",${locator}) VALUES ('${id}','${sourceId}',${generation},'CREATE',${values})`;
  await execute(db, revision('arch023-revision-control', 'arch023-source', 1));
  await reject(db, 'revision with no locator', `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason") VALUES ('arch023-revision-no-locator','arch023-source',2,'CREATE')`, ['MerchantKnowledgeSourceRevision_locator_check']);
  await reject(db, 'revision with both locators', `INSERT INTO ${revisionTable} ("id","sourceId","uploadedAssetId","generation","reason","requestedUrl") VALUES ('arch023-revision-two-locators','arch023-source','arch023-asset-available',2,'CREATE','https://example.invalid')`, ['MerchantKnowledgeSourceRevision_locator_check']);
  await reject(db, 'revision resolved URL without requested URL', `INSERT INTO ${revisionTable} ("id","sourceId","uploadedAssetId","generation","reason","resolvedUrl") VALUES ('arch023-revision-resolved','arch023-source','arch023-asset-available',3,'CREATE','https://example.invalid/resolved')`, ['MerchantKnowledgeSourceRevision_resolved_url_check']);
  await reject(db, 'revision non-positive generation', `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason","requestedUrl") VALUES ('arch023-revision-generation','arch023-source',0,'CREATE','https://example.invalid')`, ['MerchantKnowledgeSourceRevision_generation_positive']);

  const activeRevision = (id, generation, status = 'ACTIVE', sourceId = 'arch023-source') =>
    `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason","requestedUrl","status","contentUnits","contentHash") VALUES ('${id}','${sourceId}',${generation},'CREATE','https://example.invalid','${status}',1,'${jsonHash}')`;
  await execute(db, activeRevision('arch023-revision-active', 10));
  await reject(db, 'second ACTIVE revision for source', activeRevision('arch023-revision-active-second', 11), ['arch023-source']);
  await reject(db, 'ACTIVE revision missing content metadata', `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason","requestedUrl","status") VALUES ('arch023-revision-active-no-content','arch023-source',12,'CREATE','https://example.invalid','ACTIVE')`, ['MerchantKnowledgeSourceRevision_active_content_check']);
  await reject(db, 'SUPERSEDED revision missing content metadata', `INSERT INTO ${revisionTable} ("id","sourceId","generation","reason","requestedUrl","status") VALUES ('arch023-revision-superseded-no-content','arch023-source',13,'CREATE','https://example.invalid','SUPERSEDED')`, ['MerchantKnowledgeSourceRevision_active_content_check']);

  const chunk = (id, ordinal, units, hash, dimensions, embedding = '[1,2]') =>
    `INSERT INTO ${chunkTable} ("id","revisionId","ordinal","content","contentUnits","contentHash","embedding","embeddingProvider","embeddingModel","embeddingDimensions","embeddingIndexVersion") VALUES ('${id}','arch023-revision-active',${ordinal},'chunk',${units},'${hash}','${embedding}'::vector,'provider','model',${dimensions},'v1')`;
  await execute(db, chunk('arch023-chunk-valid', 0, 2, jsonHash, 2));
  await reject(db, 'chunk negative ordinal', chunk('arch023-chunk-ordinal', -1, 2, jsonHash, 2), ['MerchantKnowledgeChunk_ordinal_nonnegative']);
  await reject(db, 'chunk non-positive content units', chunk('arch023-chunk-units', 1, 0, jsonHash, 2), ['MerchantKnowledgeChunk_content_units_positive']);
  await reject(db, 'chunk non-positive embedding dimensions', chunk('arch023-chunk-dimensions', 2, 2, jsonHash, 0), ['MerchantKnowledgeChunk_embedding_dimensions_positive', 'MerchantKnowledgeChunk_embedding_dimensions_match']);
  await reject(db, 'chunk embedding dimension mismatch', chunk('arch023-chunk-vector-mismatch', 3, 2, jsonHash, 3), ['MerchantKnowledgeChunk_embedding_dimensions_match']);
  await reject(db, 'chunk malformed content hash', chunk('arch023-chunk-hash', 4, 2, 'A'.repeat(64), 2), ['MerchantKnowledgeChunk_content_hash_check']);

  const seedCounts = await db.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM commerce."MerchantKnowledgePurpose") AS purposes,
      (SELECT count(*)::int FROM commerce."MerchantKnowledgeDataFormat") AS formats,
      (SELECT count(*)::int FROM commerce."MerchantKnowledgePurposeDataFormat") AS pairs
  `);
  assert.deepEqual(seedCounts[0], {purposes: 7, formats: 3, pairs: 11});
  console.log('PASS exact catalogue seed counts');
}