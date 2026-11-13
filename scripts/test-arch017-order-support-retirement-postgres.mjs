import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Every write below targets an invocation-owned disposable PostgreSQL container.
const modeIndex = process.argv.indexOf('--mode');
const mode = process.argv[modeIndex + 1];
assert.ok(modeIndex >= 0 && ['fresh', 'upgrade', 'rollback'].includes(mode), 'Use --mode fresh, upgrade or rollback');
const target = '20261106023000_remove_order_support';
const migrations = new URL('../prisma/migrations/', import.meta.url);
const retirement = readFileSync(new URL(`${target}/migration.sql`, migrations), 'utf8');
assert.equal(createHash('sha256').update(retirement).digest('hex'), '6afd411b773669387f6289243537ea999df07a1f8c553163862a1f21de06cde2', 'Keep deployed SQL byte-for-byte');
const container = `moda-arch017-retirement-${randomUUID()}`;
const database = 'arch017_retirement_fixture';
let running = false;
let checks = 0;
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
const sql = (input, capture = false) => docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(capture ? ['-A', '-t'] : []), '-U', 'postgres', '-d', database], { input }).trim();
const scalar = statement => sql(statement, true).split('\n').at(-1);
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function snapshot() {
  return JSON.parse(scalar(`SELECT jsonb_build_object(
    'feature', (SELECT to_jsonb(t) FROM billing."Feature" t WHERE key='retirement_keep'),
    'shop', (SELECT to_jsonb(t) FROM commerce."Shop" t WHERE id='retirement-shop'),
    'billing', (SELECT to_jsonb(t) FROM billing."BillingPlan" t WHERE id='retirement-billing'),
    'merchant', (SELECT to_jsonb(t) FROM billing."MerchantPricingPlan" t WHERE id='retirement-merchant'),
    'subscription', (SELECT to_jsonb(t) FROM billing."Subscription" t WHERE id='retirement-subscription'),
    'billingFeatures', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing."BillingPlanFeature" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key<>'order_support')),
    'merchantFeatures', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "merchantPricingPlanId", "featureId") FROM billing."MerchantPricingPlanFeature" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key<>'order_support')),
    'preferences', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing."ShopFeaturePreference" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key<>'order_support')),
    'configurations', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "featureId") FROM commerce."CommerceFeatureConfiguration" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key<>'order_support')),
    'releases', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM commerce."CommerceRelease" t),
    'audit', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM commerce."CommerceAuditEvent" t)
  )::text;`));
}
function retiredRows() {
  return JSON.parse(scalar(`SELECT jsonb_build_object(
    'feature', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing."Feature" t WHERE key='order_support'),
    'billing', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing."BillingPlanFeature" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key='order_support')),
    'merchant', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "merchantPricingPlanId", "featureId") FROM billing."MerchantPricingPlanFeature" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key='order_support')),
    'preferences', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM billing."ShopFeaturePreference" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key='order_support')),
    'configuration', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "featureId") FROM commerce."CommerceFeatureConfiguration" t WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key='order_support')),
    'releaseFeatures', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "releaseId", "featureId") FROM commerce."CommerceReleaseFeature" t)
  )::text;`));
}
function fixtures(withRetired) {
  sql(`BEGIN;
    INSERT INTO public."PlatformAdmin" (id,email,role,"updatedAt") VALUES ('retirement-admin','retirement@example.invalid','SUPER_ADMIN',now());
    INSERT INTO commerce."Shop" (id,domain,"updatedAt") VALUES ('retirement-shop','retirement.example.invalid',now());
    INSERT INTO billing."Feature" (id,key,"displayName","activationMode","updatedAt") VALUES ('retirement-keep-feature','retirement_keep','Preserved custom feature','MERCHANT_OPT_IN',now());
    INSERT INTO billing."BillingPlan" (id,"shopifyPlanHandle",name,kind,"updatedAt") VALUES ('retirement-billing','retirement-billing','Preserved billing plan','FREE',now());
    INSERT INTO billing."BillingPlanFeature" (id,"planId","featureId",enabled)
      SELECT 'retirement-billing-'||key,'retirement-billing',id,true FROM billing."Feature" WHERE key IN ('checkout_recovery','ai_conversations','retirement_keep');
    INSERT INTO billing."MerchantPricingPlan" (id,"shopifyPlanHandle","displayName","planKind","cataloguePosition","includedRecoveryCredits","allowancePeriod","billingPeriod","recurringAmountMinor",currency,"updatedAt")
      VALUES ('retirement-merchant','retirement-merchant','Preserved merchant price','FREE',(SELECT count(*) FROM billing."MerchantPricingPlan"),0,'LIFETIME','EVERY_30_DAYS',0,'GBP',now());
    INSERT INTO billing."MerchantPricingPlanTranslation" (id,"merchantPricingPlanId",locale,"merchantDescription","updatedAt")
      SELECT 'retirement-translation-'||locale,'retirement-merchant',locale,'Preserved merchant description',now() FROM unnest(ARRAY['cs','da','de','en','es','fi','fr','it','ja','ko','nb','nl','pl','pt-BR','pt-PT','sv','th','tr','zh-Hans','zh-Hant']) locale;
    INSERT INTO billing."MerchantPricingPlanFeature" ("merchantPricingPlanId","featureId")
      SELECT 'retirement-merchant',id FROM billing."Feature" WHERE key IN ('checkout_recovery','ai_conversations','retirement_keep');
    INSERT INTO billing."Subscription" (id,"shopId","planId",status,"updatedAt") VALUES ('retirement-subscription','retirement-shop','retirement-billing','NO_CONTRACT',now());
    INSERT INTO billing."ShopFeaturePreference" (id,"shopId","featureId",enabled,"updatedAt") VALUES ('retirement-keep-preference','retirement-shop','retirement-keep-feature',true,now());
    INSERT INTO commerce."CommerceFeatureConfiguration" ("featureId","behaviourPrompt","updatedAt") VALUES ('retirement-keep-feature','Preserved custom behavior',now());
    COMMIT;`);
  if (!withRetired) return;
  equal(scalar(`SELECT count(*) FROM billing."Feature" WHERE key='order_support';`), '1', 'Pre-retirement catalogue contains the historical feature');
  sql(`BEGIN;
    INSERT INTO billing."BillingPlanFeature" (id,"planId","featureId",enabled) SELECT 'retirement-order-billing','retirement-billing',id,true FROM billing."Feature" WHERE key='order_support';
    INSERT INTO billing."MerchantPricingPlanFeature" ("merchantPricingPlanId","featureId") SELECT 'retirement-merchant',id FROM billing."Feature" WHERE key='order_support';
    INSERT INTO billing."ShopFeaturePreference" (id,"shopId","featureId",enabled,"updatedAt") SELECT 'retirement-order-preference','retirement-shop',id,true,now() FROM billing."Feature" WHERE key='order_support';
    COMMIT;`);
}
function seed() {
  const binding = JSON.parse(docker(['inspect', container]))[0].NetworkSettings.Ports['5432/tcp'];
  assert.equal(binding.length, 1);
  assert.equal(binding[0].HostIp, '127.0.0.1');
  const localUrl = new URL(`postgresql://postgres:fixture-only@127.0.0.1:${binding[0].HostPort}/${database}`);
  assert.equal(localUrl.hostname, '127.0.0.1');
  assert.equal(localUrl.pathname, `/${database}`);
  execFileSync(process.execPath, ['prisma/seed.mjs'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: localUrl.href }, maxBuffer: 4 * 1024 * 1024 });
}
try {
  docker(['run','-d','--name',container,'-p','127.0.0.1::5432','-e','POSTGRES_PASSWORD=fixture-only','-e',`POSTGRES_DB=${database}`,'pgvector/pgvector:pg17']);
  running = true;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try { docker(['exec',container,'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',database]); ready = true; break; }
    catch { await delay(1000); }
  }
  assert.ok(ready, 'Invocation-owned PostgreSQL must become ready');
  const names = readdirSync(migrations).filter(n => /^\d{14}_.+/.test(n)).sort();
  assert.ok(names.includes(target));
  for (const name of names) {
    if (mode !== 'fresh' && name === target) continue;
    sql(readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  }
  console.log(`APPLIED ${names.length - (mode === 'fresh' ? 0 : 1)} canonical migrations (${mode})`);
  fixtures(mode !== 'fresh');
  const before = snapshot();
  if (mode === 'rollback') {
    sql(`BEGIN;
      INSERT INTO commerce."CommerceRelease" (id,"runnerCompatibility","contractVersion","responseContract","responseContractHash","createdByAdminId") VALUES ('retirement-release','^1.0.0','commerce.v1','{"version":"response.v1","instructions":"Fixture","detailsSchema":{}}','${'a'.repeat(64)}','retirement-admin');
      INSERT INTO commerce."CommerceAuditEvent" (id,"actorAdminId",action,"featureId","releaseId",reason) SELECT 'retirement-audit','retirement-admin','UPDATE_FEATURE_BEHAVIOUR',id,'retirement-release','Immutable retirement refusal fixture' FROM billing."Feature" WHERE key='order_support';
      COMMIT;`);
    const protectedBefore = snapshot();
    const retiredBefore = retiredRows();
    const result = spawnSync('docker', ['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database], { input: retirement, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Historical references must refuse feature deletion'); checks++;
    assert.match(result.stderr, /23503/, 'Refusal must be a foreign-key violation'); checks++;
    equal(snapshot(), protectedBefore, 'Release/audit, price, subscription and unrelated rows survive refusal');
    equal(retiredRows(), retiredBefore, 'Failed migration rolls back every preceding retirement delete');
    // A current configuration has a stronger no-delete guard. A legitimate release
    // snapshot must remain protected too; neither guard may be disabled for retirement.
    sql(`BEGIN;
      INSERT INTO commerce."CommerceFeatureConfiguration" ("featureId","behaviourPrompt","updatedAt") SELECT id,'Retired order behavior',now() FROM billing."Feature" WHERE key='order_support';
      INSERT INTO commerce."CommerceReleaseFeature" ("releaseId","featureId","behaviourPrompt") SELECT 'retirement-release',id,'Retired order behavior' FROM billing."Feature" WHERE key='order_support';
      COMMIT;`);
    const guardedBefore = snapshot();
    const guardedRetiredBefore = retiredRows();
    const guarded = spawnSync('docker', ['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database], { input: retirement, encoding: 'utf8' });
    assert.notEqual(guarded.status, 0, 'Existing feature behavior must refuse deletion'); checks++;
    assert.match(guarded.stderr, /23514/, 'Current configuration refusal must retain its existing trigger'); checks++;
    equal(snapshot(), guardedBefore, 'Current configuration refusal preserves immutable release/audit and unrelated data');
    equal(retiredRows(), guardedRetiredBefore, 'Current configuration refusal rolls back all preceding retirement deletes');
  } else {
    if (mode === 'upgrade') {
      sql(retirement);
      equal(snapshot(), before, 'Retirement preserves other feature state, plans, prices, subscriptions and history');
    }
    equal(scalar(`SELECT count(*) FROM billing."Feature" WHERE key='order_support';`), '0', 'Retired feature is absent');
    for (const table of ['BillingPlanFeature','MerchantPricingPlanFeature','ShopFeaturePreference']) {
      equal(scalar(`SELECT count(*) FROM billing."${table}" WHERE "featureId"='arch017-feature-order-support';`), '0', `${table} retired links are absent`);
    }
    equal(scalar(`SELECT count(*) FROM commerce."CommerceFeatureConfiguration" WHERE "featureId"='arch017-feature-order-support';`), '0', 'Retired current configuration is absent');
    const preservedBeforeSeed = snapshot();
    seed(); seed();
    const preservedAfterSeed = snapshot();
    // The development seed owns its three named plans; unrelated records remain unchanged.
    for (const key of ['feature','shop','billing','merchant','subscription','preferences','configurations','releases','audit']) equal(preservedAfterSeed[key], preservedBeforeSeed[key], `Repeated real seed preserves unrelated ${key}`);
    equal(scalar(`SELECT count(*) FROM billing."Feature" WHERE key='order_support';`), '0', 'Repeated real seed does not resurrect the retired feature');
    equal(scalar(`SELECT count(*) FROM billing."Feature" WHERE key IN ('checkout_recovery','ai_conversations','product_search');`), '3', 'Current feature seeds remain available');
    equal(scalar(`SELECT count(*) FROM billing."BillingPlanFeature" f JOIN billing."Feature" k ON k.id=f."featureId" WHERE k.key='order_support';`), '0', 'Repeated real seed creates no retired plan links');
  }
  equal(scalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema='whatsapp' AND table_name IN ('ConversationDeliveryPart','MetaTemplateAppOperationState');`), '2', 'Later ARCH075 tables are retained');
  console.log(`PASS ARCH-017 retirement ${mode}: ${checks} assertions; exact deployed checksum; complete migration chain; no hosted writes`);
} finally {
  if (running) docker(['rm','-f',container]);
}
