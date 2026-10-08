import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';

const targetMigration = '20261008110000_arch027_woocommerce_billing_persistence';
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass an explicit --mode fresh|upgrade');

const databaseVariable = mode === 'fresh' ? 'ARCH027_FRESH_DATABASE_URL' : 'ARCH027_UPGRADE_DATABASE_URL';
const databaseUrl = process.env[databaseVariable];
assert.ok(databaseUrl, `${databaseVariable} must name a disposable PostgreSQL 17 database`);
let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch (error) {
  throw new Error(`${databaseVariable} must be a PostgreSQL URL`, {cause: error});
}
assert.ok(['postgres:', 'postgresql:'].includes(parsedUrl.protocol), `${databaseVariable} must use PostgreSQL`);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
assert.equal(databaseName, `arch027_${mode}_fixture`,
  `${databaseVariable} must target the dedicated arch027_${mode}_fixture database`);

function psql(sql, {capture = false} = {}) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '--set=VERBOSITY=terse'];
  if (capture) args.push('-A', '-t', '-q');
  else args.push('-q');
  args.push(databaseUrl);
  try {
    return execFileSync('psql', args, {
      encoding: 'utf8',
      input: sql,
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`psql failed${detail ? `: ${detail}` : ''}`, {cause: error});
  }
}

function jsonQuery(sql) {
  return JSON.parse(psql(sql, {capture: true}));
}

function expectRejected(label, statement, sqlState = '23514') {
  psql(`DO $arch027_assertion$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement.trim().replace(/;+$/, '')};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state <> '${sqlState}' THEN RAISE; END IF;
  END;
  IF caught_state IS NULL THEN
    RAISE EXCEPTION 'Expected SQLSTATE ${sqlState}: ${label}';
  END IF;
END;
$arch027_assertion$;`);
  console.log(`PASS ${label}`);
}

function expectRejectedWithMessage(label, statement, expectedMessage) {
  try {
    psql(statement);
  } catch (error) {
    assert.ok(error.message.includes(expectedMessage), error.message);
    console.log(`PASS ${label}`);
    return;
  }
  assert.fail(`Expected statement to be rejected: ${label}`);
}

function migrationNames() {
  return readdirSync(new URL('../prisma/migrations/', import.meta.url))
    .filter(name => /^\d{14}_.+$/.test(name))
    .sort();
}

function applyMigration(name) {
  const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
  psql(sql);
  console.log(`APPLIED ${name}`);
}

const legacyLocales = [
  'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko',
  'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant',
];

function seedLegacyShopifyRows() {
  const events = [
    ['arch027-legacy-event-requested', 'arch027-legacy-requested'],
    ['arch027-legacy-event-positive', 'arch027-legacy-positive'],
    ['arch027-legacy-event-zero', 'arch027-legacy-zero'],
    ['arch027-legacy-event-correction', 'arch027-legacy-correction'],
  ].map(([id, key]) => `('${id}','arch027-legacy-shop','arch027-legacy-period','RECOVERY_CREDIT_PACK_PURCHASE',1,'${key}',CURRENT_TIMESTAMP)`).join(',\n');

  psql(`BEGIN;
INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt")
VALUES ('arch027-legacy-shop','legacy.arch027.invalid','SHOPIFY',CURRENT_TIMESTAMP);
INSERT INTO billing."BillingPlan" ("id","shopifyPlanHandle","name","kind","updatedAt")
VALUES ('arch027-legacy-plan','arch027-legacy-plan-handle','Legacy paid','PAID_METERED',CURRENT_TIMESTAMP);
INSERT INTO billing."Subscription" ("id","shopId","planId","status","providerSubscriptionId","updatedAt")
VALUES ('arch027-legacy-subscription','arch027-legacy-shop','arch027-legacy-plan','ACTIVE','legacy-shopify-contract',CURRENT_TIMESTAMP);
INSERT INTO billing."BillingPeriod" (
  "id","shopId","subscriptionId","planId","shopifyPlanHandleSnapshot","planNameSnapshot",
  "planKindSnapshot","includedRecoveryCreditsGranted","periodStart","periodEnd","status","updatedAt"
) VALUES (
  'arch027-legacy-period','arch027-legacy-shop','arch027-legacy-subscription','arch027-legacy-plan',
  'arch027-legacy-plan-handle','Legacy paid','PAID_METERED',10,'2026-10-01','2026-11-01','OPEN',CURRENT_TIMESTAMP
);
UPDATE billing."Subscription"
SET "billingPeriodId"='arch027-legacy-period',"currentPeriodStart"='2026-10-01',"currentPeriodEnd"='2026-11-01'
WHERE "id"='arch027-legacy-subscription';
INSERT INTO billing."BillingPeriodEntitlementCounter" (
  "id","shopId","billingPeriodId","counter","grantedQuantity","committedQuantity","reservedQuantity","forfeitedQuantity","updatedAt"
) VALUES ('arch027-legacy-counter','arch027-legacy-shop','arch027-legacy-period','INCLUDED_RECOVERY_CREDITS',10,2,1,1,CURRENT_TIMESTAMP);
INSERT INTO billing."UsageEvent" ("id","shopId","billingPeriodId","metric","quantity","idempotencyKey","occurredAt")
VALUES ${events};
INSERT INTO billing."RecoveryCreditPurchase" (
  "id","shopId","planId","billingPeriodId","shopifyPlanHandleSnapshot","shopifyEventHandleSnapshot",
  "providerSubscriptionIdSnapshot","providerUsageQuantityBeforeSnapshot","providerUsageCostBeforeSnapshot",
  "providerUsageCostCurrencyBeforeSnapshot","providerUsageQuantityAfterSnapshot","providerUsageCostAfterSnapshot",
  "providerUsageCostCurrencyAfterSnapshot","providerPurchaseAmount","providerPurchaseCurrency",
  "providerValuationConfirmedAt","providerPriceSnapshot","creditsGranted","currentAmount","reservedAmount",
  "status","usageEventId","updatedAt"
) VALUES
  ('arch027-legacy-purchase-requested','arch027-legacy-shop','arch027-legacy-plan','arch027-legacy-period','legacy-plan','legacy-pack','legacy-shopify-contract',1,2,'USD',NULL,NULL,NULL,NULL,NULL,NULL,NULL,5,0,0,'REQUESTED','arch027-legacy-event-requested',CURRENT_TIMESTAMP),
  ('arch027-legacy-purchase-positive','arch027-legacy-shop','arch027-legacy-plan','arch027-legacy-period','legacy-plan','legacy-pack','legacy-shopify-contract',1,2,'USD',2,3,'USD',1,'USD','2026-10-01T01:00:00Z','{"unitAmount":1}',5,5,0,'ACTIVE','arch027-legacy-event-positive',CURRENT_TIMESTAMP),
  ('arch027-legacy-purchase-zero','arch027-legacy-shop','arch027-legacy-plan','arch027-legacy-period','legacy-plan','legacy-pack','legacy-shopify-contract',2,1,'USD',3,1,'USD',0,'USD','2026-10-01T02:00:00Z','{"unitAmount":0}',5,5,0,'ACTIVE','arch027-legacy-event-zero',CURRENT_TIMESTAMP);
INSERT INTO billing."RecoveryCreditRefund" (
  "id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot",
  "reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","billingPeriodIdSnapshot",
  "providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot","purchaseProviderAmountSnapshot",
  "purchaseProviderCurrencySnapshot","requestKey","status","updatedAt"
) VALUES (
  'arch027-legacy-refund-basic','arch027-legacy-shop','arch027-legacy-purchase-positive','MERCHANT_UI',5,5,0,5,
  'arch027-legacy-period','legacy-shopify-contract','legacy-plan','legacy-pack',1,'USD','legacy-refund-basic','REJECTED',CURRENT_TIMESTAMP
), (
  'arch027-legacy-refund-correction','arch027-legacy-shop','arch027-legacy-purchase-positive','MERCHANT_UI',5,5,0,5,
  'arch027-legacy-period','legacy-shopify-contract','legacy-plan','legacy-pack',1,'USD','legacy-refund-correction','REQUESTED',CURRENT_TIMESTAMP
);
UPDATE billing."RecoveryCreditRefund"
SET "automaticCorrectionUsageEventId"='arch027-legacy-event-correction',
    "providerUsageQuantityBeforeCorrection"=2,
    "providerUsageCostBeforeCorrection"=3,
    "expectedProviderUsageQuantityAfterCorrection"=1,
    "expectedProviderUsageCostAfterCorrection"=2,
    "finalCreditQuantity"=1,
    "expectedProviderAmount"=1,
    "expectedProviderCurrency"='USD'
WHERE "id"='arch027-legacy-refund-correction';
COMMIT;`);
}

function legacyEvidence() {
  return {
    purchases: jsonQuery(`SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data."id"),'[]'::jsonb)::text
      FROM (SELECT "id","shopId","planId","billingPeriodId","shopifyPlanHandleSnapshot","shopifyEventHandleSnapshot",
        "providerSubscriptionIdSnapshot","providerUsageQuantityBeforeSnapshot","providerUsageCostBeforeSnapshot",
        "providerUsageCostCurrencyBeforeSnapshot","providerUsageQuantityAfterSnapshot","providerUsageCostAfterSnapshot",
        "providerUsageCostCurrencyAfterSnapshot","providerPurchaseAmount","providerPurchaseCurrency",
        "providerValuationConfirmedAt","providerPriceSnapshot","creditsGranted","currentAmount","reservedAmount",
        "status"::text AS "status","usageEventId" FROM billing."RecoveryCreditPurchase"
        WHERE "id" LIKE 'arch027-legacy-purchase-%') AS row_data;`),
    refunds: jsonQuery(`SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data."id"),'[]'::jsonb)::text
      FROM (SELECT "id","shopId","purchaseId","source"::text AS "source","purchaseCreditsGrantedSnapshot",
        "currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot",
        "billingPeriodIdSnapshot","providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot",
        "shopifyPartnerDevelopmentSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot",
        "finalCreditQuantity","expectedProviderAmount","expectedProviderCurrency","automaticCorrectionUsageEventId",
        "providerUsageQuantityBeforeCorrection","providerUsageCostBeforeCorrection",
        "expectedProviderUsageQuantityAfterCorrection","expectedProviderUsageCostAfterCorrection",
        "status"::text AS "status","requestKey" FROM billing."RecoveryCreditRefund"
        WHERE "id" LIKE 'arch027-legacy-refund-%') AS row_data;`),
    subscription: jsonQuery(`SELECT jsonb_build_object('shopId',"shopId",'planId',"planId",'billingPeriodId',"billingPeriodId",
      'providerSubscriptionId',"providerSubscriptionId",'currentPeriodStart',"currentPeriodStart",'currentPeriodEnd',"currentPeriodEnd")::text
      FROM billing."Subscription" WHERE "id"='arch027-legacy-subscription';`),
    counter: jsonQuery(`SELECT jsonb_build_object('granted',"grantedQuantity",'committed',"committedQuantity",
      'reserved',"reservedQuantity",'forfeited',"forfeitedQuantity")::text
      FROM billing."BillingPeriodEntitlementCounter" WHERE "id"='arch027-legacy-counter';`),
  };
}

function assertLegacyUpgrade(before) {
  assert.deepEqual(legacyEvidence(), before, 'legacy Shopify snapshots and evidence must remain byte/value equivalent');
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditPurchase"
    WHERE "id" LIKE 'arch027-legacy-purchase-%' AND "provider"='SHOPIFY';`), 3);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditRefund"
    WHERE "id" LIKE 'arch027-legacy-refund-%' AND "provider"='SHOPIFY';`), 2);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditPurchase"
    WHERE "id" LIKE 'arch027-legacy-purchase-%' AND "usageEventId" IS NOT NULL;`), 3);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingPeriodEntitlementCounter"
    WHERE "id"='arch027-legacy-counter' AND "currentAllowanceQuantity" IS NULL;`), 1);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."Subscription"
    WHERE "id"='arch027-legacy-subscription' AND "providerSubscriptionId"='legacy-shopify-contract'
      AND "providerCoverageEndAt" IS NULL;`), 1);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingOperation";`), 0);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM woocommerce."WooCommerceBillingWebhookReceipt";`), 0);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM pg_indexes WHERE schemaname='billing' AND indexname='Subscription_shopId_key';`), 1);
  console.log('PASS legacy Shopify evidence, one-subscription cardinality and null new fields preserved');
}

function seedRuntimeRows() {
  const localeValues = legacyLocales.map(locale => `('${locale}')`).join(',');
  psql(`BEGIN;
INSERT INTO billing."MerchantPricingPlan" (
  "id","shopifyPlanHandle","displayName","planKind","isActive","cataloguePosition","featured",
  "includedRecoveryCredits","allowancePeriod","billingPeriod","recurringAmountMinor","currency","updatedAt"
) VALUES
  ('arch027-catalog-free','arch027-catalog-free','Free','FREE',true,0,false,5,'LIFETIME','EVERY_30_DAYS',0,'USD',CURRENT_TIMESTAMP),
  ('arch027-catalog-paid','arch027-catalog-paid','Paid','PAID_METERED',true,1,false,25,'EVERY_30_DAYS','EVERY_30_DAYS',1000,'USD',CURRENT_TIMESTAMP);
INSERT INTO billing."MerchantPricingPlanTranslation" ("id","merchantPricingPlanId","locale","merchantDescription","updatedAt")
SELECT 'arch027-translation-' || plan."id" || '-' || locale.locale, plan."id", locale.locale, 'Rehearsal plan', CURRENT_TIMESTAMP
FROM billing."MerchantPricingPlan" AS plan
CROSS JOIN (VALUES ${localeValues}) AS locale(locale)
WHERE plan."id" IN ('arch027-catalog-free','arch027-catalog-paid');
INSERT INTO billing."MerchantPricingUsageEvent" (
  "id","merchantPricingPlanId","eventHandle","adminLabel","creditsGrantedPerUnit","position",
  "pricingMode","currency","fixedUnitAmountMinor","updatedAt"
) VALUES ('arch027-catalog-free-bundle','arch027-catalog-free','free_bundle','Free bundle',10,0,'FIXED','USD',500,CURRENT_TIMESTAMP);
COMMIT;

INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES
  ('arch027-shop-shopify','shopify.arch027.invalid','SHOPIFY',CURRENT_TIMESTAMP),
  ('arch027-shop-woo-free','woo-free.arch027.invalid','WOOCOMMERCE',CURRENT_TIMESTAMP),
  ('arch027-shop-woo-paid','woo-paid.arch027.invalid','WOOCOMMERCE',CURRENT_TIMESTAMP),
  ('arch027-shop-other','other.arch027.invalid','SHOPIFY',CURRENT_TIMESTAMP);
INSERT INTO billing."BillingPlan" ("id","shopifyPlanHandle","name","kind","updatedAt") VALUES
  ('arch027-billing-free','arch027-billing-free','Free','FREE',CURRENT_TIMESTAMP),
  ('arch027-billing-paid','arch027-billing-paid','Paid','PAID_METERED',CURRENT_TIMESTAMP);
INSERT INTO billing."Subscription" ("id","shopId","planId","status","providerSubscriptionId","updatedAt") VALUES
  ('arch027-sub-shopify','arch027-shop-shopify','arch027-billing-paid','ACTIVE','shopify-arch027-contract',CURRENT_TIMESTAMP),
  ('arch027-sub-woo-free','arch027-shop-woo-free','arch027-billing-free','NO_CONTRACT',NULL,CURRENT_TIMESTAMP),
  ('arch027-sub-woo-paid','arch027-shop-woo-paid','arch027-billing-paid','ACTIVE','woo-recurring-arch027-contract',CURRENT_TIMESTAMP);
UPDATE billing."Subscription"
SET "cancelAtPeriodEnd"=true,"currentPeriodStart"='2026-10-01',"currentPeriodEnd"='2026-11-01',
    "providerCoverageEndAt"='2026-11-15',"updatedAt"=CURRENT_TIMESTAMP
WHERE "id"='arch027-sub-woo-paid';
INSERT INTO billing."BillingPeriod" (
  "id","shopId","subscriptionId","planId","shopifyPlanHandleSnapshot","planNameSnapshot","planKindSnapshot",
  "includedRecoveryCreditsGranted","periodStart","periodEnd","status","updatedAt"
) VALUES
  ('arch027-period-shopify','arch027-shop-shopify','arch027-sub-shopify','arch027-billing-paid','paid','Paid','PAID_METERED',25,'2026-10-01','2026-11-01','OPEN',CURRENT_TIMESTAMP),
  ('arch027-period-woo-paid','arch027-shop-woo-paid','arch027-sub-woo-paid','arch027-billing-paid','paid','Paid','PAID_METERED',25,'2026-10-01','2026-11-01','OPEN',CURRENT_TIMESTAMP);
UPDATE billing."Subscription" SET "billingPeriodId"='arch027-period-shopify',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='arch027-sub-shopify';
UPDATE billing."Subscription" SET "billingPeriodId"='arch027-period-woo-paid',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='arch027-sub-woo-paid';
INSERT INTO billing."BillingPeriodEntitlementCounter" (
  "id","shopId","billingPeriodId","counter","grantedQuantity","committedQuantity","reservedQuantity","forfeitedQuantity","updatedAt"
) VALUES ('arch027-counter-downgrade','arch027-shop-shopify','arch027-period-shopify','INCLUDED_RECOVERY_CREDITS',10,4,3,1,CURRENT_TIMESTAMP);
INSERT INTO billing."UsageEvent" ("id","shopId","billingPeriodId","metric","quantity","idempotencyKey","occurredAt") VALUES
  ('arch027-event-shopify-requested','arch027-shop-shopify','arch027-period-shopify','RECOVERY_CREDIT_PACK_PURCHASE',1,'arch027-key-requested',CURRENT_TIMESTAMP),
  ('arch027-event-shopify-positive','arch027-shop-shopify','arch027-period-shopify','RECOVERY_CREDIT_PACK_PURCHASE',1,'arch027-key-positive',CURRENT_TIMESTAMP),
  ('arch027-event-shopify-zero','arch027-shop-shopify','arch027-period-shopify','RECOVERY_CREDIT_PACK_PURCHASE',1,'arch027-key-zero',CURRENT_TIMESTAMP),
  ('arch027-event-shopify-correction','arch027-shop-shopify','arch027-period-shopify','RECOVERY_CREDIT_PACK_PURCHASE',1,'arch027-key-correction',CURRENT_TIMESTAMP);
INSERT INTO billing."RecoveryCreditPurchase" (
  "id","shopId","planId","billingPeriodId","shopifyPlanHandleSnapshot","shopifyEventHandleSnapshot",
  "providerSubscriptionIdSnapshot","providerUsageQuantityBeforeSnapshot","providerUsageCostBeforeSnapshot",
  "providerUsageCostCurrencyBeforeSnapshot","creditsGranted","currentAmount","reservedAmount","status","usageEventId","updatedAt"
) VALUES (
  'arch027-shopify-requested','arch027-shop-shopify','arch027-billing-paid','arch027-period-shopify','paid','pack',
  'shopify-arch027-contract',1,0,'USD',10,0,0,'REQUESTED','arch027-event-shopify-requested',CURRENT_TIMESTAMP
), (
  'arch027-shopify-positive','arch027-shop-shopify','arch027-billing-paid','arch027-period-shopify','paid','pack',
  'shopify-arch027-contract',1,2,'USD',10,0,0,'REQUESTED','arch027-event-shopify-positive',CURRENT_TIMESTAMP
), (
  'arch027-shopify-zero','arch027-shop-shopify','arch027-billing-paid','arch027-period-shopify','paid','pack',
  'shopify-arch027-contract',2,1,'USD',10,0,0,'REQUESTED','arch027-event-shopify-zero',CURRENT_TIMESTAMP
);
UPDATE billing."RecoveryCreditPurchase"
SET "status"='ACTIVE',"currentAmount"=10,"providerUsageQuantityAfterSnapshot"=2,"providerUsageCostAfterSnapshot"=3,
    "providerUsageCostCurrencyAfterSnapshot"='USD',"providerPurchaseAmount"=1,
    "providerPurchaseCurrency"='USD',"providerValuationConfirmedAt"=CURRENT_TIMESTAMP,
    "providerPriceSnapshot"='{"price":1}'::jsonb
WHERE "id"='arch027-shopify-positive';
UPDATE billing."RecoveryCreditPurchase"
SET "status"='ACTIVE',"currentAmount"=10,"providerUsageQuantityAfterSnapshot"=3,"providerUsageCostAfterSnapshot"=1,
    "providerUsageCostCurrencyAfterSnapshot"='USD',"providerPurchaseAmount"=0,
    "providerPurchaseCurrency"='USD',"providerValuationConfirmedAt"=CURRENT_TIMESTAMP,
    "providerPriceSnapshot"='{"price":0}'::jsonb
WHERE "id"='arch027-shopify-zero';`);
}

function assertCatalogObjects() {
  const objects = jsonQuery(`SELECT jsonb_build_object(
    'operationTable', to_regclass('billing."BillingOperation"') IS NOT NULL,
    'receiptTable', to_regclass('woocommerce."WooCommerceBillingWebhookReceipt"') IS NOT NULL,
    'kindEnum', to_regtype('billing."BillingOperationKind"') IS NOT NULL,
    'stateEnum', to_regtype('billing."BillingOperationState"') IS NOT NULL,
    'operationGuard', to_regprocedure('billing.arch027_billing_operation_guard()') IS NOT NULL,
    'receiptGuard', to_regprocedure('woocommerce.arch027_woocommerce_billing_webhook_receipt_guard()') IS NOT NULL,
    'purchaseGuard', to_regprocedure('billing.arch027_recovery_credit_purchase_refund_attempt_guard()') IS NOT NULL,
    'refundProviderGuard', to_regprocedure('billing.arch027_recovery_credit_refund_provider_guard()') IS NOT NULL,
    'operationTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='billing' AND c.relname='BillingOperation' AND t.tgname='arch027_billing_operation_guard' AND NOT t.tgisinternal),
    'receiptTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='woocommerce' AND c.relname='WooCommerceBillingWebhookReceipt' AND t.tgname='arch027_woocommerce_billing_webhook_receipt_guard' AND NOT t.tgisinternal),
    'capacityConstraint', (SELECT count(*) FROM pg_constraint WHERE conrelid='billing."BillingPeriodEntitlementCounter"'::regclass AND conname='BillingPeriodEntitlementCounter_capacity'),
    'subscriptionShopUnique', (SELECT count(*) FROM pg_indexes WHERE schemaname='billing' AND indexname='Subscription_shopId_key'),
    'subscriptionProviderNonUnique', (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='billing' AND c.relname='Subscription_providerSubscriptionId_idx' AND NOT i.indisunique),
    'receiptDedupe', (SELECT count(*) FROM pg_indexes WHERE schemaname='woocommerce' AND indexname='WooCommerceBillingWebhookReceipt_topic_payloadSha256_key'),
    'operationShopForeignKey', (SELECT count(*) FROM pg_constraint WHERE conrelid='billing."BillingOperation"'::regclass AND conname='BillingOperation_shopId_fkey' AND contype='f'),
    'receiptOperationForeignKey', (SELECT count(*) FROM pg_constraint WHERE conrelid='woocommerce."WooCommerceBillingWebhookReceipt"'::regclass AND conname='WooCommerceBillingWebhookReceipt_billingOperationId_fkey' AND contype='f')
  )::text;`);
  assert.deepEqual(objects, {
    operationTable: true, receiptTable: true, kindEnum: true, stateEnum: true,
    operationGuard: true, receiptGuard: true, purchaseGuard: true, refundProviderGuard: true,
    operationTriggers: 1, receiptTriggers: 1, capacityConstraint: 1,
    subscriptionShopUnique: 1, subscriptionProviderNonUnique: 1, receiptDedupe: 1,
    operationShopForeignKey: 1, receiptOperationForeignKey: 1,
  });
  const enums = jsonQuery(`SELECT jsonb_build_object(
    'kind', (SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='billing."BillingOperationKind"'::regtype),
    'state', (SELECT array_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='billing."BillingOperationState"'::regtype)
  )::text;`);
  assert.deepEqual(enums, {
    kind: ['SUBSCRIPTION_CREATE', 'PLAN_SWITCH', 'ONE_TIME_CHARGE', 'CANCEL'],
    state: ['INITIATING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'OUTCOME_UNKNOWN', 'FAILED'],
  });
  console.log('PASS PostgreSQL catalog tables, enums, indexes, constraints, foreign keys, functions and triggers');
}

function insertOperation({id, shopId = 'arch027-shop-woo-free', kind = 'SUBSCRIPTION_CREATE', state = 'INITIATING', key,
  digest = 32, planId = null, eventId = null, amount = null, currency = null, period = null, purchaseId = null, providerReference = null}) {
  const value = item => item === null ? 'NULL' : `'${String(item).replaceAll("'", "''")}'`;
  return `INSERT INTO billing."BillingOperation" (
    "id","shopId","kind","state","requestKey","requestFingerprint","merchantPricingPlanId",
    "merchantPricingUsageEventId","quotedAmountMinor","quotedCurrency","quotedBillingPeriod",
    "recoveryCreditPurchaseId","providerReference","updatedAt"
  ) VALUES (
    ${value(id)},${value(shopId)},${value(kind)},${value(state)},${value(key)},decode(repeat('ab',${digest}),'hex'),
    ${value(planId)},${value(eventId)},${value(amount)},${value(currency)},${value(period)},
    ${value(purchaseId)},${value(providerReference)},CURRENT_TIMESTAMP
  );`;
}

function insertWooPurchase({id, shopId = 'arch027-shop-woo-free', planId = 'arch027-billing-free', periodId = null}) {
  return `INSERT INTO billing."RecoveryCreditPurchase" (
    "id","shopId","planId","billingPeriodId","provider","creditsGranted","currentAmount","reservedAmount","status","updatedAt"
  ) VALUES ('${id}','${shopId}','${planId}',${periodId ? `'${periodId}'` : 'NULL'},'WOOCOMMERCE',10,0,0,'REQUESTED',CURRENT_TIMESTAMP);`;
}

function runBehaviorCases() {
  assertCatalogObjects();

  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."Subscription" s
    JOIN billing."BillingPlan" p ON p."id"=s."planId"
    WHERE s."id"='arch027-sub-woo-free' AND p."kind"='FREE' AND s."providerSubscriptionId" IS NULL
      AND s."providerCoverageEndAt" IS NULL AND s."billingPeriodId" IS NULL;`), 1);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."Subscription"
    WHERE "id"='arch027-sub-woo-paid' AND "cancelAtPeriodEnd" AND "providerCoverageEndAt"='2026-11-15'
      AND "currentPeriodEnd"='2026-11-01' AND "providerCoverageEndAt" <> "currentPeriodEnd";`), 1);
  expectRejected('one Subscription per Shop uniqueness is retained', `INSERT INTO billing."Subscription" ("id","shopId","status","updatedAt") VALUES ('arch027-duplicate-sub','arch027-shop-woo-free','NO_CONTRACT',CURRENT_TIMESTAMP)`, '23505');
  expectRejected('negative current allowance rejected', `UPDATE billing."BillingPeriodEntitlementCounter" SET "currentAllowanceQuantity"=-1 WHERE "id"='arch027-counter-downgrade'`);
  psql(`UPDATE billing."BillingPeriodEntitlementCounter" SET "currentAllowanceQuantity"=5 WHERE "id"='arch027-counter-downgrade';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingPeriodEntitlementCounter"
    WHERE "id"='arch027-counter-downgrade' AND "grantedQuantity"=10 AND "committedQuantity"+"reservedQuantity">"currentAllowanceQuantity";`), 1);
  console.log('PASS current allowance nullable/downgrade behavior and preserved high-water grant');

  psql(insertWooPurchase({id: 'arch027-woo-purchase-free'}));
  psql(insertWooPurchase({id: 'arch027-woo-purchase-free-second'}));
  psql(insertWooPurchase({id: 'arch027-woo-purchase-paid', shopId: 'arch027-shop-woo-paid', planId: 'arch027-billing-paid', periodId: 'arch027-period-woo-paid'}));
  expectRejected('invalid purchase provider rejected', `INSERT INTO billing."RecoveryCreditPurchase" ("id","shopId","planId","provider","creditsGranted","updatedAt") VALUES ('arch027-invalid-purchase-provider','arch027-shop-woo-free','arch027-billing-free','MAGENTO',1,CURRENT_TIMESTAMP)`);
  expectRejected('Woo purchase with Shopify meter snapshots rejected', `INSERT INTO billing."RecoveryCreditPurchase" ("id","shopId","planId","provider","shopifyPlanHandleSnapshot","creditsGranted","updatedAt") VALUES ('arch027-woo-fake-meter','arch027-shop-woo-free','arch027-billing-free','WOOCOMMERCE','fake-plan',1,CURRENT_TIMESTAMP)`);
  expectRejected('Woo purchase with acquisition UsageEvent rejected', `INSERT INTO billing."RecoveryCreditPurchase" ("id","shopId","planId","provider","usageEventId","creditsGranted","updatedAt") VALUES ('arch027-woo-usage-event','arch027-shop-woo-free','arch027-billing-free','WOOCOMMERCE','arch027-event-shopify-requested',1,CURRENT_TIMESTAMP)`);
  expectRejected('non-requested Woo purchase without provider valuation rejected', `UPDATE billing."RecoveryCreditPurchase" SET "status"='ACTIVE',"currentAmount"=10 WHERE "id"='arch027-woo-purchase-free-second'`);
  expectRejected('Shopify purchase missing acquisition evidence rejected', `INSERT INTO billing."RecoveryCreditPurchase" ("id","shopId","planId","billingPeriodId","creditsGranted","updatedAt") VALUES ('arch027-shopify-missing-evidence','arch027-shop-shopify','arch027-billing-paid','arch027-period-shopify',1,CURRENT_TIMESTAMP)`);

  psql(`UPDATE billing."RecoveryCreditPurchase"
    SET "status"='ACTIVE',"currentAmount"=10,"providerReference"='woo-charge-free-001',
        "providerPurchaseAmount"=5,"providerPurchaseCurrency"='USD',"providerValuationConfirmedAt"=CURRENT_TIMESTAMP,
        "providerPriceSnapshot"='{"bundle":"free"}'::jsonb
    WHERE "id"='arch027-woo-purchase-free';
UPDATE billing."RecoveryCreditPurchase"
    SET "status"='ACTIVE',"currentAmount"=10,"providerReference"='woo-charge-paid-001',
        "providerPurchaseAmount"=7,"providerPurchaseCurrency"='USD',"providerValuationConfirmedAt"=CURRENT_TIMESTAMP,
        "providerPriceSnapshot"='{"bundle":"paid"}'::jsonb
    WHERE "id"='arch027-woo-purchase-paid';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditPurchase"
    WHERE "id"='arch027-woo-purchase-free' AND "provider"='WOOCOMMERCE' AND "billingPeriodId" IS NULL
      AND "usageEventId" IS NULL AND "providerReference"='woo-charge-free-001';`), 1);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditPurchase"
    WHERE "id"='arch027-woo-purchase-paid' AND "billingPeriodId"='arch027-period-woo-paid';`), 1);
  psql(`UPDATE billing."RecoveryCreditPurchase" SET "refundAttemptedAt"=CURRENT_TIMESTAMP WHERE "id"='arch027-woo-purchase-free';`);
  const refundAttemptedAt = psql(`SELECT "refundAttemptedAt"::text FROM billing."RecoveryCreditPurchase" WHERE "id"='arch027-woo-purchase-free';`, {capture: true});
  psql(`UPDATE billing."RecoveryCreditPurchase" SET "refundAttemptedAt"='${refundAttemptedAt.replaceAll("'", "''")}' WHERE "id"='arch027-woo-purchase-free';`);
  expectRejected('purchase refundAttemptedAt cannot be cleared', `UPDATE billing."RecoveryCreditPurchase" SET "refundAttemptedAt"=NULL WHERE "id"='arch027-woo-purchase-free'`);
  expectRejected('purchase refundAttemptedAt cannot be changed', `UPDATE billing."RecoveryCreditPurchase" SET "refundAttemptedAt"="refundAttemptedAt" + INTERVAL '1 second' WHERE "id"='arch027-woo-purchase-free'`);
  console.log('PASS Woo Free and paid purchase shapes and monotonic refund-attempt evidence');

  const shopifyPositive = `INSERT INTO billing."RecoveryCreditPurchase" (
    "id","shopId","planId","billingPeriodId","shopifyPlanHandleSnapshot","shopifyEventHandleSnapshot",
    "providerSubscriptionIdSnapshot","providerUsageQuantityBeforeSnapshot","providerUsageCostBeforeSnapshot",
    "providerUsageCostCurrencyBeforeSnapshot","providerUsageQuantityAfterSnapshot","providerUsageCostAfterSnapshot",
    "providerUsageCostCurrencyAfterSnapshot","providerPurchaseAmount","providerPurchaseCurrency",
    "providerValuationConfirmedAt","providerPriceSnapshot","creditsGranted","currentAmount","reservedAmount",
    "status","usageEventId","updatedAt"
  ) VALUES ('arch027-shopify-active-new','arch027-shop-shopify','arch027-billing-paid','arch027-period-shopify','paid','pack',
    'shopify-arch027-contract',1,2,'USD',2,3,'USD',1,'USD',CURRENT_TIMESTAMP,'{"price":1}'::jsonb,5,5,0,'ACTIVE','arch027-event-shopify-positive',CURRENT_TIMESTAMP);`;
  expectRejected('Shopify purchase UsageEvent remains one-to-one', shopifyPositive, '23505');
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."RecoveryCreditPurchase"
    WHERE "id"='arch027-shopify-zero' AND "provider"='SHOPIFY' AND "providerPurchaseAmount"=0;`), 1);
  console.log('PASS existing Shopify zero-value valuation remains valid');

  psql(insertOperation({id: 'arch027-op-create', key: 'create-1', planId: 'arch027-catalog-paid', amount: 1000, currency: 'EUR', period: 'EVERY_30_DAYS'}));
  psql(insertOperation({id: 'arch027-op-same-fingerprint-a', key: 'same-fingerprint-a', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  psql(insertOperation({id: 'arch027-op-same-fingerprint-b', key: 'same-fingerprint-b', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  psql(insertOperation({id: 'arch027-op-switch', kind: 'PLAN_SWITCH', key: 'switch-1', planId: 'arch027-catalog-paid', amount: 1500, currency: 'USD', period: 'EVERY_30_DAYS', providerReference: 'woo-recurring-switch-1'}));
  psql(insertOperation({id: 'arch027-op-cancel', kind: 'CANCEL', key: 'cancel-1', providerReference: 'woo-recurring-cancel-1'}));
  psql(insertOperation({id: 'arch027-op-unknown', key: 'unknown-1', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS', state: 'OUTCOME_UNKNOWN'}));
  psql(insertOperation({id: 'arch027-op-delete', key: 'delete-1', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  psql(insertOperation({id: 'arch027-op-switch-other', kind: 'PLAN_SWITCH', key: 'switch-other', planId: 'arch027-catalog-paid', amount: 1500, currency: 'USD', period: 'EVERY_30_DAYS', providerReference: 'woo-recurring-switch-2'}));
  psql(insertOperation({id: 'arch027-op-one-time', kind: 'ONE_TIME_CHARGE', key: 'charge-1', eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD', purchaseId: 'arch027-woo-purchase-free'}));

  expectRejected('invalid operation fingerprint length rejected', insertOperation({id: 'arch027-op-short-digest', key: 'short-digest', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS', digest: 31}));
  expectRejected('blank operation request key rejected', insertOperation({id: 'arch027-op-blank-key', key: '   ', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('duplicate Shop/requestKey rejected', insertOperation({id: 'arch027-op-duplicate-key', key: 'create-1', planId: 'arch027-catalog-paid', amount: 1000, currency: 'EUR', period: 'EVERY_30_DAYS'}), '23505');
  expectRejected('subscription operation cannot carry a usage event', insertOperation({id: 'arch027-op-wrong-event', key: 'wrong-event', planId: 'arch027-catalog-paid', eventId: 'arch027-catalog-free-bundle', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('one-time charge requires its purchase', insertOperation({id: 'arch027-op-no-purchase', kind: 'ONE_TIME_CHARGE', key: 'no-purchase', eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD'}));
  expectRejected('one-time charge purchase must belong to the same Shop', insertOperation({id: 'arch027-op-cross-shop', kind: 'ONE_TIME_CHARGE', key: 'cross-shop', eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD', purchaseId: 'arch027-woo-purchase-paid'}));
  expectRejected('zero-value subscription create rejected', insertOperation({id: 'arch027-op-zero-create', key: 'zero-create', planId: 'arch027-catalog-paid', amount: 0, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('one-time charge cannot carry a recurring period', insertOperation({id: 'arch027-op-charge-period', kind: 'ONE_TIME_CHARGE', key: 'charge-period', eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD', period: 'EVERY_30_DAYS', purchaseId: 'arch027-woo-purchase-free-second'}));
  expectRejected('cancel cannot carry catalogue or quote fields', insertOperation({id: 'arch027-op-cancel-shape', kind: 'CANCEL', key: 'cancel-shape', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS', providerReference: 'woo-recurring-cancel-2'}));
  expectRejected('confirmed operation requires provider reference', insertOperation({id: 'arch027-op-confirmed-no-reference', key: 'confirmed-no-reference', state: 'CONFIRMED', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('plan switch requires existing provider reference', insertOperation({id: 'arch027-op-switch-no-reference', kind: 'PLAN_SWITCH', key: 'switch-no-reference', planId: 'arch027-catalog-paid', amount: 1000, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('cancel requires existing provider reference', insertOperation({id: 'arch027-op-cancel-no-reference', kind: 'CANCEL', key: 'cancel-no-reference'}));
  psql(`UPDATE billing."BillingOperation" SET "providerReference"='woo-created-1',"state"='AWAITING_CONFIRMATION',"confirmationUrl"='https://billing.example/confirm',"lastErrorCode"=NULL WHERE "id"='arch027-op-create';`);
  expectRejected('operation provider reference cannot be replaced', `UPDATE billing."BillingOperation" SET "providerReference"='woo-created-2' WHERE "id"='arch027-op-create'`);
  expectRejected('operation provider reference cannot be cleared', `UPDATE billing."BillingOperation" SET "providerReference"=NULL WHERE "id"='arch027-op-create'`);
  expectRejected('operation quote and intent are immutable', `UPDATE billing."BillingOperation" SET "quotedAmountMinor"=2000 WHERE "id"='arch027-op-create'`);
  psql(`UPDATE billing."BillingOperation" SET "state"='CONFIRMED' WHERE "id"='arch027-op-create';`);
  console.log('PASS operation shapes, idempotency namespace, currency syntax, state evidence and write-once provider references');

  psql(`INSERT INTO woocommerce."WooCommerceBillingWebhookReceipt" ("id","topic","providerContractId","payloadSha256","normalizedPayload")
    VALUES ('arch027-receipt-one','subscription.updated',NULL,decode(repeat('ab',32),'hex'),'{}'::jsonb);
INSERT INTO woocommerce."WooCommerceBillingWebhookReceipt" ("id","topic","providerContractId","payloadSha256","normalizedPayload")
    VALUES ('arch027-receipt-two','subscription.updated',NULL,decode(repeat('ac',32),'hex'),'{}'::jsonb);
INSERT INTO woocommerce."WooCommerceBillingWebhookReceipt" ("id","topic","payloadSha256","normalizedPayload","billingOperationId")
    VALUES ('arch027-receipt-delete','subscription.updated',decode(repeat('ad',32),'hex'),'{}'::jsonb,'arch027-op-delete');`);
  expectRejected('receipt with invalid SHA-256 length rejected', `INSERT INTO woocommerce."WooCommerceBillingWebhookReceipt" ("id","topic","payloadSha256","normalizedPayload") VALUES ('arch027-receipt-short','subscription.updated',decode(repeat('ab',31),'hex'),'{}'::jsonb)`);
  expectRejected('exact duplicate receipt rejected with null contract id', `INSERT INTO woocommerce."WooCommerceBillingWebhookReceipt" ("id","topic","providerContractId","payloadSha256","normalizedPayload") VALUES ('arch027-receipt-duplicate','subscription.updated',NULL,decode(repeat('ab',32),'hex'),'{}'::jsonb)`, '23505');
  expectRejected('accepted receipt evidence is immutable', `UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "normalizedPayload"='{"changed":true}'::jsonb WHERE "id"='arch027-receipt-one'`);
  psql(`UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "billingOperationId"='arch027-op-create' WHERE "id"='arch027-receipt-one';
UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "billingOperationId"='arch027-op-create' WHERE "id"='arch027-receipt-one';
UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "processingError"='retryable' WHERE "id"='arch027-receipt-one';
UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "processedAt"=CURRENT_TIMESTAMP,"processingError"=NULL WHERE "id"='arch027-receipt-one';`);
  expectRejected('receipt correlation cannot be retargeted', `UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "billingOperationId"='arch027-op-switch-other' WHERE "id"='arch027-receipt-one'`);
  expectRejected('processed receipt cannot retain processing error', `UPDATE woocommerce."WooCommerceBillingWebhookReceipt" SET "processingError"='late error' WHERE "id"='arch027-receipt-one'`);
  psql(`DELETE FROM billing."BillingOperation" WHERE "id"='arch027-op-delete';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM woocommerce."WooCommerceBillingWebhookReceipt"
    WHERE "id"='arch027-receipt-delete' AND "billingOperationId" IS NULL;`), 1);
  console.log('PASS exact-delivery dedupe, receipt evidence immutability, correlation and mutable processing state');

  psql(`INSERT INTO billing."RecoveryCreditRefund" (
    "id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot",
    "reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","billingPeriodIdSnapshot",
    "providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot","purchaseProviderAmountSnapshot",
    "purchaseProviderCurrencySnapshot","requestKey","provider","status","finalCreditQuantity","providerAmount","providerCurrency","providerReference",
    "providerActionKind","providerConfirmedAt","updatedAt"
  ) VALUES (
    'arch027-woo-refund-complete','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,
    NULL,NULL,NULL,NULL,5,'USD','arch027-woo-refund-complete','WOOCOMMERCE','COMPLETED',2,2.5,'USD','woo-refund-001','REFUND',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  );`);
  expectRejected('invalid refund provider rejected', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","updatedAt") VALUES ('arch027-refund-bad-provider','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,5,'USD','bad-provider','MAGENTO',CURRENT_TIMESTAMP)`);
  expectRejected('Woo refund cannot carry Shopify plan/event snapshots', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","planHandleSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","updatedAt") VALUES ('arch027-refund-fake-shopify','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,'fake-plan',5,'USD','fake-shopify','WOOCOMMERCE',CURRENT_TIMESTAMP)`);
  expectRejected('Woo refund cannot carry Shopify correction evidence', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","automaticCorrectionUsageEventId","providerUsageQuantityBeforeCorrection","providerUsageCostBeforeCorrection","expectedProviderUsageQuantityAfterCorrection","expectedProviderUsageCostAfterCorrection","finalCreditQuantity","expectedProviderAmount","expectedProviderCurrency","updatedAt") VALUES ('arch027-refund-fake-correction','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,5,'USD','fake-correction','WOOCOMMERCE','arch027-event-shopify-correction',3,2,2,1,1,1,'USD',CURRENT_TIMESTAMP)`);
  expectRejected('completed Woo refund requires provider settlement evidence', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","status","finalCreditQuantity","updatedAt") VALUES ('arch027-refund-no-settlement','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,5,'USD','no-settlement','WOOCOMMERCE','COMPLETED',2,CURRENT_TIMESTAMP)`);
  expectRejected('completed Woo refund requires provider amount', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","status","finalCreditQuantity","providerCurrency","providerReference","providerActionKind","providerConfirmedAt","updatedAt") VALUES ('arch027-refund-no-amount','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,5,'USD','no-amount','WOOCOMMERCE','COMPLETED',2,'USD','woo-refund-no-amount','REFUND',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  expectRejected('completed Woo refund requires provider currency', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","status","finalCreditQuantity","providerAmount","providerReference","providerActionKind","providerConfirmedAt","updatedAt") VALUES ('arch027-refund-no-currency','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,5,'USD','no-currency','WOOCOMMERCE','COMPLETED',2,2.5,'woo-refund-no-currency','REFUND',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  expectRejected('refund provider must match referenced purchase', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","billingPeriodIdSnapshot","providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","updatedAt") VALUES ('arch027-refund-provider-mismatch','arch027-shop-shopify','arch027-shopify-positive','MERCHANT_UI',10,10,0,10,NULL,NULL,NULL,NULL,1,'USD','provider-mismatch','WOOCOMMERCE',CURRENT_TIMESTAMP)`);
  expectRejected('Shopify refund still requires period snapshot', `INSERT INTO billing."RecoveryCreditRefund" ("id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot","reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot","purchaseProviderAmountSnapshot","purchaseProviderCurrencySnapshot","requestKey","provider","updatedAt") VALUES ('arch027-refund-shopify-no-period','arch027-shop-shopify','arch027-shopify-positive','MERCHANT_UI',10,10,0,10,'shopify-arch027-contract','paid','pack',1,'USD','shopify-no-period','SHOPIFY',CURRENT_TIMESTAMP)`);
  psql(`INSERT INTO billing."RecoveryCreditRefund" (
    "id","shopId","purchaseId","source","purchaseCreditsGrantedSnapshot","currentAmountAtRequestSnapshot",
    "reservedAmountAtRequestSnapshot","availableAmountAtRequestSnapshot","billingPeriodIdSnapshot",
    "providerSubscriptionIdSnapshot","planHandleSnapshot","eventHandleSnapshot","purchaseProviderAmountSnapshot",
    "purchaseProviderCurrencySnapshot","requestKey","provider","providerAmount","providerCurrency","updatedAt"
  ) VALUES (
    'arch027-woo-refund-money-pair','arch027-shop-woo-free','arch027-woo-purchase-free','MERCHANT_UI',10,10,0,10,
    NULL,NULL,NULL,NULL,5,'USD','arch027-woo-refund-money-pair','WOOCOMMERCE',2.5,'USD',CURRENT_TIMESTAMP
  );`);
  expectRejectedWithMessage('purchase provider cannot change after refunds exist', `UPDATE billing."RecoveryCreditPurchase" SET "provider"='SHOPIFY' WHERE "id"='arch027-woo-purchase-free'`, 'ARCH027 purchase provider change would mismatch existing refunds');
  expectRejectedWithMessage('purchase Shop cannot change after billing operation references it', `UPDATE billing."RecoveryCreditPurchase" SET "shopId"='arch027-shop-woo-paid' WHERE "id"='arch027-woo-purchase-free'`, 'ARCH027 purchase Shop change would mismatch its billing operation');
  expectRejected('Woo refund provider money requires amount/currency pair', `UPDATE billing."RecoveryCreditRefund" SET "providerCurrency"=NULL WHERE "id"='arch027-woo-refund-money-pair'`);
  console.log('PASS provider-specific refund snapshots, settlement proof and purchase-provider consistency');

  assert.equal(jsonQuery(`SELECT count(*)::int FROM woocommerce."WooCommerceInstallation";`), 0,
    'billing rehearsal must not seed or alter WooCommerceInstallation');
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingOperation" WHERE "id"='arch027-op-one-time' AND "recoveryCreditPurchaseId"='arch027-woo-purchase-free';`), 1);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."Subscription" WHERE "id"='arch027-sub-woo-free' AND "providerSubscriptionId" IS NULL;`), 1,
    'one-time charge identity must not become a recurring Subscription provider id');
  console.log('PASS Free Woo subscription retains NULL recurring identity alongside one-time charge evidence');
}

async function main() {
  const identity = psql(`SELECT current_database() || '|' || current_setting('server_version_num')::int;`, {capture: true});
  const [connectedDatabase, versionText] = identity.split('|');
  assert.equal(connectedDatabase, databaseName, 'explicit database URL resolved to an unexpected database');
  assert.ok(Number(versionText) >= 170000, 'use the approved PostgreSQL 17 / pgvector runtime');
  const existingTables = Number(psql(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%';`, {capture: true}));
  assert.equal(existingTables, 0, `${databaseName} must be a fresh disposable database with no user tables`);

  const migrations = migrationNames();
  assert.equal(migrations.at(-1), targetMigration, 'ARCH-027 must be the last ordered migration for this task branch');
  for (const name of migrations) {
    if (name === targetMigration) break;
    applyMigration(name);
  }

  let before;
  if (mode === 'upgrade') {
    seedLegacyShopifyRows();
    before = legacyEvidence();
  }

  applyMigration(targetMigration);
  if (mode === 'upgrade') assertLegacyUpgrade(before);
  seedRuntimeRows();
  runBehaviorCases();
  console.log(`ARCH-027 ${mode} PostgreSQL migration rehearsal passed on PostgreSQL ${Number(versionText) / 10000}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});