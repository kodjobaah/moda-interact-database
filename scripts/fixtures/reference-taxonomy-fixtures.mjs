import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const productFeature = 'feature-product-search';
const time = '2026-11-01T00:00:00Z';
const hash = 'a'.repeat(64);
const names = ['commerce_resolve_product_categories', 'commerce_search_products', 'commerce_get_product'];
const table = name => `commerce."${name}"`;
const literal = value => value === null ? 'NULL'
  : typeof value === 'boolean' || typeof value === 'number' ? String(value)
    : `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'${typeof value === 'object' ? '::jsonb' : ''}`;
const insert = (target, row) => `INSERT INTO ${target} (${Object.keys(row).map(key => `"${key}"`).join(',')})
  VALUES (${Object.values(row).map(literal).join(',')});`;
const published = {
  toolId: 'reference-tool-0', toolRevisionId: 'reference-revision-0',
  toolName: names[0], definitionVersion: '1.0.0', capabilityKeys: [names[0]],
};
const builtIns = ['commerce_get_discount_options', 'commerce_get_discount_details'].map(toolName => ({
  kind: 'BUILT_IN', toolName, definitionVersion: '1.0.0', contractHash: hash,
}));

function seedIdentity({ sql }) {
  sql(insert(table('Shop'), { id: 'reference-shop', domain: 'reference.invalid', updatedAt: time }));
  sql(insert(table('Shop'), { id: 'reference-other-shop', domain: 'reference-other.invalid', updatedAt: time }));
  sql(insert('public."PlatformAdmin"', { id: 'reference-admin', email: 'reference@example.invalid', updatedAt: time }));
  sql(insert('billing."Feature"', {
    id: 'reference-optional', key: 'reference_optional', displayName: 'Unrelated optional feature',
    activationMode: 'MERCHANT_OPT_IN', updatedAt: time,
  }));
  sql(insert('shopify."ShopSettings"', { id: 'reference-settings', shopId: 'reference-shop', updatedAt: time }));
  sql(insert(table('CommerceFeatureConfiguration'), { featureId: productFeature, behaviourPrompt: 'preserved policy' }));
  sql(insert(table('CommercePromptTemplateCategory'), {
    id: 'reference-category', slug: 'reference', displayName: 'Reference category',
    createdByAdminId: 'reference-admin', updatedByAdminId: 'reference-admin',
  }));
  sql(insert(table('CommerceStoreCategoryTaxonomyMapping'), {
    id: 'reference-mapping', categoryId: 'reference-category', shopifyTaxonomyCategoryId: 'native-reference',
  }));
  const purpose = sql(`SELECT "purposeId" FROM commerce."MerchantKnowledgePurposeDataFormat" LIMIT 1;`);
  const format = sql(`SELECT "dataFormatId" FROM commerce."MerchantKnowledgePurposeDataFormat"
    WHERE "purposeId"=${literal(purpose)} LIMIT 1;`);
  sql(insert(table('MerchantKnowledgeSource'), {
    id: 'reference-knowledge', shopId: 'reference-shop', purposeId: purpose, dataFormatId: format,
    name: 'Preserved knowledge', languageTag: 'en', position: 0,
  }));
  sql(insert(table('MerchantKnowledgeSourceRevision'), {
    id: 'reference-knowledge-revision', sourceId: 'reference-knowledge', generation: 1, reason: 'CREATE',
    requestedUrl: 'https://example.invalid/knowledge',
  }));
  sql(`INSERT INTO commerce."MerchantKnowledgeChunk"
    (id,"revisionId",ordinal,content,"contentUnits","contentHash",embedding,
     "embeddingProvider","embeddingModel","embeddingDimensions","embeddingIndexVersion")
    VALUES ('reference-chunk','reference-knowledge-revision',0,'Preserved merchant knowledge',1,
      '${hash}','[1,0,0]'::vector,'fixture','fixture',3,'v1');`);
  for (const [index, name] of names.entries()) {
    const toolId = `reference-tool-${index}`;
    const capabilityId = `reference-capability-${index}`;
    sql(insert(table('CommerceTool'), { id: toolId, name, displayName: name, enabled: index !== 2 }));
    sql(insert(table('CommerceCapability'), {
      id: capabilityId, key: name, displayName: name, featureId: productFeature, toolId, enabled: index !== 2,
    }));
    for (const [action, identity] of [['CREATE_TOOL', { toolId }], ['CREATE_CAPABILITY', { capabilityId }]]) {
      sql(insert(table('CommerceAuditEvent'), {
        id: `system-commerce-tools:v1:TEST:${name}:fixture:${action}`,
        action, ...identity, actorAdminId: 'reference-admin', reason: 'Owned system fixture',
      }));
    }
  }
  sql(insert(table('CommerceToolRevision'), {
    id: published.toolRevisionId, toolId: published.toolId, revisionNumber: 1, status: 'PUBLISHED',
    contractVersion: 'commerce.v1', contentHash: hash, createdByAdminId: 'reference-admin',
    publishedByAdminId: 'reference-admin', publishedAt: time, createdAt: time, updatedAt: time, definitionVersion: '1.0.0',
    definition: { name: names[0], definitionVersion: '1.0.0', description: 'Fixture',
      inputSchema: {}, execution: {}, responseTemplate: {} },
  }));
  sql(insert(table('CommerceRelease'), {
    id: 'reference-release', runnerCompatibility: '^1.0.0', contractVersion: 'commerce.v1',
    responseContract: { version: 'response.v1', instructions: 'Fixture', detailsSchema: {} },
    responseContractHash: hash, createdByAdminId: 'reference-admin',
  }));
  sql(insert(table('CommerceReleaseFeature'), {
    releaseId: 'reference-release', featureId: productFeature, behaviourPrompt: 'preserved policy',
  }));
  sql(insert(table('CommerceReleaseCapability'), {
    releaseId: 'reference-release', capabilityId: 'reference-capability-0',
    featureId: productFeature, toolId: published.toolId, toolRevisionId: published.toolRevisionId, position: 0,
  }));
}
function conversationSql(id, shopId = 'reference-shop') {
  return insert(table('CheckoutRecovery'), {
    id: `${id}-recovery`, shopId, checkoutToken: id, updatedAt: time, lastExternalActivityAt: time,
  }) + insert('whatsapp."Conversation"', {
    id, checkoutRecoveryId: `${id}-recovery`, type: 'RECOVERY', inboundVersion: 2, updatedAt: time,
  });
}
function grantSql(id, overrides = {}) {
  return insert(table('CommerceConversationGrant'), {
    id: `${id}-grant`, shopId: 'reference-shop', conversationId: id,
    initialInboundVersion: 1, releaseId: 'reference-release',
    selectedCapabilityKeys: [names[0]], grantedTools: [published],
    runnerVersion: '1.0.0', ...overrides,
  });
}
export function seedUpgrade(fixture) {
  const { sql } = fixture;
  seedIdentity(fixture);
  sql(`UPDATE billing."Feature" SET "displayName"='Preserved product display',
    description='Preserved product description', active=false, "updatedAt"='2026-11-01T00:00:00Z'
    WHERE key='product_search';`);
  for (const [index, kind] of ['FREE', 'GROWTH', 'SCALE'].entries()) {
    const free = index === 0;
    const catalogue = insert('billing."MerchantPricingPlan"', {
      id: `reference-catalogue-${index}`, shopifyPlanHandle: `reference-${index}`,
      displayName: kind, planKind: free ? 'FREE' : 'PAID_METERED', isActive: index !== 2,
      cataloguePosition: index, includedRecoveryCredits: free ? 1 : 10,
      allowancePeriod: free ? 'LIFETIME' : 'EVERY_30_DAYS',
      billingPeriod: 'EVERY_30_DAYS', recurringAmountMinor: free ? 0 : 5000,
      currency: 'USD', updatedAt: time,
    });
    const locales = ['cs','da','de','en','es','fi','fr','it','ja','ko','nb','nl','pl','pt-BR','pt-PT','sv','th','tr','zh-Hans','zh-Hant'];
    const translations = locales.map(locale => insert('billing."MerchantPricingPlanTranslation"', {
      id: 'reference-translation-' + index + '-' + locale,
      merchantPricingPlanId: 'reference-catalogue-' + index, locale,
      merchantDescription: 'Preserved description ' + locale, updatedAt: time,
    })).join('');
    sql('BEGIN;' + catalogue + translations + 'COMMIT;');
    sql(insert('billing."BillingPlan"', {
      id: `reference-plan-${index}`, shopifyPlanHandle: `reference-${index}`,
      name: kind, kind: free ? 'FREE' : 'PAID_METERED', active: index !== 2, updatedAt: time,
    }));
  }
  sql(insert('billing."MerchantPricingPlanFeature"', {
    merchantPricingPlanId: 'reference-catalogue-0', featureId: productFeature,
    configuration: { preserved: 'catalogue' }, createdAt: time,
  }));
  sql(insert('billing."BillingPlanFeature"', {
    id: 'reference-existing-mapping', planId: 'reference-plan-0', featureId: productFeature,
    enabled: false, configuration: { preserved: 'operational' },
  }));
  sql(insert('billing."BillingPlanFeature"', {
    id: 'reference-unrelated-mapping', planId: 'reference-plan-0', featureId: 'reference-optional',
    enabled: false, configuration: { preserved: 'unrelated' },
  }));
  for (const [index, enabled] of [true, false].entries()) {
    sql(insert('billing."ShopFeaturePreference"', {
      id: `reference-preference-${index}`, shopId: index ? 'reference-other-shop' : 'reference-shop',
      featureId: productFeature, enabled, updatedAt: time,
    }));
  }
  sql(insert('billing."ShopFeaturePreference"', {
    id: 'reference-unrelated-preference', shopId: 'reference-shop',
    featureId: 'reference-optional', enabled: false, updatedAt: time,
  }));
  sql(conversationSql('reference-legacy') + grantSql('reference-legacy'));
}
export function capturePreserved({ json }, complete = false) {
  const preservedTables = [
    'commerce."Shop"', 'shopify."ShopSettings"', 'commerce."CheckoutRecovery"', 'whatsapp."Conversation"',
    'commerce."CommerceFeatureConfiguration"', 'commerce."CommerceStoreCategoryTaxonomyMapping"',
    'commerce."CommerceTool"', 'commerce."CommerceToolRevision"', 'commerce."CommerceCapability"',
    'commerce."CommerceRelease"', 'commerce."CommerceReleaseFeature"', 'commerce."CommerceReleaseCapability"',
    'commerce."CommerceAuditEvent"', 'commerce."CommerceConversationGrant"',
    'commerce."MerchantKnowledgeSource"', 'commerce."MerchantKnowledgeSourceRevision"', 'commerce."MerchantKnowledgeChunk"',
    'billing."MerchantPricingPlan"', 'billing."MerchantPricingPlanTranslation"', 'billing."BillingPlan"', 'billing."Subscription"',
  ];
  const result = {};
  for (const target of preservedTables) {
    result[target] = json(`(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]')
      FROM ${target} row)`);
  }
  for (const target of ['Feature', 'MerchantPricingPlanFeature', 'BillingPlanFeature', 'ShopFeaturePreference']) {
    const predicate = target === 'Feature' ? "key <> 'product_search'"
      : `"featureId" <> '${productFeature}'`;
    result[target] = json(`(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]')
      FROM billing."${target}" row ${complete ? '' : `WHERE ${predicate}`})`);
  }
  return result;
}
export function captureGuards({ json }) {
  return json(`jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_array(oid,proname,proowner,proacl) ORDER BY proname)
      FROM pg_proc WHERE oid IN ('commerce.arch020_grant_tools(jsonb)'::regprocedure,
        'commerce.arch021_conversation_grant_guard()'::regprocedure)),
    'triggers',(SELECT jsonb_agg(jsonb_build_array(oid,tgname,tgfoid,tgenabled,pg_get_triggerdef(oid)) ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid='commerce."CommerceConversationGrant"'::regclass AND NOT tgisinternal),
    'checks',(SELECT jsonb_agg(jsonb_build_array(oid,conname,pg_get_constraintdef(oid)) ORDER BY conname)
      FROM pg_constraint WHERE conrelid='commerce."CommerceConversationGrant"'::regclass))`);
}
export function assertConversion({ sql, json }, mode) {
  const feature = json(`(SELECT to_jsonb(row) FROM billing."Feature" row WHERE key='product_search')`);
  assert.equal(feature.id, productFeature);
  assert.equal(feature.displayName, mode === 'upgrade' ? 'Preserved product display' : 'Product Search');
  if (mode === 'upgrade') assert.equal(feature.description, 'Preserved product description');
  assert.equal(feature.activationMode, 'ALWAYS_ENABLED');
  assert.equal(feature.systemRequired, true);
  assert.equal(feature.active, true);
  assert.equal(sql(`SELECT count(*) FROM billing."MerchantPricingPlan" p WHERE NOT EXISTS (
    SELECT 1 FROM billing."MerchantPricingPlanFeature" m WHERE m."merchantPricingPlanId"=p.id AND m."featureId"='${productFeature}');`), '0');
  assert.equal(sql(`SELECT count(*) FROM billing."BillingPlan" p WHERE NOT EXISTS (
    SELECT 1 FROM billing."BillingPlanFeature" m WHERE m."planId"=p.id AND m."featureId"='${productFeature}' AND m.enabled);`), '0');
  assert.equal(sql(`SELECT count(*) FROM billing."ShopFeaturePreference" WHERE "featureId"='${productFeature}';`), '0');
  if (mode === 'upgrade') {
    const catalogue = json(`(SELECT to_jsonb(row) FROM billing."MerchantPricingPlanFeature" row
      WHERE "merchantPricingPlanId"='reference-catalogue-0' AND "featureId"='${productFeature}')`);
    assert.deepEqual(catalogue.configuration, { preserved: 'catalogue' });
    assert.match(catalogue.createdAt, /^2026-11-01/);
    const operational = json(`(SELECT to_jsonb(row) FROM billing."BillingPlanFeature" row WHERE id='reference-existing-mapping')`);
    assert.deepEqual(operational.configuration, { preserved: 'operational' });
    assert.equal(operational.enabled, true);
    assert.equal(sql(`SELECT count(*) FROM billing."BillingPlanFeature"
      WHERE id='required-product-search:reference-plan-2' AND configuration='{}'::jsonb;`), '1');
  }
  console.log('PASS targeted required-feature policy, all plans, preserved configuration and obsolete preferences');
}
export function conflictSql(kind) {
  if (kind === 'missing-feature') {
    // This variant uses a fresh predecessor database, without inventory fixtures.
    return `DELETE FROM billing."Feature" WHERE key='product_search';`;
  }
  if (kind === 'lock-timeout') return '';
  if (kind === 'primary-collision') return insert('billing."BillingPlanFeature"', {
    id: 'required-product-search:reference-plan-1', planId: 'reference-plan-1', featureId: 'reference-optional',
  });
  const name = kind === 'unknown' ? 'reference_custom_tool' : names[0];
  const id = 'conflict-' + kind;
  return insert('public."PlatformAdmin"', {
    id: 'conflict-admin', email: 'conflict@example.invalid', updatedAt: time,
  }) + insert(table('CommerceTool'), {
    id, name: kind === 'wrong-tool' ? names[1] : name, displayName: 'Conflict', enabled: false,
  }) + insert(table('CommerceCapability'), {
    id, key: name, displayName: 'Conflict', featureId: productFeature, toolId: id, enabled: false,
  }) + (kind === 'wildcard-audit' ? ['CREATE_TOOL', 'CREATE_CAPABILITY'].map(action =>
    insert(table('CommerceAuditEvent'), {
      id: 'system-commerce-tools:v1:TEST:commerceXresolveXproductXcategories:bad:' + action,
      action, ...(action === 'CREATE_TOOL' ? { toolId: id } : { capabilityId: id }),
      actorAdminId: 'conflict-admin', reason: 'Wrong literal prefix',
    })).join('') : '');
}

export function runTaxonomyCases({ sql, json, reject }) {
  const generation = (id, overrides = {}) => ({
    id, environment: 'TEST', source: 'SHOPIFY_STANDARD_PRODUCT_TAXONOMY', taxonomyVersion: 'fixture',
    languageTag: 'en', sourceUrl: 'https://example.invalid/taxonomy', sourceSha256: hash,
    embeddingProvider: 'fixture', embeddingModel: 'fixture', embeddingDimensions: 3,
    embeddingIndexVersion: 'v1', embeddingTextVersion: 'v1',
    importFingerprint: createHash('sha256').update(id).digest('hex'),
    categoryCount: 2, completedAt: time, ...overrides,
  });
  const addGeneration = row => insert(table('ReferenceTaxonomyGeneration'), row);
  const category = (generationId, categoryId, overrides = {}) => ({
    generationId, categoryId, name: categoryId, fullName: categoryId, parentId: null, level: 0,
    embeddingDimensions: 3, ...overrides,
  });
  const addCategory = (row, vector = '[1,0,0]', ancestors = []) => {
    const fields = { ...row, embedding: vector };
    return `INSERT INTO commerce."ReferenceTaxonomyCategory"
      (${Object.keys(fields).map(key => '"' + key + '"').join(',')},"ancestorIds")
      VALUES (${Object.values(fields).map(literal).join(',')},
        ARRAY[${ancestors.map(literal).join(',')}]::text[]);`;
  };
  const columns = json(`(SELECT jsonb_object_agg(c.relname || '.' || a.attname,
    jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid)))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='commerce' AND c.relname IN ('ReferenceTaxonomyGeneration','ReferenceTaxonomyCategory'))`);
  assert.equal(Object.keys(columns).length, 27);
  const requiredTypes = {
    id: 'text', environment: 'commerce."CommerceEnvironment"', source: 'character varying(64)',
    taxonomyVersion: 'character varying(64)', languageTag: 'character varying(35)', sourceUrl: 'text',
    sourceSha256: 'character varying(64)', embeddingProvider: 'character varying(64)',
    embeddingModel: 'character varying(255)', embeddingDimensions: 'integer',
    embeddingIndexVersion: 'character varying(64)', embeddingTextVersion: 'character varying(64)',
    importFingerprint: 'character varying(64)', categoryCount: 'integer', isActive: 'boolean',
    completedAt: 'timestamp(3) with time zone', createdAt: 'timestamp(3) with time zone',
    activatedAt: 'timestamp(3) with time zone',
  };
  for (const [field, type] of Object.entries(requiredTypes)) {
    const column = columns[`ReferenceTaxonomyGeneration.${field}`];
    assert.equal(column.type, type, field);
    assert.equal(column.required, field !== 'activatedAt', field);
    if (!['isActive', 'createdAt'].includes(field)) assert.equal(column.default, null, field);
  }
  assert.equal(columns['ReferenceTaxonomyGeneration.isActive'].default, 'false');
  assert.match(columns['ReferenceTaxonomyGeneration.createdAt'].default, /CURRENT_TIMESTAMP|now\(\)/);
  for (const [field, type] of Object.entries({
    generationId: 'text', categoryId: 'text', name: 'text', fullName: 'text', parentId: 'text',
    level: 'integer', ancestorIds: 'text[]', embedding: 'vector', embeddingDimensions: 'integer',
  })) {
    assert.equal(columns[`ReferenceTaxonomyCategory.${field}`].type, type, field);
    assert.equal(columns[`ReferenceTaxonomyCategory.${field}`].required, field !== 'parentId', field);
  }
  assert.match(columns['ReferenceTaxonomyCategory.ancestorIds'].default, /ARRAY\[\]::text\[\]/);
  assert.equal(sql(`SELECT count(*) FROM pg_class WHERE oid IN (
    'commerce."ReferenceTaxonomyGeneration"'::regclass,'commerce."ReferenceTaxonomyCategory"'::regclass)
    AND relpersistence='p';`), '2');
  const indexes = json(`(SELECT jsonb_object_agg(indexname,indexdef) FROM pg_indexes WHERE schemaname='commerce'
    AND tablename IN ('ReferenceTaxonomyGeneration','ReferenceTaxonomyCategory'))`);
  assert.equal(Object.keys(indexes).length, 6);
  assert.match(indexes.ReferenceTaxonomyGeneration_active_corpus_key, /UNIQUE.*btree.*environment.*source.*languageTag.*WHERE.*"isActive".*true/);
  const foreignKeys = json(`(SELECT jsonb_object_agg(conname,jsonb_build_array(confdeltype,confupdtype,condeferrable,condeferred))
    FROM pg_constraint WHERE conrelid='commerce."ReferenceTaxonomyCategory"'::regclass AND contype='f')`);
  assert.deepEqual(foreignKeys, {
    ReferenceTaxonomyCategory_generation_dimensions_fkey: ['c', 'r', false, false],
    ReferenceTaxonomyCategory_parent_fkey: ['a', 'r', false, false],
  });

  const first = generation('taxonomy-first', { isActive: true, activatedAt: time });
  sql(addGeneration(first));
  sql(addCategory(category(first.id, 'root')));
  sql(addCategory(category(first.id, 'child', { parentId: 'root', level: 1 }), '[0,1,0]', ['root']));
  const successor = generation('taxonomy-successor');
  sql(addGeneration(successor));
  sql(addCategory(category(successor.id, 'root')));
  sql(addCategory(category(successor.id, 'child', { parentId: 'root', level: 1 }), '[0,1,0]', ['root']));
  for (const overrides of [{ environment: 'PRODUCTION' }, { source: 'OTHER' }, { languageTag: 'fr' }]) {
    sql(addGeneration(generation(`independent-${JSON.stringify(overrides)}`, { ...overrides, isActive: true, activatedAt: time })));
  }
  reject('second active generation', addGeneration(generation('duplicate-active', { isActive: true, activatedAt: time })),
    'ReferenceTaxonomyGeneration_active_corpus_key', '23505');
  reject('duplicate import identity', addGeneration({ ...first, id: 'duplicate-import', isActive: false }),
    'ReferenceTaxonomyGeneration_import_identity_key', '23505');
  reject('duplicate generation id', addGeneration(first), 'ReferenceTaxonomyGeneration_pkey', '23505');
  for (const [field, value, constraint] of [
    ...['id', 'source', 'taxonomyVersion', 'languageTag', 'sourceUrl', 'embeddingProvider',
      'embeddingModel', 'embeddingIndexVersion', 'embeddingTextVersion']
      .map(field => [field, ' ', 'nonblank']),
    ['sourceSha256', 'A'.repeat(64), 'hashes'], ['importFingerprint', 'bad', 'hashes'],
    ['embeddingDimensions', 0, 'positive'], ['categoryCount', 0, 'positive'],
    ['isActive', true, 'activation'],
  ]) {
    reject(`invalid generation ${field}`, addGeneration(generation(`invalid-${field}`, { [field]: value })),
      `ReferenceTaxonomyGeneration_${constraint}_check`);
  }
  reject('explicit completion required', addGeneration(generation('no-completion', { completedAt: null })),
    'completedAt', '23502');
  const invalidRows = [
    ['missing parent', { parentId: 'missing', level: 1 }, ['missing'], 'parent_fkey', '23503'],
    ['cross-generation parent', { generationId: 'independent-{"source":"OTHER"}', parentId: 'root', level: 1 }, ['root'], 'parent_fkey', '23503'],
    ['self parent', { parentId: 'bad', level: 1 }, ['bad'], 'identity_check', '23514'],
    ['negative level', { level: -1 }, [], 'level_check', '23514'],
    ['ancestor count', { parentId: 'root', level: 2 }, ['root'], 'level_check', '23514'],
    ['null ancestor', { parentId: 'root', level: 2 }, [null, 'root'], 'level_check', '23514'],
    ['self ancestor', { parentId: 'root', level: 2 }, ['bad', 'root'], 'level_check', '23514'],
    ['root with parent', { parentId: 'root' }, [], 'level_check', '23514'],
    ['nonroot missing parent', { level: 1 }, ['root'], 'level_check', '23514'],
    ['wrong final ancestor', { parentId: 'root', level: 1 }, ['other'], 'level_check', '23514'],
    ['wrong generation dimension', { embeddingDimensions: 2 }, [], 'generation_dimensions_fkey', '23503'],
  ];
  for (const [label, overrides, ancestors, constraint, code] of invalidRows) {
    reject(label, addCategory(category(first.id, 'bad', overrides),
      overrides.embeddingDimensions === 2 ? '[1,0]' : '[1,0,0]', ancestors),
    `ReferenceTaxonomyCategory_${constraint}`, code);
  }
  for (const field of ['generationId', 'categoryId', 'name', 'fullName', 'parentId']) {
    reject(`blank category ${field}`, addCategory(category(first.id, 'bad', { [field]: ' ' })),
      'ReferenceTaxonomyCategory_identity_check');
  }
  const offsetAncestor = `INSERT INTO commerce."ReferenceTaxonomyCategory"
    ("generationId","categoryId",name,"fullName","parentId",level,"ancestorIds",embedding,"embeddingDimensions")
    VALUES ('taxonomy-first','offset','Offset','Offset','root',1,'[0:0]={root}'::text[],'[1,0,0]'::vector,3)`;
  sql('BEGIN;' + offsetAncestor + ';ROLLBACK;');
  reject('wrong last ancestor with nondefault array bounds', offsetAncestor.replace('{root}', '{other}'),
    'ReferenceTaxonomyCategory_level_check');
  reject('wrong vector dimension', addCategory(category(first.id, 'bad'), '[1,0]'),
    'ReferenceTaxonomyCategory_embedding_check');
  reject('duplicate category within generation', addCategory(category(first.id, 'root')),
    'ReferenceTaxonomyCategory_pkey', '23505');
  reject('isolated parent delete', `DELETE FROM commerce."ReferenceTaxonomyCategory"
    WHERE "generationId"='${first.id}' AND "categoryId"='root'`, 'ReferenceTaxonomyCategory_parent_fkey', '23503');
  sql(`BEGIN; UPDATE commerce."ReferenceTaxonomyGeneration" SET "isActive"=false WHERE id='${first.id}';
    UPDATE commerce."ReferenceTaxonomyGeneration" SET "isActive"=true,"activatedAt"=now() WHERE id='${successor.id}'; ROLLBACK;`);
  assert.equal(sql(`SELECT id FROM commerce."ReferenceTaxonomyGeneration" WHERE "isActive" AND environment='TEST' AND source='SHOPIFY_STANDARD_PRODUCT_TAXONOMY' AND "languageTag"='en';`), first.id);
  assert.equal(sql(`SELECT count(*) FROM commerce."ReferenceTaxonomyCategory" WHERE "generationId"='${first.id}';`), '2');
  sql(`BEGIN; UPDATE commerce."ReferenceTaxonomyGeneration" SET "isActive"=false WHERE id='${first.id}';
    UPDATE commerce."ReferenceTaxonomyGeneration" SET "isActive"=true,"activatedAt"=now() WHERE id='${successor.id}'; COMMIT;`);
  assert.equal(sql(`SELECT "activatedAt" IS NOT NULL FROM commerce."ReferenceTaxonomyGeneration" WHERE id='${first.id}';`), 't');
  assert.equal(sql(`PREPARE reference_cosine(vector,text) AS SELECT "categoryId"
    FROM commerce."ReferenceTaxonomyCategory" WHERE "generationId"=$2 ORDER BY embedding <=> $1 LIMIT 1;
    EXECUTE reference_cosine('[0,1,0]', '${first.id}'); DEALLOCATE reference_cosine;`), 'child');
  // Test-only explicit deletion proves cascade semantics on an inactive corpus.
  sql(`DELETE FROM commerce."ReferenceTaxonomyGeneration" WHERE id='${first.id}';`);
  assert.equal(sql(`SELECT count(*) FROM commerce."ReferenceTaxonomyCategory" WHERE "generationId"='${first.id}';`), '0');
  console.log('PASS logged native schema, named constraints, parent-first trees, pinned cosine, activation/rollback and cascade');
}

export async function runGrantCases(fixture, mode) {
  const { sql, json, reject } = fixture;
  if (mode === 'fresh') seedIdentity(fixture);
  assert.equal(sql(`SELECT count(*) FROM pg_proc WHERE oid IN (
    'commerce.arch020_grant_tools(jsonb)'::regprocedure,
    'commerce.arch021_conversation_grant_guard()'::regprocedure)
    AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'];`), '2');
  const valid = [published, ...builtIns];
  for (const [index, grantedTools] of [[published], valid, builtIns].entries()) {
    const id = `reference-valid-grant-${index}`;
    sql(conversationSql(id) + grantSql(id, {
      grantedTools, selectedCapabilityKeys: index === 2 ? [] : [names[0]],
    }));
    assert.deepEqual(json(`(SELECT "grantedTools" FROM commerce."CommerceConversationGrant" WHERE id='${id}-grant')`),
      grantedTools);
  }
  let number = 0;
  const rejectGrant = (label, overrides, diagnostic = 'ARCH021 grant shape', code = '23514', prefix = '') => {
    const id = `reference-invalid-${number++}`;
    reject(label, prefix + conversationSql(id) + grantSql(id, overrides), diagnostic, code);
  };
  const badShapes = [
    ['unknown kind', [{ ...builtIns[0], kind: 'UNKNOWN' }]],
    ['tagged published branch', [{ ...published, kind: 'PUBLISHED' }]],
    ['unknown built-in name', [{ ...builtIns[0], toolName: 'unknown' }]],
    ['wrong built-in version', [{ ...builtIns[0], definitionVersion: '2.0.0' }]],
    ['uppercase hash', [{ ...builtIns[0], contractHash: 'A'.repeat(64) }]],
    ['short hash', [{ ...builtIns[0], contractHash: 'a' }]],
    ['nonstring hash', [{ ...builtIns[0], contractHash: 1 }]],
    ['missing key', [Object.fromEntries(Object.entries(builtIns[0]).filter(([key]) => key !== 'contractHash'))]],
    ['extra built-in key', [{ ...builtIns[0], toolId: 'fake' }]],
    ['extra published key', [{ ...published, contractHash: hash }]],
    ['duplicate built-in name', [builtIns[0], builtIns[0]]],
    ['cross-branch name collision', [{ ...published, toolName: builtIns[0].toolName }, builtIns[0]]],
    ['duplicate published ID', [published, { ...published, toolName: 'other' }]],
    ['unsorted provenance', [{ ...published, capabilityKeys: ['z', 'a'] }]],
    ['duplicate provenance', [{ ...published, capabilityKeys: ['a', 'a'] }]],
    ['empty provenance', [{ ...published, capabilityKeys: [] }]],
    ['33 combined entries', [...Array.from({ length: 31 }, (_, index) => ({
      ...published, toolId: `size-${index}`, toolName: `size_${index}`,
    })), ...builtIns]],
    ['oversized JSON', Array.from({ length: 30 }, (_, index) => ({
      ...published, toolId: `bytes-${index}`, toolName: `bytes_${index}`,
      capabilityKeys: Array.from({ length: 32 }, (_, key) => `key_${String(key).padStart(2, '0')}_${'a'.repeat(90)}`),
    }))],
  ];
  for (const [label, grantedTools] of badShapes) {
    assert.equal(sql(`SELECT commerce.arch020_grant_tools(${literal(grantedTools)});`), 'f', label);
    rejectGrant(label, { grantedTools });
  }
  for (const [label, grantedTools] of [
    ['missing published union', builtIns],
    ['extra published authority', [published, { ...published, toolId: 'extra', toolName: 'extra' }, ...builtIns]],
    ['wrong published revision', [{ ...published, toolRevisionId: 'wrong' }, ...builtIns]],
    ['wrong published provenance', [{ ...published, capabilityKeys: ['wrong'] }, ...builtIns]],
  ]) rejectGrant(label, { grantedTools }, 'ARCH021 grant must equal direct release Tool authority');
  rejectGrant('selected capability outside release', {
    selectedCapabilityKeys: [names[1]], grantedTools: builtIns,
  }, 'ARCH021 selected key outside release');
  rejectGrant('wrong shop owner', { shopId: 'reference-other-shop' }, 'ARCH021 grant owner or inbound version mismatch');
  rejectGrant('future inbound version', { initialInboundVersion: 3 }, 'ARCH021 grant owner or inbound version mismatch');
  rejectGrant('nonpositive version', { initialInboundVersion: 0 }, 'arch021_grant_bounds');
  rejectGrant('empty runner version', { runnerVersion: '' }, 'arch021_grant_bounds');
  rejectGrant('invalid expiry', { createdAt: time, expiresAt: '2026-10-01T00:00:00Z' }, 'arch021_grant_bounds');
  rejectGrant('missing release', { releaseId: 'missing', selectedCapabilityKeys: [], grantedTools: builtIns },
    'CommerceConversationGrant_releaseId_fkey', '23503');
  rejectGrant('snapshot isolation retained', {}, 'ARCH020 relational guards require', '23514',
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
  sql(insert('whatsapp."Conversation"', {
    id: 'reference-standalone', shopId: 'reference-shop', type: 'RECOVERY', inboundVersion: 2, updatedAt: time,
  }));
  reject('standalone grant rejected', grantSql('reference-standalone'), 'ARCH021 recovery conversation required');
  reject('grant updates immutable', `UPDATE commerce."CommerceConversationGrant"
    SET "runnerVersion"='2.0.0' WHERE id='reference-valid-grant-0-grant'`, 'immutable');
  console.log('PASS published-only and mixed grants, strict built-in shape, authority/owner/expiry/isolation and immutability');
}
