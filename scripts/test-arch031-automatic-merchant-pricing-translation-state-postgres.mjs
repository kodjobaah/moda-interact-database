import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
const targetMigration = "20261010093000_arch031_automatic_merchant_pricing_translation_state";
const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(["fresh", "upgrade"].includes(mode), "Pass an explicit --mode fresh|upgrade");

const databaseName = "arch031_pricing_translation_fixture";
const containerName = `moda-arch031-database001-${randomUUID()}`;
let containerStarted = false;

function docker(args, options = {}) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Docker command failed${detail ? `: ${detail}` : ""}`, { cause: error });
  }
}

function psql(sql, { capture = false } = {}) {
  return docker(
    [
      "exec", "-i", containerName, "psql", "-X", "-q",
      ...(capture ? ["-A", "-t"] : []),
      "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName,
    ],
    { input: sql },
  );
}

function jsonQuery(sql) {
  return JSON.parse(psql(sql, { capture: true }).trim());
}

function expectRejected(label, statement, expectedSqlState) {
  psql(`DO $arch031_assertion$
DECLARE caught_state text;
BEGIN
  BEGIN
    ${statement.trim().replace(/;+$/, "")};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state <> '${expectedSqlState}' THEN RAISE; END IF;
  END;
  IF caught_state IS NULL THEN
    RAISE EXCEPTION 'Expected SQLSTATE ${expectedSqlState}: ${label}';
  END IF;
END;
$arch031_assertion$;`);
  console.log(`PASS ${label} (SQLSTATE ${expectedSqlState})`);
}

async function awaitPostgres() {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      execFileSync(
        "docker",
        ["exec", containerName, "psql", "-X", "-q", "-U", "postgres", "-d", databaseName, "-c", "SELECT 1"],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await delay(1000);
    }
  }
  throw new Error("Invocation-owned PostgreSQL container did not become ready");
}

function migrationNames() {
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d{14}_.+$/.test(name))
    .sort();
}

function applyMigration(name) {
  psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
  console.log(`APPLIED ${name}`);
}

function seedAdminCredentialAndModels({ beforeTarget }) {
  psql(`
INSERT INTO public."PlatformAdmin" (
  "id", "email", "displayName", "role", "active", "updatedAt"
) VALUES (
  'arch031-admin', 'arch031-admin@example.invalid', 'ARCH-031 fixture', 'SUPER_ADMIN', true, CURRENT_TIMESTAMP
);

INSERT INTO commerce."CommerceTranslationProviderCredential" (
  "id", "environment", "provider", "ciphertext", "nonce", "authTag", "keyId", "editVersion", "updatedByAdminId", "updatedAt"
) VALUES
  ('arch031-credential-dev', 'DEVELOPMENT', 'openai', decode('01', 'hex'), decode(repeat('02', 12), 'hex'), decode(repeat('03', 16), 'hex'), 'fixture-key', 1, 'arch031-admin', CURRENT_TIMESTAMP),
  ('arch031-credential-test', 'TEST', 'openai', decode('04', 'hex'), decode(repeat('05', 12), 'hex'), decode(repeat('06', 16), 'hex'), 'fixture-key', 1, 'arch031-admin', CURRENT_TIMESTAMP);

INSERT INTO commerce."CommerceTranslationModelConfiguration" (
  "id", "environment", "provider", "providerModelId", "displayName", "enabled", "editVersion",
  "createdByAdminId", "updatedByAdminId", "updatedAt"
) VALUES
  ('arch031-model-dev-a', 'DEVELOPMENT', 'openai', 'fixture-model-a', 'Fixture model A', true, 1, 'arch031-admin', 'arch031-admin', CURRENT_TIMESTAMP),
  ('arch031-model-dev-b', 'DEVELOPMENT', 'openai', 'fixture-model-b', 'Fixture model B', true, 1, 'arch031-admin', 'arch031-admin', CURRENT_TIMESTAMP),
  ('arch031-model-test-a', 'TEST', 'openai', 'fixture-model-test', 'Fixture model test', true, 1, 'arch031-admin', 'arch031-admin', CURRENT_TIMESTAMP);
`);
  console.log(`SEEDED translation configuration ${beforeTarget ? "before" : "after"} ARCH-031 migration`);
}

function assertCatalogObjects() {
  const objects = jsonQuery(`SELECT jsonb_build_object(
    'automaticDefaultColumn', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='commerce' AND table_name='CommerceTranslationModelConfiguration' AND column_name='automaticDefault'
    ),
    'runTable', to_regclass('billing."MerchantPricingTranslationRun"') IS NOT NULL,
    'itemTable', to_regclass('billing."MerchantPricingTranslationItem"') IS NOT NULL,
    'batchTable', to_regclass('billing."MerchantPricingTranslationBatch"') IS NOT NULL,
    'batchItemTable', to_regclass('billing."MerchantPricingTranslationBatchItem"') IS NOT NULL,
    'runEnum', to_regtype('billing."MerchantPricingTranslationRunStatus"') IS NOT NULL,
    'itemEnum', to_regtype('billing."MerchantPricingTranslationItemStatus"') IS NOT NULL,
    'batchEnum', to_regtype('billing."MerchantPricingTranslationBatchStatus"') IS NOT NULL,
    'activeRunUnique', EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='billing' AND indexname='MerchantPricingTranslationRun_active_handle_source_key'
    ),
    'defaultUnique', EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='commerce' AND indexname='CommerceTranslationModelConfiguration_one_automatic_default'
    ),
    'arch014PlanTrigger', EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='billing' AND c.relname='MerchantPricingPlan' AND t.tgname='trg_arch014_merchant_pricing_plan_validate' AND NOT t.tgisinternal
    ),
    'arch014HighlightTrigger', EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='billing' AND c.relname='MerchantPricingPlanHighlight' AND t.tgname='trg_arch014_plan_highlight_validate' AND NOT t.tgisinternal
    )
  )::text;`);
  assert.deepEqual(objects, {
    automaticDefaultColumn: true,
    runTable: true,
    itemTable: true,
    batchTable: true,
    batchItemTable: true,
    runEnum: true,
    itemEnum: true,
    batchEnum: true,
    activeRunUnique: true,
    defaultUnique: true,
    arch014PlanTrigger: true,
    arch014HighlightTrigger: true,
  });
  console.log("PASS PostgreSQL catalogue contains ARCH-031 state while ARCH-014 triggers remain present");
}

function assertUpgradeDefaults() {
  const rows = jsonQuery(`SELECT jsonb_agg(jsonb_build_object(
      'id', "id", 'automaticDefault', "automaticDefault"
    ) ORDER BY "id")::text
    FROM commerce."CommerceTranslationModelConfiguration"
    WHERE "id" LIKE 'arch031-model-%';`);
  assert.deepEqual(rows, [
    { id: "arch031-model-dev-a", automaticDefault: false },
    { id: "arch031-model-dev-b", automaticDefault: false },
    { id: "arch031-model-test-a", automaticDefault: false },
  ]);
  console.log("PASS upgrade preserves existing model rows and does not infer an automatic default");
}

function assertAutomaticDefaultRules() {
  psql(`UPDATE commerce."CommerceTranslationModelConfiguration"
    SET "automaticDefault"=true WHERE "id"='arch031-model-dev-a';`);
  expectRejected(
    "second automatic default for same environment/provider rejected",
    `UPDATE commerce."CommerceTranslationModelConfiguration" SET "automaticDefault"=true WHERE "id"='arch031-model-dev-b'`,
    "23505",
  );
  expectRejected(
    "automatic default cannot be disabled",
    `UPDATE commerce."CommerceTranslationModelConfiguration" SET "enabled"=false WHERE "id"='arch031-model-dev-a'`,
    "23514",
  );
  psql(`UPDATE commerce."CommerceTranslationModelConfiguration"
    SET "automaticDefault"=true WHERE "id"='arch031-model-test-a';`);
  const defaults = jsonQuery(`SELECT jsonb_agg(jsonb_build_object(
      'environment', "environment", 'id', "id"
    ) ORDER BY "environment"::text)::text
    FROM commerce."CommerceTranslationModelConfiguration"
    WHERE "automaticDefault"=true;`);
  assert.deepEqual(defaults, [
    { environment: "DEVELOPMENT", id: "arch031-model-dev-a" },
    { environment: "TEST", id: "arch031-model-test-a" },
  ]);
  console.log("PASS automatic defaults are unique per environment/provider and independent across environments");
}

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function insertRun({ id, hash = hashA, status = "PENDING" }) {
  return `INSERT INTO billing."MerchantPricingTranslationRun" (
    "id", "shopifyPlanHandle", "environment", "translationModelConfigurationId",
    "provider", "providerModelId", "modelConfigurationVersion", "sourceSchemaVersion",
    "sourceHash", "sourceSnapshot", "status", "requestedByAdminId", "updatedAt"
  ) VALUES (
    '${id}', 'free', 'DEVELOPMENT', 'arch031-model-dev-a',
    'openai', 'fixture-model-a', 1, 1,
    '${hash}', '{"description":"Free plan","highlights":[]}'::jsonb,
    '${status}', 'arch031-admin', CURRENT_TIMESTAMP
  );`;
}

function assertRunRules() {
  psql(insertRun({ id: "arch031-run-a" }));
  assert.equal(
    jsonQuery(`SELECT jsonb_build_object(
      'runs', count(*)::int,
      'plans', (SELECT count(*)::int FROM billing."MerchantPricingPlan")
    )::text FROM billing."MerchantPricingTranslationRun" WHERE "id"='arch031-run-a';`).plans,
    0,
    "translation staging must not require a MerchantPricingPlan row",
  );
  expectRejected(
    "duplicate active handle/source hash rejected",
    insertRun({ id: "arch031-run-a-duplicate" }),
    "23505",
  );
  psql(`UPDATE billing."MerchantPricingTranslationRun"
    SET "status"='FAILED', "completedAt"=CURRENT_TIMESTAMP WHERE "id"='arch031-run-a';`);
  psql(insertRun({ id: "arch031-run-a-retry" }));
  psql(insertRun({ id: "arch031-run-b", hash: hashB }));
  assert.equal(
    jsonQuery(`SELECT count(*)::int::text FROM billing."MerchantPricingTranslationRun" WHERE "shopifyPlanHandle"='free';`),
    3,
  );
  expectRejected(
    "malformed source hash rejected",
    insertRun({ id: "arch031-run-bad-hash", hash: "BAD" }),
    "23514",
  );
  console.log("PASS run staging supports retries/source changes while preventing duplicate active work");
}

function assertItemAndBatchRules() {
  psql(`INSERT INTO billing."MerchantPricingTranslationItem" (
    "id", "runId", "sourceEntityKind", "sourceContentKey", "sourceField",
    "sourceLanguageTag", "targetLanguageTag", "sourceText", "translatedText", "status", "updatedAt"
  ) VALUES (
    'arch031-item-plan-en', 'arch031-run-a-retry', 'PLAN', NULL, 'DESCRIPTION',
    'en', 'en', 'Free plan', 'Free plan', 'AVAILABLE', CURRENT_TIMESTAMP
  );`);
  expectRejected(
    "duplicate plan field/locale item rejected",
    `INSERT INTO billing."MerchantPricingTranslationItem" (
      "id","runId","sourceEntityKind","sourceField","sourceLanguageTag","targetLanguageTag","sourceText","status","updatedAt"
    ) VALUES ('arch031-item-plan-en-dup','arch031-run-a-retry','PLAN','DESCRIPTION','en','en','Free plan','PENDING',CURRENT_TIMESTAMP)`,
    "23505",
  );
  expectRejected(
    "plan title item rejected",
    `INSERT INTO billing."MerchantPricingTranslationItem" (
      "id","runId","sourceEntityKind","sourceField","sourceLanguageTag","targetLanguageTag","sourceText","status","updatedAt"
    ) VALUES ('arch031-item-plan-title','arch031-run-a-retry','PLAN','TITLE','en','fr','Free','PENDING',CURRENT_TIMESTAMP)`,
    "23514",
  );
  expectRejected(
    "highlight item requires stable content key",
    `INSERT INTO billing."MerchantPricingTranslationItem" (
      "id","runId","sourceEntityKind","sourceField","sourceLanguageTag","targetLanguageTag","sourceText","status","updatedAt"
    ) VALUES ('arch031-item-highlight-no-key','arch031-run-a-retry','HIGHLIGHT','TITLE','en','fr','Fast recovery','PENDING',CURRENT_TIMESTAMP)`,
    "23514",
  );
  expectRejected(
    "available item requires translated text",
    `INSERT INTO billing."MerchantPricingTranslationItem" (
      "id","runId","sourceEntityKind","sourceField","sourceLanguageTag","targetLanguageTag","sourceText","translatedText","status","updatedAt"
    ) VALUES ('arch031-item-empty-available','arch031-run-a-retry','PLAN','DESCRIPTION','en','fr','Free plan','   ','AVAILABLE',CURRENT_TIMESTAMP)`,
    "23514",
  );
  expectRejected(
    "negative retry count rejected",
    `INSERT INTO billing."MerchantPricingTranslationItem" (
      "id","runId","sourceEntityKind","sourceField","sourceLanguageTag","targetLanguageTag","sourceText","status","retryCount","updatedAt"
    ) VALUES ('arch031-item-negative-retry','arch031-run-a-retry','PLAN','DESCRIPTION','en','de','Free plan','PENDING',-1,CURRENT_TIMESTAMP)`,
    "23514",
  );

  psql(`INSERT INTO billing."MerchantPricingTranslationItem" (
    "id", "runId", "sourceEntityKind", "sourceContentKey", "sourceField",
    "sourceLanguageTag", "targetLanguageTag", "sourceText", "status", "updatedAt"
  ) VALUES
    ('arch031-item-highlight-title-fr', 'arch031-run-a-retry', 'HIGHLIGHT', '11111111-1111-4111-8111-111111111111', 'TITLE', 'en', 'fr', 'Fast recovery', 'PENDING', CURRENT_TIMESTAMP),
    ('arch031-item-highlight-description-fr', 'arch031-run-a-retry', 'HIGHLIGHT', '11111111-1111-4111-8111-111111111111', 'DESCRIPTION', 'en', 'fr', 'Recover abandoned checkouts', 'PENDING', CURRENT_TIMESTAMP);`);

  psql(`INSERT INTO billing."MerchantPricingTranslationBatch" (
    "id", "runId", "provider", "model", "status", "providerBatchId", "updatedAt"
  ) VALUES
    ('arch031-batch-1', 'arch031-run-a-retry', 'openai', 'fixture-model-a', 'SUBMITTED', 'batch-fixture-1', CURRENT_TIMESTAMP),
    ('arch031-batch-2', 'arch031-run-a-retry', 'openai', 'fixture-model-a', 'READY', NULL, CURRENT_TIMESTAMP);`);
  expectRejected(
    "provider batch identity is unique",
    `INSERT INTO billing."MerchantPricingTranslationBatch" (
      "id","runId","provider","model","status","providerBatchId","updatedAt"
    ) VALUES ('arch031-batch-dup','arch031-run-a-retry','openai','fixture-model-a','SUBMITTED','batch-fixture-1',CURRENT_TIMESTAMP)`,
    "23505",
  );
  expectRejected(
    "negative submit attempt count rejected",
    `INSERT INTO billing."MerchantPricingTranslationBatch" (
      "id","runId","provider","model","status","submitAttemptCount","updatedAt"
    ) VALUES ('arch031-batch-negative-submit','arch031-run-a-retry','openai','fixture-model-a','READY',-1,CURRENT_TIMESTAMP)`,
    "23514",
  );
  expectRejected(
    "negative poll sequence rejected",
    `INSERT INTO billing."MerchantPricingTranslationBatch" (
      "id","runId","provider","model","status","pollSequence","updatedAt"
    ) VALUES ('arch031-batch-negative-poll','arch031-run-a-retry','openai','fixture-model-a','READY',-1,CURRENT_TIMESTAMP)`,
    "23514",
  );

  psql(`UPDATE billing."MerchantPricingTranslationItem"
    SET "currentBatchId"='arch031-batch-1'
    WHERE "id"='arch031-item-highlight-title-fr';
  INSERT INTO billing."MerchantPricingTranslationBatchItem" (
    "id", "batchId", "translationItemId", "providerCustomId"
  ) VALUES (
    'arch031-membership-1', 'arch031-batch-1', 'arch031-item-highlight-title-fr', 'arch031-custom-1'
  );
  UPDATE billing."MerchantPricingTranslationItem"
    SET "currentBatchId"='arch031-batch-2'
    WHERE "id"='arch031-item-highlight-title-fr';
  INSERT INTO billing."MerchantPricingTranslationBatchItem" (
    "id", "batchId", "translationItemId", "providerCustomId"
  ) VALUES (
    'arch031-membership-2', 'arch031-batch-2', 'arch031-item-highlight-title-fr', 'arch031-custom-2'
  );`);

  const membership = jsonQuery(`SELECT jsonb_build_object(
    'currentBatchId', item."currentBatchId",
    'historyCount', (SELECT count(*)::int FROM billing."MerchantPricingTranslationBatchItem" membership WHERE membership."translationItemId"=item."id")
  )::text FROM billing."MerchantPricingTranslationItem" item WHERE item."id"='arch031-item-highlight-title-fr';`);
  assert.deepEqual(membership, { currentBatchId: "arch031-batch-2", historyCount: 2 });
  console.log("PASS item identity/current Batch and immutable Batch membership support retry history");
}

async function main() {
  try {
    docker([
      "run", "--detach", "--name", containerName, "--network", "none",
      "--env", "POSTGRES_PASSWORD=fixture-only",
      "--env", `POSTGRES_DB=${databaseName}`,
      "pgvector/pgvector:pg17",
    ]);
    containerStarted = true;
    await awaitPostgres();
    console.log(`ISOLATION container=${containerName} image=pgvector/pgvector:pg17 network=none mode=${mode}`);

    const names = migrationNames();
    assert.ok(names.includes(targetMigration), "ARCH-031 automatic Merchant Pricing translation migration must remain present");
    for (const name of names) {
      if (name === targetMigration) break;
      applyMigration(name);
    }

    if (mode === "upgrade") seedAdminCredentialAndModels({ beforeTarget: true });
    applyMigration(targetMigration);
    if (mode === "fresh") seedAdminCredentialAndModels({ beforeTarget: false });

    assertCatalogObjects();
    if (mode === "upgrade") assertUpgradeDefaults();
    assertAutomaticDefaultRules();
    assertRunRules();
    assertItemAndBatchRules();

    console.log(`ARCH-031 automatic Merchant Pricing translation ${mode} PostgreSQL rehearsal passed.`);
  } finally {
    if (containerStarted) {
      docker(["rm", "--force", containerName]);
      console.log(`CLEANUP removed invocation-owned container ${containerName}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
