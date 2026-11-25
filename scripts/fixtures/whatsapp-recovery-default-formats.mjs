export const defaults = 'whatsapp."WhatsAppRecoveryTemplateDefault"';
export const definition = 'whatsapp."WhatsAppTemplateDefinition"';
export const locale = 'whatsapp."WhatsAppTemplateLocale"';
export const registration = 'whatsapp."WhatsAppTemplateMetaRegistration"';
export const variant = 'whatsapp."WhatsAppTemplateVariant"';
export const operation = 'whatsapp."WhatsAppTemplatePublicationOperation"';
export const target = 'whatsapp."WhatsAppTemplatePublicationTarget"';
export const shop = 'commerce."Shop"';
export const admin = 'public."PlatformAdmin"';
export const history = [admin, definition, locale, registration, shop, variant, operation, target];
export const purposes = ['INITIAL_NO_OFFER', 'INITIAL_CODE_OFFER', 'INITIAL_AUTOMATIC_OFFER',
  'FOLLOW_UP_NO_OFFER', 'FOLLOW_UP_CODE_OFFER', 'FOLLOW_UP_AUTOMATIC_OFFER'];
const languages = ['cs','da','de','en','es','fi','fr','it','ja','ko','nb','nl','pl','pt-BR','pt-PT','sv','th','tr','zh-Hans','zh-Hant'];
export const waba = '1000000000000001';
export const otherWaba = '1000000000000002';
const stamp = '2026-11-24T22:00:00Z';
const hash = 'a'.repeat(64);
export const q = value => `'${String(value).replaceAll("'", "''")}'`;
const val = value => value === null ? 'NULL' : typeof value === 'boolean' || typeof value === 'number'
  ? String(value) : typeof value === 'object' ? `${q(JSON.stringify(value))}::jsonb` : q(value);
export const insert = (table, data) => `INSERT INTO ${table} (${Object.keys(data).map(k => `"${k}"`).join(',')})
  VALUES (${Object.values(data).map(val).join(',')});`;
export const defaultRow = (id, purpose, definitionId, account = waba, format) => insert(defaults, {
  id, wabaId: account, purpose, definitionId, updatedByAdminId: 'selector', createdAt: stamp, updatedAt: stamp,
  ...(format !== undefined ? { format } : {}),
});
export const defId = (purpose, kind) => `${purpose}-${kind}`;
export function compiled(kind) {
  const components = [
    ...(kind === 'IMAGE' ? [{ type: 'HEADER', format: 'IMAGE' }]
      : kind === 'TEXT' ? [{ type: 'HEADER', format: 'TEXT', text: 'Shop' }] : []),
    { type: 'BODY', text: 'Fixture recovery message' },
  ];
  const parameterBindings = { schemaVersion: 1, ...(kind === 'IMAGE' ? { headerMediaRole: 'LOGO' } : {}),
    header: [], body: [], buttons: [] };
  return { components, parameterBindings };
}
function seedDefinition(id, purpose, kind, account) {
  const stage = purpose.startsWith('INITIAL_') ? 'INITIAL' : 'FOLLOW_UP';
  const name = `fixture_${id.toLowerCase().replaceAll('-', '_')}`;
  const prepared = compiled(kind);
  const rows = [insert(definition, { id, kind: 'META_RECOVERY', purpose: stage,
    offerType: purpose.slice(stage.length + 1), providerTemplateName: name,
    category: 'MARKETING', sourceLanguageTag: 'en', astSchemaVersion: 1, sourceHash: hash,
    status: 'PUBLISHED', publishedAt: stamp, createdByAdminId: 'author' })];
  for (const lang of languages) {
    const localeId = `${id}-${lang}`;
    rows.push(insert(locale, { id: localeId, definitionId: id, languageTag: lang, providerLanguageCode: lang,
      localeAst: { schemaVersion: 1, prepared: { schemaVersion: 1, family: 'META_RECOVERY', category: 'MARKETING', ...prepared } },
      contentHash: hash, status: 'REVIEWED', reviewedByAdminId: 'author', reviewedAt: stamp }));
    rows.push(insert(registration, { id: localeId, localeId, wabaId: account, providerTemplateName: name,
      providerLanguageCode: lang, category: 'MARKETING', componentsSnapshot: prepared.components,
      parameterBindingsSnapshot: prepared.parameterBindings, submittedContentHash: hash, providerTemplateId: `meta-${localeId}`,
      submissionState: 'SUBMITTED', providerStatus: 'APPROVED', lastReconciledAt: stamp }));
  }
  return rows;
}
export function seedCatalogue(sql) {
  const rows = [insert(admin, { id: 'author', email: 'author@example.invalid', role: 'SUPER_ADMIN', updatedAt: stamp }),
    insert(admin, { id: 'selector', email: 'selector@example.invalid', role: 'SUPER_ADMIN', updatedAt: stamp })];
  for (const purpose of purposes) {
    rows.push(...seedDefinition(defId(purpose, 'IMAGE'), purpose, 'IMAGE', waba));
    rows.push(...seedDefinition(defId(purpose, 'TEXT'), purpose, 'TEXT', waba));
  }
  rows.push(...seedDefinition('legacy-no-header', purposes[0], 'NONE', otherWaba));
  rows.push(...seedDefinition('legacy-text-header', purposes[1], 'TEXT', otherWaba));
  rows.push(...seedDefinition('replacement-image', purposes[0], 'IMAGE', waba));
  sql(`BEGIN; ${rows.join('\n')} COMMIT;`);
}
export function seedMerchant(sql, kind) {
  const rows = [];
  if (kind === 'IMAGE') rows.push(insert(shop, { id: 'shop-a', domain: 'recovery-default-formats.example.invalid',
    platform: 'SHOPIFY', onboardingCompleted: true, defaultLanguageTag: 'fr', storeLocale: 'fr', updatedAt: stamp }));
  for (const purpose of purposes) {
    const id = defId(purpose, kind);
    const op = `publication-${id}`;
    const name = `fixture_${id.toLowerCase().replaceAll('-', '_')}`;
    rows.push(insert(operation, { id: op, definitionId: id, requestedByAdminId: 'author', operationKey: op,
      scopeSnapshot: { scope: { mode: 'one', shopId: 'shop-a' } }, status: 'COMPLETE',
      totalTargets: 20, succeededTargets: 20, failedTargets: 0, completedAt: stamp }));
    for (const languageTag of languages) {
      const registrationId = `${id}-${languageTag}`;
      const variantId = `variant-${registrationId}`;
      rows.push(insert(variant, { id: variantId, shopId: 'shop-a', providerAccountId: waba, purpose,
        languageTag, providerLanguageCode: languageTag, providerTemplateName: name, providerTemplateId: `meta-${registrationId}`,
        metaRegistrationId: registrationId, status: 'APPROVED', enabled: true, updatedAt: stamp }));
      rows.push(insert(target, { id: `target-${registrationId}`, operationId: op, shopId: 'shop-a', languageTag,
        metaRegistrationId: registrationId, newVariantId: variantId, status: 'SUCCEEDED', processedAt: stamp }));
    }
  }
  sql(`BEGIN; ${rows.join('\n')} COMMIT;`);
}
