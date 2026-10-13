import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable PostgreSQL proof applying the real migrations in file order.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or --mode upgrade');
const target = '20261013183000_arch038_unified_model_policies';
const container = `moda-arch038-db001-${randomUUID()}`;
const db = 'arch038_policy_fixture';
const postgresImage = 'pgvector/pgvector:pg17';
const migrations = new URL('../prisma/migrations/', import.meta.url);
let running = false;
function docker(args, opts = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
}
function sql(source, capture = false) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    ...(capture ? ['-A', '-t'] : []), '-U', 'postgres', '-d', db], { input: source }).trim();
}
function scalar(statement) { return sql(statement, true).split('\n').at(-1).trim(); }
function apply(name) {
  sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function rejected(statement, label) {
  let failed = false;
  try { sql(statement); } catch (error) {
    failed = true;
    assert.match(String(error.stderr ?? ''), /ERROR:/, `${label} should fail at PostgreSQL`);
  }
  assert.ok(failed, `${label} should have been rejected`);
}
const policy = '"commerce"."CommerceModelPolicy"';
function insert(id, context, scope, planId, shopId, budget, admin = 'arch038-admin') {
  return `INSERT INTO ${policy} ("id","environment","context","scope","merchantPricingPlanId","shopId","budget","updatedByAdminId") VALUES
    ('${id}', 'DEVELOPMENT', '${context}', '${scope}', ${planId ? `'${planId}'` : 'NULL'}, ${shopId ? `'${shopId}'` : 'NULL'}, '${JSON.stringify(budget)}'::jsonb, ${admin ? `'${admin}'` : 'NULL'});`;
}
async function main() {
  docker(['run', '-d', '--name', container, '--network', 'none',
    '-e', 'POSTGRES_PASSWORD=arch038-fixture', '-e', `POSTGRES_DB=${db}`, postgresImage]);
  running = true;
  // The image starts a Unix-socket-only temporary server during initdb. A socket
  // pg_isready check can pass before that server shuts down for final startup.
  // TCP readiness only succeeds once the final PostgreSQL server is accepting.
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', db]);
      ready = true;
      break;
    } catch {
      await delay(1000);
    }
  }
  if (!ready) throw new Error('PostgreSQL did not become ready on TCP');
  const names = readdirSync(migrations).filter(n => /^\d{14}_.+/.test(n)).sort();
  assert.equal(names.at(-1), target, 'Target must be last migration in uploaded baseline');
  let previousShopCount = 0, previousPlanCount = 0, previousSubscriptionCount = 0, previousBillingPlanCount = 0;
  for (const name of names) {
    if (mode === 'upgrade' && name === target) {
      // Existing merchant/billing fixtures must survive the upgrade.
      sql(`INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt") VALUES ('arch038-shop', 'arch038-shop.example', now());`);
      sql(`BEGIN;
        INSERT INTO "billing"."BillingPlan" ("id", "shopifyPlanHandle", "name", "kind", "updatedAt")
          VALUES ('arch038-existing-billing-plan', 'arch038-existing', 'ARCH038 Existing', 'FREE', now());
        INSERT INTO "billing"."Subscription" ("id", "shopId", "planId", "status", "updatedAt")
          VALUES ('arch038-existing-subscription', 'arch038-shop', 'arch038-existing-billing-plan', 'NO_CONTRACT', now());
        INSERT INTO "billing"."MerchantPricingPlan" (
          "id", "shopifyPlanHandle", "displayName", "planKind", "cataloguePosition",
          "includedRecoveryCredits", "allowancePeriod", "billingPeriod", "recurringAmountMinor", "currency", "updatedAt"
        ) VALUES ('arch038-existing-merchant-plan', 'arch038-existing-merchant', 'ARCH038 Existing Merchant Plan', 'FREE',
          (SELECT count(*) FROM "billing"."MerchantPricingPlan"), 0, 'LIFETIME', 'EVERY_30_DAYS', 0, 'GBP', now());
        INSERT INTO "billing"."MerchantPricingPlanTranslation"
          ("id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt")
        SELECT 'arch038-existing-translation-' || locale, 'arch038-existing-merchant-plan', locale, 'Existing plan fixture', now()
        FROM unnest(ARRAY[
          'cs','da','de','en','es','fi','fr','it','ja','ko','nb','nl','pl',
          'pt-BR','pt-PT','sv','th','tr','zh-Hans','zh-Hant'
        ]) AS locale;
        COMMIT;`);
      previousShopCount = Number(scalar('SELECT count(*) FROM "commerce"."Shop";'));
      previousPlanCount = Number(scalar('SELECT count(*) FROM "billing"."MerchantPricingPlan";'));
      previousSubscriptionCount = Number(scalar('SELECT count(*) FROM "billing"."Subscription";'));
      previousBillingPlanCount = Number(scalar('SELECT count(*) FROM "billing"."BillingPlan";'));
      assert.ok(previousShopCount > 0 && previousPlanCount > 0 && previousSubscriptionCount > 0 && previousBillingPlanCount > 0,
        'Upgrade fixtures must populate all protected Shop and billing tables before the target migration');
    }
    apply(name);
  }
  if (mode === 'fresh') {
    sql(`INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt") VALUES ('arch038-shop', 'arch038-shop.example', now());`);
  } else {
    assert.equal(Number(scalar('SELECT count(*) FROM "commerce"."Shop";')), previousShopCount);
    assert.equal(Number(scalar('SELECT count(*) FROM "billing"."MerchantPricingPlan";')), previousPlanCount);
    assert.equal(Number(scalar('SELECT count(*) FROM "billing"."Subscription";')), previousSubscriptionCount);
    assert.equal(Number(scalar('SELECT count(*) FROM "billing"."BillingPlan";')), previousBillingPlanCount);
    for (const [table, id] of [
      ['commerce."Shop"', 'arch038-shop'],
      ['billing."MerchantPricingPlan"', 'arch038-existing-merchant-plan'],
      ['billing."Subscription"', 'arch038-existing-subscription'],
      ['billing."BillingPlan"', 'arch038-existing-billing-plan'],
    ]) {
      assert.equal(scalar(`SELECT count(*) FROM ${table} WHERE "id"='${id}';`), '1', `${table} fixture must survive upgrade`);
    }
  }
  sql(`INSERT INTO "public"."PlatformAdmin" ("id", "email", "updatedAt") VALUES ('arch038-admin', 'arch038-admin@example.test', now());`);
  // The existing billing catalogue enforces contiguous positions and 20 translations
  // through deferred constraint triggers. Build a valid plan fixture in one txn.
  sql(`BEGIN;
    INSERT INTO "billing"."MerchantPricingPlan" (
      "id", "shopifyPlanHandle", "displayName", "planKind", "cataloguePosition",
      "includedRecoveryCredits", "allowancePeriod", "billingPeriod", "recurringAmountMinor", "currency", "updatedAt"
    ) VALUES ('arch038-plan', 'arch038-plan', 'ARCH038 Test Growth', 'PAID_METERED',
      (SELECT count(*) FROM "billing"."MerchantPricingPlan"),
      0, 'EVERY_30_DAYS', 'EVERY_30_DAYS', 1000, 'GBP', now());
    INSERT INTO "billing"."MerchantPricingPlanTranslation"
      ("id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt")
    SELECT 'arch038-plan-' || locale, 'arch038-plan', locale, 'Architecture test plan', now()
    FROM unnest(ARRAY[
      'cs','da','de','en','es','fi','fr','it','ja','ko','nb','nl','pl',
      'pt-BR','pt-PT','sv','th','tr','zh-Hans','zh-Hant'
    ]) AS locale;
    COMMIT;`);
  assert.equal(Number(scalar(`SELECT count(*) FROM ${policy} WHERE "scope"='PLATFORM';`)), 10);
  assert.equal(Number(scalar(`SELECT count(*) FROM ${policy} WHERE "scope"='PLATFORM' AND "context"='PREVIEW';`)), 5);
  assert.equal(scalar(`SELECT "budget"::text FROM ${policy} WHERE "environment"='DEVELOPMENT' AND "context"='LIVE' AND "scope"='PLATFORM';`), '{"deadlineMs": 60000, "outputTokens": 800}');
  rejected(`DELETE FROM ${policy} WHERE "scope"='PLATFORM';`, 'mandatory Platform delete');
  rejected(insert('arch038-invalid', 'PREVIEW', 'PRICE_PLAN', 'missing-plan', null, { deadlineMs: 1000 }), 'Preview plan invalid');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, null, { deadlineMs: 1000 }), 'owner missing');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', {}), 'empty override');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: null }), 'null budget');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: -1 }), 'negative budget');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: 1.5 }), 'fractional budget');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { remoteCalls: 10 }), 'unrecognised field');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: 9007199254740992 }), 'unsafe integer');
  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'unknown-shop', { deadlineMs: 500 }), 'Shop FK');
  rejected(insert('arch038-invalid', 'LIVE', 'PRICE_PLAN', 'unknown-plan', null, { outputTokens: 500 }), 'Plan FK');
  rejected(`INSERT INTO ${policy}
    ("id", "environment", "context", "scope", "shopId", "budget", "budgetSchemaVersion", "updatedByAdminId")
    VALUES ('arch038-invalid', 'DEVELOPMENT', 'LIVE', 'SHOP', 'arch038-shop',
      '{"deadlineMs":500}', 2, 'arch038-admin');`, 'unsupported JSON schema version');

  rejected(insert('arch038-invalid', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: 500 }, null), 'missing Admin actor');
  // Sparse inheritance and independent contexts.
  sql(insert('arch038-live-plan', 'LIVE', 'PRICE_PLAN', 'arch038-plan', null, { deadlineMs: 90000 }));
  sql(insert('arch038-live-shop', 'LIVE', 'SHOP', null, 'arch038-shop', { outputTokens: 2000 }));
  sql(insert('arch038-preview-shop', 'PREVIEW', 'SHOP', null, 'arch038-shop', { deadlineMs: 90000 }));
  rejected(insert('arch038-duplicate', 'LIVE', 'SHOP', null, 'arch038-shop', { deadlineMs: 1000 }), 'duplicate owner');
  assert.equal(scalar(`SELECT (p."budget" || a."budget" || s."budget")::text FROM ${policy} p
    JOIN ${policy} a ON a."environment"=p."environment" AND a."context"='LIVE' AND a."scope"='PRICE_PLAN'
    JOIN ${policy} s ON s."environment"=p."environment" AND s."context"='LIVE' AND s."scope"='SHOP'
    WHERE p."environment"='DEVELOPMENT' AND p."context"='LIVE' AND p."scope"='PLATFORM'
      AND a."id"='arch038-live-plan' AND s."id"='arch038-live-shop';`),
    '{"deadlineMs": 90000, "outputTokens": 2000}');
  assert.equal(scalar(`SELECT (p."budget" || s."budget")::text FROM ${policy} p JOIN ${policy} s
    ON p."environment"=s."environment" AND p."context"=s."context"
    WHERE p."scope"='PLATFORM' AND s."scope"='SHOP' AND s."id"='arch038-live-shop';`),
  '{"deadlineMs": 60000, "outputTokens": 2000}');
  assert.equal(scalar(`SELECT "budget"::text FROM ${policy} WHERE "id"='arch038-preview-shop';`), '{"deadlineMs": 90000}');
  // CAS + audit are transactionally paired. A stale version cannot commit a newer budget.
  sql(`BEGIN;
    UPDATE ${policy} SET "budget"='{"outputTokens":1500}', "editVersion"=2,
      "updatedByAdminId"='arch038-admin', "updatedAt"=now()
      WHERE "id"='arch038-live-shop' AND "editVersion"=1;
    INSERT INTO "commerce"."CommerceAuditEvent"
      ("id", "actorAdminId", "action", "modelPolicyId", "environment", "reason", "metadata")
    VALUES ('arch038-audit-1','arch038-admin','SET_LIVE_SHOP_BUDGET_OVERRIDE',
      'arch038-live-shop','DEVELOPMENT','Testing versioned budget update',
      '{"context":"LIVE","scope":"SHOP","previousBudget":{"outputTokens":2000},"nextBudget":{"outputTokens":1500},"previousEditVersion":1,"nextEditVersion":2}');
    COMMIT;`);
  assert.equal(scalar(`SELECT "editVersion"::text FROM ${policy} WHERE "id"='arch038-live-shop';`), '2');
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."CommerceAuditEvent" WHERE "modelPolicyId"='arch038-live-shop';`), '1');
  assert.equal(scalar(`UPDATE ${policy} SET "budget"='{"outputTokens":400}', "editVersion"=3,
    "updatedByAdminId"='arch038-admin' WHERE "id"='arch038-live-shop' AND "editVersion"=1 RETURNING "id";`), '');
  rejected(`UPDATE ${policy} SET "budget"='{"outputTokens":400}' WHERE "id"='arch038-live-shop';`, 'unversioned update');
  // An invalid audit row aborts the corresponding policy mutation.
  rejected(`BEGIN;
    UPDATE ${policy} SET "budget"='{"outputTokens":1600}', "editVersion"=3,
      "updatedByAdminId"='arch038-admin' WHERE "id"='arch038-live-shop' AND "editVersion"=2;
    INSERT INTO "commerce"."CommerceAuditEvent"
      ("id", "actorAdminId", "action", "modelPolicyId", "environment", "reason", "metadata")
    VALUES ('arch038-audit-invalid', 'arch038-admin', 'SET_LIVE_SHOP_BUDGET_OVERRIDE',
      'arch038-live-shop', 'DEVELOPMENT', 'Rollback invalid audit', '{}');
    COMMIT;`, 'atomic policy/audit rollback');
  assert.equal(scalar(`SELECT "editVersion"::text FROM ${policy} WHERE "id"='arch038-live-shop';`), '2');
  // Removing an override leaves its immutable audit record intact.
  sql(`DELETE FROM ${policy} WHERE "id"='arch038-live-shop';`);
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."CommerceAuditEvent" WHERE "modelPolicyId"='arch038-live-shop';`), '1');
  assert.equal(scalar(`SELECT count(*) FROM ${policy} WHERE "id"='arch038-live-shop';`), '0');
  console.log(`PASS ARCH-038 database policy PostgreSQL ${mode}`);
}
try { await main(); } finally {
  if (running) { docker(['rm', '-f', '-v', container]); console.log(`CLEANUP ${container}`); }
}
