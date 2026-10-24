import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { CONTRACT } from './arch047-template-persistence-contract.mjs';
import { validateSchemaText } from './validate-arch047-template-persistence-schema.mjs';
import { validateMigrationText } from './validate-arch047-template-persistence-migration.mjs';

// Never use DATABASE_URL, production/developer PostgreSQL, or a published port.
// All SQL is executed inside this invocation's network-isolated disposable container.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : null;
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or --mode upgrade');
const name = `moda-arch047-persistence-${randomUUID()}`;
const db = 'arch047_template_fixture';
const target = '20261024133000_arch047_template_persistence';
const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const tables = {
  definition: '"whatsapp"."WhatsAppTemplateDefinition"',
  locale: '"whatsapp"."WhatsAppTemplateLocale"',
  run: '"whatsapp"."WhatsAppTemplateTranslationRun"',
  item: '"whatsapp"."WhatsAppTemplateTranslationItem"',
  batch: '"whatsapp"."WhatsAppTemplateTranslationBatch"',
  member: '"whatsapp"."WhatsAppTemplateTranslationBatchItem"',
  registration: '"whatsapp"."WhatsAppTemplateMetaRegistration"',
  event: '"whatsapp"."WhatsAppTemplateMetaEvent"',
  operation: '"whatsapp"."WhatsAppTemplatePublicationOperation"',
  target: '"whatsapp"."WhatsAppTemplatePublicationTarget"',
  slot: '"whatsapp"."WhatsAppConversationWrapperActiveSlot"',
  variant: '"whatsapp"."WhatsAppTemplateVariant"',
  audit: '"commerce"."CommerceAuditEvent"',
};
let started = false;
const quote = v => `'${String(v).replaceAll("'", "''")}'`;
const value = v => v === null ? 'NULL' : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE')
    : typeof v === 'object' ? `${quote(JSON.stringify(v))}::jsonb` : quote(v);
const insert = (table, data) => `INSERT INTO ${table} (${Object.keys(data).map(k => `"${k}"`).join(',')})
  VALUES (${Object.values(data).map(value).join(',')});`;
function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
  });
}
function sql(source) {
  return docker(['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], { input: source }).trim();
}
function scalar(source) { return sql(source).split('\n').at(-1)?.trim() ?? ''; }
function number(source) { return Number(scalar(source)); }
function result(source) { return JSON.parse(scalar(`SELECT (${source})::text;`)); }
function sqlstate(label, statement, state) {
  // SAVEPOINT-equivalent exception subtransaction; failed negative writes leave
  // no data behind and have a stable machine-readable error assertion.
  sql(`DO $arch047_negative$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement.replace(/;+\s*$/, '')};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
  END;
  IF caught_state IS DISTINCT FROM ${quote(state)} THEN
    RAISE EXCEPTION 'Expected ${state} for ${label}, received %', caught_state;
  END IF;
END;
$arch047_negative$;`);
  console.log(`PASS SQLSTATE ${state}: ${label}`);
}
async function awaitReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      docker(['exec', name, 'pg_isready', '-q', '-U', 'postgres', '-d', db], { stdio: 'ignore' });
      return;
    } catch { await delay(500); }
  }
  throw new Error('Task-isolated PostgreSQL container did not start');
}
function applyMigration(migrationName) {
  sql(readFileSync(new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url), 'utf8'));
  console.log(`APPLIED ${migrationName}`);
}
function seedLegacy() {
  const seed = [
    insert('"commerce"."Shop"', {id: 'a47-shop-one', domain: 'arch047-one.example.invalid', updatedAt: '2026-10-23T00:00:00Z'}),
    insert('"commerce"."Shop"', {id: 'a47-shop-two', domain: 'arch047-two.example.invalid', updatedAt: '2026-10-23T00:00:00Z'}),
    insert('"public"."PlatformAdmin"', {id: 'a47-admin', email: 'a47-admin@example.invalid', role: 'SUPER_ADMIN', updatedAt: '2026-10-23T00:00:00Z'}),
    insert(tables.variant, {id: 'a47-legacy-variant', shopId: 'a47-shop-one', providerAccountId: 'legacy-waba', purpose: 'RECOVERY', languageTag: 'en', providerLanguageCode: 'en_US', providerTemplateName: 'legacy_external_template', status: 'APPROVED', updatedAt: '2026-10-23T00:00:00Z'}),
    insert(tables.audit, {id: 'a47-legacy-audit', actorAdminId: 'a47-admin', action: 'SET_OPENROUTER_CREDENTIAL', shopId: 'a47-shop-one', operationId: 'a47-legacy-audit', environment: 'DEVELOPMENT', reason: 'Pre-existing evidence', metadata: {before: null, after: {token: 'REDACTED'}}}),
    `INSERT INTO "commerce"."CommerceTranslationProviderCredential"
      ("id","environment","provider","ciphertext","nonce","authTag","keyId","updatedByAdminId","updatedAt")
      VALUES ('a47-credential','DEVELOPMENT','openai',decode('01','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),
        'fixture-key','a47-admin',now());`,
    insert('"commerce"."CommerceTranslationModelConfiguration"', {id: 'a47-translation-model', environment: 'DEVELOPMENT', provider: 'openai', providerModelId: 'fixture-model', displayName: 'ARCH-047 fixture model', createdByAdminId: 'a47-admin', updatedByAdminId: 'a47-admin', updatedAt: '2026-10-23T00:00:00Z'}),
    insert('"billing"."MerchantPricingTranslationRun"', {id: 'a47-arch031-run', shopifyPlanHandle: 'fixture-handle', environment: 'DEVELOPMENT', translationModelConfigurationId: 'a47-translation-model', provider: 'openai', providerModelId: 'fixture-model', modelConfigurationVersion: 1, sourceHash: 'a'.repeat(64), sourceSnapshot: {title:'pre-existing'}, requestedByAdminId: 'a47-admin', updatedAt: '2026-10-23T00:00:00Z'}),
  ];
  sql(`BEGIN;\n${seed.join('\n')}\nCOMMIT;`);
}
function historicalFingerprint() {
  return result(`jsonb_build_object(
    'shops', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s."id") FROM "commerce"."Shop" s WHERE "id" LIKE 'a47-%'),
    'admins', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM "public"."PlatformAdmin" a WHERE "id"='a47-admin'),
    'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a."id") FROM ${tables.audit} a WHERE "id"='a47-legacy-audit'),
    'translationModel', (SELECT to_jsonb(m) FROM "commerce"."CommerceTranslationModelConfiguration" m WHERE "id"='a47-translation-model'),
    'arch031Run', (SELECT to_jsonb(r) FROM "billing"."MerchantPricingTranslationRun" r WHERE "id"='a47-arch031-run'),
    'legacyVariant', (SELECT to_jsonb(v) - 'metaRegistrationId' FROM ${tables.variant} v WHERE "id"='a47-legacy-variant')
  )`);
}
function auditLabels() {
  return result(`coalesce((SELECT jsonb_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum e
    JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='commerce' AND t.typname='CommerceAuditAction'),'[]'::jsonb)`);
}
function verifyCatalogue() {
  const actual = result(`coalesce((SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables
    WHERE schemaname='whatsapp' AND tablename IN (${Object.keys(CONTRACT.models).map(quote).join(',')})), '[]'::jsonb)`);
  assert.deepEqual(actual, Object.keys(CONTRACT.models).sort(), 'All 11 new WhatsApp tables must exist');
  assert.equal(number(`SELECT count(*) FROM information_schema.columns WHERE table_schema='whatsapp'
    AND table_name='WhatsAppTemplateMetaRegistration'
    AND column_name IN ('parameterBindingsSnapshot','lastObservedContentHash','lastObservedCategory','driftDetectedAt');`), 4);
  assert.equal(number(`SELECT count(*) FROM information_schema.columns WHERE table_schema='whatsapp'
    AND table_name='WhatsAppTemplateDefinition' AND column_name='wabaId';`), 0);
  assert.equal(number(`SELECT count(*) FROM information_schema.columns WHERE table_schema='whatsapp'
    AND table_name='WhatsAppTemplateVariant' AND column_name='metaRegistrationId' AND is_nullable='YES';`), 1);
  assert.equal(number(`SELECT count(*) FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='whatsapp' AND c.contype='f' AND (
      t.relname IN (${Object.keys(CONTRACT.models).map(quote).join(',')}) OR
      (t.relname='WhatsAppTemplateVariant' AND c.conname='WhatsAppTemplateVariant_metaRegistrationId_fkey'));`), 25,
    'All 25 new technical FKs must exist in PostgreSQL');
  assert.equal(number(`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp' AND (
    tablename IN (${Object.keys(CONTRACT.models).map(quote).join(',')}) AND indexname NOT LIKE '%_pkey'
    OR indexname='WhatsAppTemplateVariant_metaRegistrationId_idx');`), 39,
    'All 39 indexes/unique identities must exist in PostgreSQL');
  assert.equal(number(`SELECT count(*) FROM ${tables.definition};`), 0, 'No template seeds');
  assert.equal(number(`SELECT count(*) FROM ${tables.locale};`), 0, 'No locale seeds');
  assert.equal(number(`SELECT count(*) FROM ${tables.registration};`), 0, 'No Meta-registration seeds');
  const labels = auditLabels();
  for (const action of CONTRACT.actions) assert.ok(labels.includes(action), `Missing ${action}`);
  for (const action of ['CREATE_WHATSAPP_TEMPLATE_VARIANT', 'BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT', 'SET_OPENROUTER_CREDENTIAL']) {
    assert.ok(labels.includes(action), `Historical audit action ${action} missing`);
  }
  console.log('PASS PostgreSQL catalogue, no seeds, existing audit identity preserved');
}
function exerciseAuthoringAndTranslation() {
  const sourceAst = {schemaVersion: 1, body: ['Hi ', {variable: 'customer_first_name'}, '.']};
  const frenchAst = {schemaVersion: 1, body: ['Bonjour ', {variable:'customer_first_name'}, '.']};
  sql(`BEGIN;
    ${insert(tables.definition,{id:'a47-recovery-def',kind:'META_RECOVERY',purpose:'RECOVERY',offerType:'NONE',providerTemplateName:'moda_a47_v1',category:'MARKETING',sourceLanguageTag:'en',astSchemaVersion:1,sourceHash:'a'.repeat(64),status:'DRAFT',createdByAdminId:'a47-admin'})}
    ${insert(tables.locale,{id:'a47-en',definitionId:'a47-recovery-def',languageTag:'en',providerLanguageCode:'en_US',localeAst:sourceAst,contentHash:'a'.repeat(64),status:'REVIEWED'})}
  COMMIT;`);
  sql(`BEGIN;
    ${insert(tables.definition,{id:'a47-cloned-def',kind:'META_RECOVERY',purpose:'RECOVERY',providerTemplateName:'moda_a47_v2',sourceLanguageTag:'en',astSchemaVersion:1,sourceHash:'b'.repeat(64),status:'DRAFT',createdByAdminId:'a47-admin',clonedFromDefinitionId:'a47-recovery-def'})}
    ${insert(tables.locale,{id:'a47-clone-en',definitionId:'a47-cloned-def',languageTag:'en',localeAst:{body:['Clone']},contentHash:'b'.repeat(64),status:'DRAFT'})}
  COMMIT;`);
  assert.equal(number(`SELECT count(*) FROM ${tables.definition} WHERE "clonedFromDefinitionId"='a47-recovery-def';`), 1);
  assert.equal(scalar(`SELECT "contentHash" FROM ${tables.locale} WHERE "id"='a47-en';`), 'a'.repeat(64));
  sql(insert(tables.run,{id:'a47-run',definitionId:'a47-recovery-def',translationModelConfigurationId:'a47-translation-model',provider:'openai',providerModelId:'fixture-model',modelConfigurationVersion:1,sourceSchemaVersion:1,sourceHash:'a'.repeat(64),sourceSnapshot:sourceAst,status:'QUEUED',requestedByAdminId:'a47-admin'}));
  sql(`INSERT INTO ${tables.item} ("id","runId","targetLanguageTag","status")
    SELECT 'a47-item-'||lang, 'a47-run', lang, 'PENDING'
    FROM unnest(ARRAY['fr','de','es','it','pt','nl','sv','da','no','fi','pl','cs','sk','ro','hu','el','tr','ar','ja']) AS lang;`);
  assert.equal(number(`SELECT count(*) FROM ${tables.item} WHERE "runId"='a47-run';`), 19);
  sql(insert(tables.batch,{id:'a47-batch-one',runId:'a47-run',provider:'openai',model:'fixture-model',status:'UNCERTAIN',providerBatchId:'batch-one',submitAttemptCount:1}));
  sql(insert(tables.member,{id:'a47-member-fr',batchId:'a47-batch-one',translationItemId:'a47-item-fr',providerCustomId:'a47-fr-1'}));
  sql(`UPDATE ${tables.item} SET "currentBatchId"='a47-batch-one',"retryCount"=1
    WHERE "id"='a47-item-fr';`);
  sql(insert(tables.batch,{id:'a47-batch-two',runId:'a47-run',provider:'openai',model:'fixture-model',status:'SUBMITTED',providerBatchId:'batch-two',submitAttemptCount:2}));
  sql(insert(tables.member,{id:'a47-member-fr-retry',batchId:'a47-batch-two',translationItemId:'a47-item-fr',providerCustomId:'a47-fr-2'}));
  sql(`UPDATE ${tables.item} SET "currentBatchId"='a47-batch-two',"retryCount"=2,
    "status"='COMPLETE',"outputContentHash"=${quote('f'.repeat(64))},
    "translatedAst"=${value(frenchAst)},"completedAt"=now()
    WHERE "id"='a47-item-fr';`);
  sql(insert(tables.locale,{id:'a47-fr',definitionId:'a47-recovery-def',languageTag:'fr',providerLanguageCode:'fr_FR',localeAst:frenchAst,contentHash:'f'.repeat(64),status:'REVIEWED',reviewedByAdminId:'a47-admin',reviewedAt:'2026-10-24T00:00:00Z'}));
  sql(`UPDATE ${tables.item} SET "resultLocaleId"='a47-fr' WHERE "id"='a47-item-fr';`);
  assert.deepEqual(result(`(SELECT "translatedAst" FROM ${tables.item} WHERE "id"='a47-item-fr')`),frenchAst);
  assert.equal(number(`SELECT count(*) FROM ${tables.member} WHERE "translationItemId"='a47-item-fr';`), 2,
    'Provider Batch retry memberships remain durably distinct');
  console.log('PASS immutable-definition clone, English locale, 19 targets, uncertain Batch and translated output');
}
function exerciseRegistration() {
  const components = lang => [{type:'BODY',text:lang==='fr'?'Bonjour {{1}}':'Hi {{1}}'}];
  const bindings = lang => ({schemaVersion:1,compilerVersion:'fixture-v1',componentsDigest:lang==='fr'?'fr-digest':'en-digest',
    slots:[{component:'BODY',componentIndex:0,position:1,semanticKey:'customer_first_name',languageTag:lang}]});
  for (const [language, localeId, code, hash] of [['en','a47-en','en_US','a'.repeat(64)],['fr','a47-fr','fr_FR','f'.repeat(64)]]) {
    sql(insert(tables.registration,{id:`a47-meta-${language}`,localeId,wabaId:'a47-waba',providerTemplateName:'moda_a47_v1',providerLanguageCode:code,
      category:'MARKETING',componentsSnapshot:components(language),parameterBindingsSnapshot:bindings(language),submittedContentHash:hash,
      providerTemplateId:`meta-template-${language}`,submissionState:'SUBMITTED',providerStatus:'PENDING'}));
  }
  sql(insert(tables.registration,{id:'a47-meta-clone',localeId:'a47-clone-en',wabaId:'a47-waba',providerTemplateName:'moda_a47_v2',providerLanguageCode:'en_US',category:'MARKETING',componentsSnapshot:components('en'),parameterBindingsSnapshot:bindings('en'),submittedContentHash:'b'.repeat(64),submissionState:'SUBMITTED'}));
  for (const [eventId, source, eventType, outcome, state, attemptNumber] of [
    ['a47-meta-attempt-unknown','BACKGROUND','SUBMIT_ATTEMPT','UNCERTAIN',null,1],
    ['a47-meta-attempt-confirmed','BACKGROUND','SUBMIT_ATTEMPT','ACCEPTED',null,2],
    ['a47-meta-webhook','META_WEBHOOK','STATUS','SUCCESS','APPROVED',null],
    ['a47-meta-reconciliation','RECONCILIATION','CONTENT_GET','DRIFTED','APPROVED',null],
  ]) {
    sql(insert(tables.event,{id:eventId,eventIdentity:eventId,registrationId:'a47-meta-en',source,eventType,outcome,attemptNumber,
      wabaId:'a47-waba',providerTemplateName:'moda_a47_v1',providerLanguageCode:'en_US',providerStatus:state,
      evidence:{bounded:true},receivedAt:'2026-10-24T00:00:00Z'}));
  }
  const before = result(`(SELECT jsonb_build_object('components',"componentsSnapshot",'bindings',"parameterBindingsSnapshot",
    'hash',"submittedContentHash") FROM ${tables.registration} WHERE "id"='a47-meta-en')`);
  sql(`UPDATE ${tables.registration} SET "providerStatus"='APPROVED',
    "lastObservedContentHash"=${quote('0'.repeat(64))}, "lastObservedCategory"='UTILITY',
    "lastReconciledAt"=now(),"driftDetectedAt"=now() WHERE "id"='a47-meta-en';`);
  const after = result(`(SELECT jsonb_build_object('components',"componentsSnapshot",'bindings',"parameterBindingsSnapshot",
    'hash',"submittedContentHash") FROM ${tables.registration} WHERE "id"='a47-meta-en')`);
  assert.deepEqual(after,before,'Status/reconciliation must not overwrite frozen submission/bindings/hash');
  assert.equal(scalar(`SELECT "lastObservedCategory" FROM ${tables.registration} WHERE "id"='a47-meta-en';`),'UTILITY');
  assert.equal(number(`SELECT count(*) FROM ${tables.event} WHERE "registrationId"='a47-meta-en';`),4);
  sql(insert(tables.event,{id:'a47-external-unmatched',eventIdentity:'a47-external-unmatched',registrationId:null,
    source:'META_WEBHOOK',eventType:'STATUS',wabaId:'external-waba',providerTemplateName:'external-not-imported',providerLanguageCode:'en_US',providerStatus:'APPROVED'}));
  assert.equal(number(`SELECT count(*) FROM ${tables.registration} WHERE "wabaId"='external-waba';`),0);
  console.log('PASS frozen language-specific bindings, uncertain attempt, webhook, drift and unmatched external event');
}
function exercisePublishing() {
  sql(insert(tables.operation,{id:'a47-operation',definitionId:'a47-recovery-def',requestedByAdminId:'a47-admin',operationKey:'a47-publication',scopeSnapshot:{shops:['a47-shop-one','a47-shop-two'],languages:['en','fr']},status:'RUNNING',totalTargets:4}));
  for (const [shop, slug] of [['a47-shop-one','one'],['a47-shop-two','two']]) {
    const writes = [];
    for (const [lang,code] of [['en','en_US'],['fr','fr_FR']]) {
      const variantId = `a47-new-${slug}-${lang}`;
      writes.push(insert(tables.variant,{id:variantId,shopId:shop,providerAccountId:'a47-waba',purpose:'RECOVERY',languageTag:lang,providerLanguageCode:code,
        providerTemplateName:'moda_a47_v1',providerTemplateId:`meta-template-${lang}`,status:'APPROVED',metaRegistrationId:`a47-meta-${lang}`,updatedAt:'2026-10-24T00:00:00Z'}));
      writes.push(insert(tables.target,{id:`a47-target-${slug}-${lang}`,operationId:'a47-operation',shopId:shop,languageTag:lang,metaRegistrationId:`a47-meta-${lang}`,
        previousVariantId:slug==='one' && lang==='en'?'a47-legacy-variant':null,newVariantId:variantId,status:'COMPLETE',processedAt:'2026-10-24T00:00:00Z'}));
    }
    if (slug === 'one') writes.push(`UPDATE ${tables.variant}
      SET "enabled"=false,"updatedAt"=now() WHERE "id"='a47-legacy-variant';`);
    writes.push(insert(tables.audit,{id:`a47-publication-audit-${slug}`,
      actorAdminId:'a47-admin',action:'ASSIGN_WHATSAPP_TEMPLATE_DEFINITION',
      shopId:shop,operationId:`a47-publish-${slug}`,reason:'Approved shop-language publication',
      metadata:{definitionId:'a47-recovery-def',languages:['en','fr']}}));
    writes.push(`UPDATE ${tables.operation} SET "succeededTargets"="succeededTargets"+2
      WHERE "id"='a47-operation';`);
    sql(`BEGIN;\n${writes.join('\n')}\nCOMMIT;`);
  }
  assert.equal(number(`SELECT count(*) FROM ${tables.target} WHERE "operationId"='a47-operation';`),4);
  assert.equal(number(`SELECT count(DISTINCT "shopId") FROM ${tables.target} WHERE "operationId"='a47-operation';`),2);
  assert.equal(number(`SELECT "succeededTargets" FROM ${tables.operation} WHERE "id"='a47-operation';`),4,
    'Counters represent shop-language targets rather than shops');
  assert.equal(number(`SELECT count(*) FROM ${tables.variant} WHERE "metaRegistrationId" IS NOT NULL;`),4);
  assert.equal(scalar(`SELECT "enabled" FROM ${tables.variant} WHERE "id"='a47-legacy-variant';`),'f',
    'The per-shop publication transaction must switch the former assignment off');
  const provenance = result(`(SELECT jsonb_build_object('shopId',v."shopId",'language',l."languageTag",
    'definition',d."id",'submittedHash',r."submittedContentHash",'bindings',r."parameterBindingsSnapshot")
    FROM ${tables.variant} v JOIN ${tables.registration} r ON r."id"=v."metaRegistrationId"
    JOIN ${tables.locale} l ON l."id"=r."localeId"
    JOIN ${tables.definition} d ON d."id"=l."definitionId"
    WHERE v."id"='a47-new-one-fr')`);
  assert.equal(provenance.shopId,'a47-shop-one');
  assert.equal(provenance.language,'fr');
  assert.equal(provenance.definition,'a47-recovery-def');
  assert.equal(provenance.bindings.slots[0].semanticKey,'customer_first_name');
  // Business inconsistency: PostgreSQL enforces existence of the registration,
  // not its compatibility with a selected operation's definition/language.
  sql(insert(tables.operation,{id:'a47-inconsistent-op',definitionId:'a47-recovery-def',requestedByAdminId:'a47-admin',operationKey:'a47-inconsistent',scopeSnapshot:{test:true},status:'RUNNING'}));
  sql(insert(tables.target,{id:'a47-inconsistent-target',operationId:'a47-inconsistent-op',shopId:'a47-shop-one',languageTag:'es',
    metaRegistrationId:'a47-meta-clone',status:'PENDING'}));
  assert.equal(number(`SELECT count(*) FROM ${tables.target} t
    JOIN ${tables.registration} r ON r."id"=t."metaRegistrationId"
    JOIN ${tables.locale} l ON l."id"=r."localeId"
    JOIN ${tables.operation} o ON o."id"=t."operationId"
    WHERE t."id"='a47-inconsistent-target' AND (l."languageTag"<>t."languageTag" OR l."definitionId"<>o."definitionId");`),1);
  console.log('PASS per-shop atomic publication, multiple language targets, provenance-only FK');
}
function exerciseWrapperAndNoBusinessChecks() {
  sql(`BEGIN;
    ${insert(tables.definition,{id:'a47-wrapper',kind:'MODA_CONVERSATION_WRAPPER',audience:'AI',sourceLanguageTag:'en',astSchemaVersion:1,sourceHash:'c'.repeat(64),status:'READY',createdByAdminId:'a47-admin'})}
    ${insert(tables.locale,{id:'a47-wrapper-en',definitionId:'a47-wrapper',languageTag:'en',localeAst:{body:['Wrapper']},status:'READY'})}
    ${insert(tables.slot,{audience:'AI',definitionId:'a47-wrapper',updatedByAdminId:'a47-admin'})}
  COMMIT;`);
  sql(`UPDATE ${tables.slot} SET "editVersion"="editVersion"+1,"updatedAt"=now()
    WHERE "audience"='AI' AND "editVersion"=0;`);
  assert.equal(number(`SELECT "editVersion" FROM ${tables.slot} WHERE "audience"='AI';`),1);
  assert.equal(scalar(`SELECT "kind" FROM ${tables.definition} d JOIN ${tables.slot} s ON s."definitionId"=d."id" WHERE s."audience"='AI';`),'MODA_CONVERSATION_WRAPPER');
  assert.deepEqual(result(`(SELECT l."localeAst" FROM ${tables.slot} s
    JOIN ${tables.locale} l ON l."definitionId"=s."definitionId"
    WHERE s."audience"='AI' AND l."languageTag"='en')`), {body:['Wrapper']});
  // Explicitly ensure business validation is not hidden in a new SQL CHECK.
  sql(insert(tables.definition,{id:'a47-nonstandard',kind:'UNRECOGNISED_KIND',audience:'ANY_AUDIENCE',sourceLanguageTag:'xx',astSchemaVersion:1,
    sourceHash:'d'.repeat(64),status:'PUBLISHED',publishedAt:'2026-10-24T00:00:00Z',createdByAdminId:'a47-admin'}));
  sql(insert(tables.locale,{id:'a47-one-locale',definitionId:'a47-nonstandard',languageTag:'xx',localeAst:{body:['one']},status:'DRAFT'}));
  sql(insert(tables.slot,{audience:'HUMAN',definitionId:'a47-recovery-def',updatedByAdminId:'a47-admin'}));
  sql(insert(tables.variant,{id:'a47-wrong-waba',shopId:'a47-shop-one',providerAccountId:'different-waba',purpose:'RECOVERY',languageTag:'en',
    providerLanguageCode:'en_US',providerTemplateName:'moda_a47_v1',status:'APPROVED',metaRegistrationId:'a47-meta-en',updatedAt:'2026-10-24T00:00:00Z'}));
  assert.equal(number(`SELECT count(*) FROM ${tables.locale} WHERE "definitionId"='a47-nonstandard';`),1);
  console.log('PASS wrapper pointer+CAS and intentionally nonenforced business policies');
}
function verifyPrismaToolchain() {
  const safeEnv = {...process.env,
    DATABASE_URL:'postgresql://arch047:never-used@127.0.0.1:1/task_isolated_schema_only'};
  for (const command of ['validate', 'prisma:generate']) {
    execFileSync('npm',['run',command],{encoding:'utf8',stdio:'inherit',env:safeEnv});
  }
  // Database connectivity is deliberately proven only inside the disposable
  // Docker container. These host-side commands do not connect to PostgreSQL.
  console.log('PASS Prisma validate and client generation (isolated schema-only DATABASE_URL)');
}
function exerciseNegativesAndAudits() {
  sqlstate('duplicate definition-language locale',insert(tables.locale,{id:'dup-a47-locale',definitionId:'a47-recovery-def',languageTag:'fr',status:'READY'}),'23505');
  sqlstate('duplicate translation run-language item',insert(tables.item,{id:'dup-a47-item',runId:'a47-run',targetLanguageTag:'fr',status:'PENDING'}),'23505');
  sqlstate('duplicate provider custom ID',insert(tables.member,{id:'dup-a47-provider-id',batchId:'a47-batch-one',translationItemId:'a47-item-de',providerCustomId:'a47-fr-1'}),'23505');
  sqlstate('duplicate batch membership',insert(tables.member,{id:'dup-a47-membership',batchId:'a47-batch-one',translationItemId:'a47-item-fr',providerCustomId:'new-custom-id'}),'23505');
  sqlstate('duplicate provider WABA/name/language identity',insert(tables.registration,{id:'dup-a47-meta',localeId:'a47-fr',wabaId:'a47-waba',providerTemplateName:'moda_a47_v1',providerLanguageCode:'en_US',category:'MARKETING',componentsSnapshot:[],parameterBindingsSnapshot:{},submittedContentHash:'d'.repeat(64),submissionState:'READY'}),'23505');
  sqlstate('duplicate publication operationKey',insert(tables.operation,{id:'dup-a47-op',definitionId:'a47-recovery-def',requestedByAdminId:'a47-admin',operationKey:'a47-publication',scopeSnapshot:{},status:'PENDING'}),'23505');
  sqlstate('duplicate shop-language target',insert(tables.target,{id:'dup-a47-target',operationId:'a47-operation',shopId:'a47-shop-one',languageTag:'fr',metaRegistrationId:'a47-meta-fr',status:'PENDING'}),'23505');
  sqlstate('duplicate Meta eventIdentity',insert(tables.event,{id:'dup-a47-event',eventIdentity:'a47-meta-webhook',source:'META_WEBHOOK',eventType:'STATUS',wabaId:'a47-waba'}),'23505');
  sqlstate('nonexistent publication registration FK',insert(tables.target,{id:'a47-invalid-fk',operationId:'a47-operation',shopId:'a47-shop-one',languageTag:'it',metaRegistrationId:'nonexistent',status:'PENDING'}),'23503');
  sqlstate('nonexistent template definition FK',insert(tables.locale,{id:'a47-invalid-def-fk',definitionId:'nonexistent',languageTag:'en',status:'DRAFT'}),'23503');
  for (const [index,action] of CONTRACT.actions.entries()) {
    const record = {id:`a47-new-audit-${index}`,actorAdminId:'a47-admin',operationId:`a47-audit-${index}`,action,reason:'Admin action',metadata:{definitionId:'a47-recovery-def'}};
    if (index%2===0) record.shopId='a47-shop-one';
    sql(insert(tables.audit,record));
  }
  assert.deepEqual(result(`coalesce((SELECT jsonb_agg("action"::text ORDER BY "action"::text)
    FROM ${tables.audit} WHERE "id" LIKE 'a47-new-audit-%'),'[]'::jsonb)`), [...CONTRACT.actions].sort());
  sqlstate('historical variant action still needs shop',insert(tables.audit,{id:'a47-invalid-legacy-audit',actorAdminId:'a47-admin',action:'ENABLE_WHATSAPP_TEMPLATE_VARIANT',operationId:'legacy-op',reason:'Missing shop must be rejected',metadata:{}}),'23514');
  sqlstate('historical credential action still needs environment',insert(tables.audit,{id:'a47-invalid-credential-audit',actorAdminId:'a47-admin',action:'SET_OPENROUTER_CREDENTIAL',operationId:'legacy-op',reason:'Missing environment must be rejected',metadata:{}}),'23514');
  console.log('PASS technical negatives, ten new audits and old audit guards');
}
async function main() {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');
  validateSchemaText(schema);
  validateMigrationText(migration);
  verifyPrismaToolchain();
  console.log(`PostgreSQL isolation: Docker container ${name}, network none, no host port/database URL`);
  console.log(`Node ${process.version}; target migration ${target}; mode ${mode}`);
  try {
    docker(['run','-d','--name',name,'--network','none',
      '-e','POSTGRES_PASSWORD=arch047-isolated','-e',`POSTGRES_DB=${db}`, 'pgvector/pgvector:pg17']);
    started = true;
    await awaitReady();
    console.log(`PostgreSQL ${scalar('SHOW server_version;')}`);
    const migrations = readdirSync(migrationsDirectory).filter(m=>/^\d{14}_/.test(m) && m<=target).sort();
    assert.ok(migrations.includes(target), `Missing migration ${target}`);
    for (const migrationName of migrations) {
      if (migrationName === target) break;
      applyMigration(migrationName);
    }
    let before;
    if (mode === 'upgrade') {
      seedLegacy();
      before = historicalFingerprint();
    }
    applyMigration(target);
    verifyCatalogue();
    if (mode === 'fresh') seedLegacy();
    if (mode === 'upgrade') {
      assert.deepEqual(historicalFingerprint(),before,
        'Upgrade changed preexisting Shop, PlatformAdmin, audit, variant or ARCH-031 records');
    }
    assert.equal(number(`SELECT count(*) FROM ${tables.variant} WHERE "id"='a47-legacy-variant' AND "metaRegistrationId" IS NULL;`),1,
      'Unlinked legacy variants must remain unadopted after migration');
    exerciseAuthoringAndTranslation();
    exerciseRegistration();
    exercisePublishing();
    exerciseWrapperAndNoBusinessChecks();
    exerciseNegativesAndAudits();
    console.log(`PASS ARCH-047 PostgreSQL ${mode}: all storage, preservation and negative assertions`);
  } finally {
    if (started) docker(['rm','-f',name], {stdio:'ignore'});
  }
}
await main();
