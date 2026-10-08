import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';

const targetMigration = '20261008140724_arch028_whatsapp_failure_reachability_compensation';
const databaseUrl = process.env.ARCH028_FRESH_DATABASE_URL;
assert.ok(databaseUrl, 'ARCH028_FRESH_DATABASE_URL must name a disposable localhost PostgreSQL 17 database');
const parsedUrl = new URL(databaseUrl);
assert.ok(['postgres:', 'postgresql:'].includes(parsedUrl.protocol), 'ARCH028_FRESH_DATABASE_URL must use PostgreSQL');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname.replace(/^\[|\]$/g, '')),
  'ARCH028_FRESH_DATABASE_URL must point to localhost');
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
assert.match(databaseName, /^arch028_fresh_fixture(?:_[a-z0-9]+(?:_[a-z0-9]+)*)?$/i,
  'use a dedicated arch028_fresh_fixture database, optionally with a unique suffix');
const psqlUrl = new URL(databaseUrl);
psqlUrl.searchParams.delete('schema');

function psql(sql, {capture = false} = {}) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', '--set=VERBOSITY=verbose'];
  if (capture) args.push('-A', '-t', '-q');
  else args.push('-q');
  args.push(psqlUrl.toString());
  try {
    return execFileSync('psql', args, {encoding: 'utf8', input: sql, maxBuffer: 32 * 1024 * 1024}).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`psql failed${detail ? `: ${detail}` : ''}`, {cause: error});
  }
}

function jsonQuery(sql) {
  return JSON.parse(psql(sql, {capture: true}));
}

function expectRejected(label, sql, sqlState = '23514') {
  try {
    psql(sql);
  } catch (error) {
    assert.ok(error.message.includes(sqlState), `${label}: unexpected failure ${error.message}`);
    console.log(`PASS ${label}`);
    return;
  }
  assert.fail(`Expected database rejection: ${label}`);
}

function migrationNames() {
  return readdirSync(new URL('../prisma/migrations/', import.meta.url))
    .filter(name => /^\d{14}_.+$/.test(name)).sort();
}

function applyMigration(name) {
  const sql = readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
  psql(sql);
  console.log(`APPLIED ${name}`);
}

const identity = psql(`SELECT jsonb_build_object(
  'database', current_database(),
  'version', current_setting('server_version_num')::int
)::text;`, {capture: true});
const {database, version} = JSON.parse(identity);
assert.equal(database, databaseName, 'connected to an unexpected database');
assert.ok(version >= 170000, 'use PostgreSQL 17 or newer with pgvector');
const existingTables = Number(psql(`SELECT count(*)
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r','p')
    AND namespace.nspname NOT IN ('pg_catalog','information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%';`, {capture: true}));
assert.equal(existingTables, 0, `${databaseName} must be a fresh disposable database`);

const migrations = migrationNames();
const arch027 = '20261008110000_arch027_woocommerce_billing_persistence';
assert.ok(migrations.includes(arch027), 'accepted ARCH-027 migration must be present');
assert.ok(migrations.includes(targetMigration), 'ARCH-028 migration must be present');
assert.ok(migrations.indexOf(arch027) < migrations.indexOf(targetMigration), 'ARCH-027 must apply before ARCH-028');
for (const name of migrations) applyMigration(name);

const preservedObjects = jsonQuery(`SELECT jsonb_build_object(
  'billingOperation', to_regclass('billing."BillingOperation"') IS NOT NULL,
  'wooReceipt', to_regclass('woocommerce."WooCommerceBillingWebhookReceipt"') IS NOT NULL,
  'subscriptionCoverage', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='billing' AND table_name='Subscription' AND column_name='providerCoverageEndAt'),
  'counterAllowance', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='billing' AND table_name='BillingPeriodEntitlementCounter' AND column_name='currentAllowanceQuantity'),
  'operationRequestKey', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='billing' AND table_name='BillingOperation' AND column_name='requestKey'),
  'receiptPayloadHash', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='woocommerce' AND table_name='WooCommerceBillingWebhookReceipt' AND column_name='payloadSha256'),
  'receiptDedupeIndex', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='woocommerce' AND indexname='WooCommerceBillingWebhookReceipt_topic_payloadSha256_key')
)::text;`);
assert.deepEqual(preservedObjects, {
  billingOperation: true,
  wooReceipt: true,
  subscriptionCoverage: true,
  counterAllowance: true,
  operationRequestKey: true,
  receiptPayloadHash: true,
  receiptDedupeIndex: true,
});
console.log('PASS accepted ARCH-027 WooCommerce billing schema and fields remain after ARCH-028');

psql(`INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES
  ('arch028-shop-a','arch028-a.invalid','SHOPIFY',CURRENT_TIMESTAMP),
  ('arch028-shop-b','arch028-b.invalid','SHOPIFY',CURRENT_TIMESTAMP);
INSERT INTO billing."ShopEntitlementCounter" ("id","shopId","counter","updatedAt")
VALUES ('arch028-capacity-counter','arch028-shop-a','LIFETIME_FREE_RECOVERY_CREDITS',CURRENT_TIMESTAMP);
INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","updatedAt") VALUES
  ('arch028-reach-a','arch028-shop-a','15551234567',CURRENT_TIMESTAMP),
  ('arch028-reach-b','arch028-shop-b','15551234567',CURRENT_TIMESTAMP);`);
console.log('PASS same canonical recipient can be represented independently for multiple Shops');
expectRejected('duplicate recipient within one Shop rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","updatedAt") VALUES ('arch028-reach-a-duplicate','arch028-shop-a','15551234567',CURRENT_TIMESTAMP);`, '23505');
expectRejected('non-digit recipient rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","updatedAt") VALUES ('arch028-reach-invalid','arch028-shop-a','+15551234567',CURRENT_TIMESTAMP);`);
expectRejected('empty recipient rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","updatedAt") VALUES ('arch028-reach-empty','arch028-shop-a','',CURRENT_TIMESTAMP);`);
expectRejected('recipient longer than 64 digits rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","updatedAt") VALUES ('arch028-reach-too-long','arch028-shop-a',repeat('1',65),CURRENT_TIMESTAMP);`, '22001');
expectRejected('suppression without failure evidence rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","suppressUntil","updatedAt") VALUES ('arch028-reach-no-evidence','arch028-shop-a','15550000001',CURRENT_TIMESTAMP + INTERVAL '1 day',CURRENT_TIMESTAMP);`);
expectRejected('suppression not later than failure rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","lastFailureAt","suppressUntil","updatedAt") VALUES ('arch028-reach-expired','arch028-shop-a','15550000002',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
expectRejected('whitespace-only failure code rejected', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","lastProviderFailureCode","lastFailureAt","updatedAt") VALUES ('arch028-reach-empty-code','arch028-shop-a','15550000003','   ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
expectRejected('reachability failure code requires failure timestamp', `INSERT INTO whatsapp."WhatsAppRecipientReachability" ("id","shopId","recipient","lastProviderFailureCode","updatedAt") VALUES ('arch028-reach-code-no-time','arch028-shop-a','15550000004','TEMPORARY',CURRENT_TIMESTAMP);`);
psql(`INSERT INTO billing."PlatformBillingPolicy" ("id","absoluteOutboundHardLimit","defaultWarningPercent","updatedAt") VALUES ('default',5000,80,CURRENT_TIMESTAMP);`);
assert.equal(jsonQuery(`SELECT "whatsappRecipientSuppressionDays" FROM billing."PlatformBillingPolicy" WHERE "id"='default';`), 7);
expectRejected('non-positive platform suppression duration rejected', `UPDATE billing."PlatformBillingPolicy" SET "whatsappRecipientSuppressionDays"=0 WHERE "id"='default';`);

psql(`INSERT INTO whatsapp."Conversation" ("id","type","updatedAt") VALUES ('arch028-conversation','RECOVERY',CURRENT_TIMESTAMP);`);
expectRejected('message provider failure code requires failedAt', `INSERT INTO whatsapp."ConversationMessage" ("id","conversationId","direction","senderType","content","providerFailureCode") VALUES ('arch028-message-no-failed-at','arch028-conversation','OUTBOUND','AUTOMATION','failed','TEMPORARY');`);
expectRejected('message provider failure code must be trimmed', `INSERT INTO whatsapp."ConversationMessage" ("id","conversationId","direction","senderType","content","providerFailureCode","failedAt") VALUES ('arch028-message-untrimmed','arch028-conversation','OUTBOUND','AUTOMATION','failed',' TEMPORARY ',CURRENT_TIMESTAMP);`);
expectRejected('message provider failure code rejects edge tabs', `INSERT INTO whatsapp."ConversationMessage" ("id","conversationId","direction","senderType","content","providerFailureCode","failedAt") VALUES ('arch028-message-tab-trim','arch028-conversation','OUTBOUND','AUTOMATION','failed',E'\\tTEMPORARY',CURRENT_TIMESTAMP);`);
expectRejected('message provider failure code is bounded to 64 characters', `INSERT INTO whatsapp."ConversationMessage" ("id","conversationId","direction","senderType","content","providerFailureCode","failedAt") VALUES ('arch028-message-code-too-long','arch028-conversation','OUTBOUND','AUTOMATION','failed',repeat('X',65),CURRENT_TIMESTAMP);`, '22001');

function compensationRows({suffix, originalShop = 'arch028-shop-a', correctionShop = originalShop, originalMetric = 'RECOVERY_CONVERSATION', correctionMetric = originalMetric, correctionQuantity = -1, correctionOf = `arch028-${suffix}-original`, status = 'COMMITTED', includeCompensation = true}) {
  const originalId = `arch028-${suffix}-original`;
  const correctionId = `arch028-${suffix}-correction`;
  const reservationId = `arch028-${suffix}-reservation`;
  const compensationFields = includeCompensation
    ? `,"compensationUsageEventId","compensationReason","compensationDisposition","compensatedAt"\n    ,'${correctionId}','WHATSAPP_RECIPIENT_UNDELIVERABLE','RESTORED_SPENDABLE',CURRENT_TIMESTAMP`
    : '';
  return `BEGIN;
INSERT INTO billing."UsageEvent" ("id","shopId","metric","quantity","idempotencyKey") VALUES
  ('${originalId}','${originalShop}','${originalMetric}',1,'${originalId}-key'),
  ('${correctionId}','${correctionShop}','${correctionMetric}',${correctionQuantity},'${correctionId}-key');
UPDATE billing."UsageEvent" SET "correctionOfUsageEventId"='${correctionOf}' WHERE "id"='${correctionId}';
INSERT INTO billing."UsageReservation" ("id","shopId","counterId","sourceKey","quantity","status","committedUsageEventId"${compensationFields ? `,${compensationFields.split('\n')[0].replace(/^,/, '')}` : ''},"updatedAt") VALUES
  ('${reservationId}','${originalShop}','arch028-capacity-counter','${reservationId}-source',1,'${status}','${originalId}'${includeCompensation ? `,'${correctionId}','WHATSAPP_RECIPIENT_UNDELIVERABLE','RESTORED_SPENDABLE',CURRENT_TIMESTAMP` : ''},CURRENT_TIMESTAMP);
COMMIT;`;
}

psql(compensationRows({suffix: 'valid'}));
console.log('PASS committed reservation accepts one exact negative same-Shop recovery correction');
expectRejected('cross-Shop correction rejected', compensationRows({suffix: 'cross-shop', correctionShop: 'arch028-shop-b'}));
expectRejected('wrong correction metric rejected', compensationRows({suffix: 'wrong-metric', correctionMetric: 'RECOVERY_CREDIT_PACK_PURCHASE'}));
expectRejected('wrong original UsageEvent reference rejected', compensationRows({suffix: 'wrong-original', correctionOf: 'arch028-valid-correction'}));
expectRejected('non-negative correction rejected', compensationRows({suffix: 'non-negative', correctionQuantity: 1}));
expectRejected('reserved source cannot have compensation provenance rejected', compensationRows({suffix: 'reserved-compensation', status: 'RESERVED'}));
expectRejected('partial compensation provenance rejected', `INSERT INTO billing."UsageReservation" ("id","shopId","counterId","sourceKey","quantity","compensationReason","updatedAt") VALUES ('arch028-partial-reservation','arch028-shop-a','arch028-capacity-counter','arch028-partial-source',1,'WHATSAPP_RECIPIENT_UNDELIVERABLE',CURRENT_TIMESTAMP);`);
psql(compensationRows({suffix: 'reserved-no-compensation', status: 'RESERVED', includeCompensation: false}));
console.log('PASS RESERVED reservation remains valid without any compensation UsageEvent');
expectRejected('correction mutation cannot invalidate committed compensation', `BEGIN; UPDATE billing."UsageEvent" SET "quantity"=-2 WHERE "id"='arch028-valid-correction'; COMMIT;`);
expectRejected('correction Shop mutation cannot invalidate committed compensation', `BEGIN; UPDATE billing."UsageEvent" SET "shopId"='arch028-shop-b' WHERE "id"='arch028-valid-correction'; COMMIT;`);
expectRejected('correction metric mutation cannot invalidate committed compensation', `BEGIN; UPDATE billing."UsageEvent" SET "metric"='OUTBOUND_AUTOMATED_MESSAGE' WHERE "id"='arch028-valid-correction'; COMMIT;`);
expectRejected('correction reference mutation cannot invalidate committed compensation', `BEGIN; UPDATE billing."UsageEvent" SET "correctionOfUsageEventId"='arch028-valid-correction' WHERE "id"='arch028-valid-correction'; COMMIT;`);
expectRejected('committed source mutation cannot invalidate compensation quantity', `BEGIN; UPDATE billing."UsageEvent" SET "quantity"=2 WHERE "id"='arch028-valid-original'; COMMIT;`);
expectRejected('compensated reservation cannot return to RESERVED', `BEGIN; UPDATE billing."UsageReservation" SET "status"='RESERVED' WHERE "id"='arch028-valid-reservation'; COMMIT;`);

console.log(`ARCH-028 fresh PostgreSQL rehearsal passed on PostgreSQL ${version / 10000}.`);