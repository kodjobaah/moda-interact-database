import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
const targetMigration = "20261010170000_arch031_merchant_pricing_publication_lifecycle";
const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(["fresh", "upgrade"].includes(mode), "Pass an explicit --mode fresh|upgrade");

const databaseName = "arch031_pricing_publication_fixture";
const containerName = `moda-arch031-database002-${randomUUID()}`;
let containerStarted = false;

const locales = [
  "cs", "da", "de", "en", "es", "fi", "fr", "it", "ja", "ko",
  "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "zh-Hans", "zh-Hant",
];
const nonEnglishLocales = locales.filter((locale) => locale !== "en");

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

function seedCompletePlanBeforeTarget() {
  const translationValues = locales
    .map((locale, index) => `('arch031-existing-${index}','arch031-existing-plan','${locale}','Existing ${locale}',CURRENT_TIMESTAMP)`)
    .join(",\n");
  psql(`BEGIN;
INSERT INTO billing."MerchantPricingPlan" (
  "id", "shopifyPlanHandle", "displayName", "planKind", "isActive", "cataloguePosition",
  "includedRecoveryCredits", "allowancePeriod", "billingPeriod", "recurringAmountMinor", "currency", "updatedAt"
) VALUES (
  'arch031-existing-plan', 'arch031-existing', 'Existing complete plan', 'PAID_METERED', true, 0,
  20, 'EVERY_30_DAYS', 'EVERY_30_DAYS', 1000, 'USD', CURRENT_TIMESTAMP
);
INSERT INTO billing."MerchantPricingPlanTranslation" (
  "id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt"
) VALUES ${translationValues};
COMMIT;`);
  console.log("SEEDED complete pre-ARCH-031 Merchant Pricing plan");
}

function seedTranslationConfiguration() {
  psql(`
INSERT INTO public."PlatformAdmin" (
  "id", "email", "displayName", "role", "active", "updatedAt"
) VALUES (
  'arch031-pub-admin', 'arch031-pub-admin@example.invalid', 'ARCH-031 publication fixture', 'SUPER_ADMIN', true, CURRENT_TIMESTAMP
);

INSERT INTO commerce."CommerceTranslationProviderCredential" (
  "id", "environment", "provider", "ciphertext", "nonce", "authTag", "keyId", "editVersion", "updatedByAdminId", "updatedAt"
) VALUES (
  'arch031-pub-credential', 'DEVELOPMENT', 'openai', decode('01','hex'), decode(repeat('02',12),'hex'), decode(repeat('03',16),'hex'),
  'fixture-key', 1, 'arch031-pub-admin', CURRENT_TIMESTAMP
);

INSERT INTO commerce."CommerceTranslationModelConfiguration" (
  "id", "environment", "provider", "providerModelId", "displayName", "enabled", "automaticDefault", "editVersion",
  "createdByAdminId", "updatedByAdminId", "updatedAt"
) VALUES (
  'arch031-pub-model', 'DEVELOPMENT', 'openai', 'fixture-model', 'Fixture automatic model', true, true, 1,
  'arch031-pub-admin', 'arch031-pub-admin', CURRENT_TIMESTAMP
);`);
}

function insertRun({ id, handle, hashChar = "a", status = "PENDING" }) {
  return `INSERT INTO billing."MerchantPricingTranslationRun" (
    "id", "shopifyPlanHandle", "environment", "translationModelConfigurationId", "provider", "providerModelId",
    "modelConfigurationVersion", "sourceSchemaVersion", "sourceHash", "sourceSnapshot", "status", "requestedByAdminId", "updatedAt"
  ) VALUES (
    '${id}', '${handle}', 'DEVELOPMENT', 'arch031-pub-model', 'openai', 'fixture-model', 1, 1,
    '${hashChar.repeat(64)}', '{"description":"Draft content","highlights":[]}'::jsonb, '${status}', 'arch031-pub-admin', CURRENT_TIMESTAMP
  );`;
}

function draftPlanInsert({ id, handle, runId, position, status = "TRANSLATING", active = false }) {
  return `INSERT INTO billing."MerchantPricingPlan" (
    "id", "shopifyPlanHandle", "displayName", "planKind", "isActive", "cataloguePosition", "includedRecoveryCredits",
    "allowancePeriod", "billingPeriod", "recurringAmountMinor", "currency", "publicationStatus", "currentTranslationRunId", "updatedAt"
  ) VALUES (
    '${id}', '${handle}', 'Draft ${handle}', 'PAID_METERED', ${active}, ${position}, 6,
    'EVERY_30_DAYS', 'EVERY_30_DAYS', 500, 'USD', '${status}', ${runId ? `'${runId}'` : "NULL"}, CURRENT_TIMESTAMP
  );`;
}

function insertEnglishPlanTranslation(planId, id = `${planId}-en`) {
  return `INSERT INTO billing."MerchantPricingPlanTranslation" (
    "id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt"
  ) VALUES ('${id}', '${planId}', 'en', 'English draft description', CURRENT_TIMESTAMP);`;
}

function assertSchemaObjects() {
  const objects = jsonQuery(`SELECT jsonb_build_object(
    'publicationColumn', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='billing' AND table_name='MerchantPricingPlan' AND column_name='publicationStatus'
    ),
    'currentRunColumn', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='billing' AND table_name='MerchantPricingPlan' AND column_name='currentTranslationRunId'
    ),
    'publicationEnum', to_regtype('billing."MerchantPricingPlanPublicationStatus"') IS NOT NULL,
    'currentRunForeignKey', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='billing."MerchantPricingPlan"'::regclass AND conname='MerchantPricingPlan_current_translation_run_fkey'
    ),
    'activationCheck', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='billing."MerchantPricingPlan"'::regclass AND conname='ck_arch031_merchant_pricing_publication_activation'
    ),
    'runCheck', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid='billing."MerchantPricingPlan"'::regclass AND conname='ck_arch031_merchant_pricing_publication_run'
    )
  )::text;`);
  assert.deepEqual(objects, {
    publicationColumn: true,
    currentRunColumn: true,
    publicationEnum: true,
    currentRunForeignKey: true,
    activationCheck: true,
    runCheck: true,
  });
  console.log("PASS Merchant Pricing publication lifecycle schema objects exist");
}

function assertUpgradeConvergence() {
  const existing = jsonQuery(`SELECT jsonb_build_object(
    'publicationStatus', "publicationStatus",
    'currentTranslationRunId', "currentTranslationRunId",
    'isActive', "isActive",
    'translations', (SELECT count(*)::int FROM billing."MerchantPricingPlanTranslation" t WHERE t."merchantPricingPlanId"=plan."id")
  )::text FROM billing."MerchantPricingPlan" plan WHERE "id"='arch031-existing-plan';`);
  assert.deepEqual(existing, {
    publicationStatus: "READY",
    currentTranslationRunId: null,
    isActive: true,
    translations: 20,
  });
  console.log("PASS existing complete plans converge to READY without rewrite or deactivation");
}

function assertDraftLifecycle() {
  const basePosition = mode === "upgrade" ? 1 : 0;
  psql(insertRun({ id: "arch031-draft-run", handle: "arch031-draft" }));
  psql(`BEGIN;
${draftPlanInsert({ id: "arch031-draft-plan", handle: "arch031-draft", runId: "arch031-draft-run", position: basePosition })}
${insertEnglishPlanTranslation("arch031-draft-plan")}
INSERT INTO billing."MerchantPricingPlanHighlight" (
  "id", "merchantPricingPlanId", "contentKey", "position", "updatedAt"
) VALUES (
  'arch031-draft-highlight', 'arch031-draft-plan', '11111111-1111-4111-8111-111111111111', 0, CURRENT_TIMESTAMP
);
INSERT INTO billing."MerchantPricingPlanHighlightTranslation" (
  "id", "merchantPricingPlanHighlightId", "locale", "merchantTitle", "merchantDescription", "updatedAt"
) VALUES (
  'arch031-draft-highlight-en', 'arch031-draft-highlight', 'en', 'English title', 'English highlight description', CURRENT_TIMESTAMP
);
COMMIT;`);

  const draft = jsonQuery(`SELECT jsonb_build_object(
    'status', plan."publicationStatus",
    'active', plan."isActive",
    'runId', plan."currentTranslationRunId",
    'planTranslations', (SELECT count(*)::int FROM billing."MerchantPricingPlanTranslation" t WHERE t."merchantPricingPlanId"=plan."id"),
    'highlightTranslations', (SELECT count(*)::int FROM billing."MerchantPricingPlanHighlightTranslation" t WHERE t."merchantPricingPlanHighlightId"='arch031-draft-highlight')
  )::text FROM billing."MerchantPricingPlan" plan WHERE plan."id"='arch031-draft-plan';`);
  assert.deepEqual(draft, {
    status: "TRANSLATING",
    active: false,
    runId: "arch031-draft-run",
    planTranslations: 1,
    highlightTranslations: 1,
  });
  console.log("PASS TRANSLATING plans persist in the catalogue with English-only plan/highlight content");

  expectRejected(
    "non-ready plan cannot be active",
    `${insertRun({ id: "arch031-active-run", handle: "arch031-active", hashChar: "b" })}
     ${draftPlanInsert({ id: "arch031-active-plan", handle: "arch031-active", runId: "arch031-active-run", position: basePosition + 1, active: true })}`,
    "23514",
  );

  expectRejected(
    "non-ready plan requires durable translation run",
    draftPlanInsert({ id: "arch031-no-run-plan", handle: "arch031-no-run", runId: null, position: basePosition + 1 }),
    "23514",
  );

  psql(insertRun({ id: "arch031-wrong-run", handle: "different-handle", hashChar: "c" }));
  expectRejected(
    "plan current translation run must use the exact Shopify handle",
    `${draftPlanInsert({ id: "arch031-wrong-run-plan", handle: "arch031-wrong", runId: "arch031-wrong-run", position: basePosition + 1 })}
     ${insertEnglishPlanTranslation("arch031-wrong-run-plan")}
     SET CONSTRAINTS ALL IMMEDIATE`,
    "P0001",
  );

  expectRejected(
    "draft plan rejects non-English translation rows",
    `INSERT INTO billing."MerchantPricingPlanTranslation" (
       "id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt"
     ) VALUES ('arch031-draft-fr','arch031-draft-plan','fr','French draft',CURRENT_TIMESTAMP);
     SET CONSTRAINTS ALL IMMEDIATE`,
    "P0001",
  );
}

function assertReadyPromotion() {
  const planValues = nonEnglishLocales
    .map((locale, index) => `('arch031-final-plan-${index}','arch031-draft-plan','${locale}','Translated ${locale}',CURRENT_TIMESTAMP)`)
    .join(",\n");
  const highlightValues = nonEnglishLocales
    .map((locale, index) => `('arch031-final-highlight-${index}','arch031-draft-highlight','${locale}','Title ${locale}','Description ${locale}',CURRENT_TIMESTAMP)`)
    .join(",\n");

  psql(`BEGIN;
UPDATE billing."MerchantPricingTranslationRun"
SET "status"='READY_TO_APPLY', "readyToApplyAt"=CURRENT_TIMESTAMP
WHERE "id"='arch031-draft-run';
INSERT INTO billing."MerchantPricingPlanTranslation" (
  "id", "merchantPricingPlanId", "locale", "merchantDescription", "updatedAt"
) VALUES ${planValues};
INSERT INTO billing."MerchantPricingPlanHighlightTranslation" (
  "id", "merchantPricingPlanHighlightId", "locale", "merchantTitle", "merchantDescription", "updatedAt"
) VALUES ${highlightValues};
UPDATE billing."MerchantPricingPlan"
SET "publicationStatus"='READY', "isActive"=false, "updatedAt"=CURRENT_TIMESTAMP
WHERE "id"='arch031-draft-plan';
UPDATE billing."MerchantPricingTranslationRun"
SET "status"='APPLIED', "appliedAt"=CURRENT_TIMESTAMP, "completedAt"=CURRENT_TIMESTAMP,
    "appliedMerchantPricingPlanId"='arch031-draft-plan'
WHERE "id"='arch031-draft-run';
COMMIT;`);

  const ready = jsonQuery(`SELECT jsonb_build_object(
    'status', plan."publicationStatus",
    'active', plan."isActive",
    'planTranslations', (SELECT count(*)::int FROM billing."MerchantPricingPlanTranslation" t WHERE t."merchantPricingPlanId"=plan."id"),
    'highlightTranslations', (SELECT count(*)::int FROM billing."MerchantPricingPlanHighlightTranslation" t WHERE t."merchantPricingPlanHighlightId"='arch031-draft-highlight')
  )::text FROM billing."MerchantPricingPlan" plan WHERE plan."id"='arch031-draft-plan';`);
  assert.deepEqual(ready, {
    status: "READY",
    active: false,
    planTranslations: 20,
    highlightTranslations: 20,
  });
  console.log("PASS completed translations promote the same persisted plan to READY while leaving it inactive");

  psql(`UPDATE billing."MerchantPricingPlan" SET "isActive"=true WHERE "id"='arch031-draft-plan';`);
  assert.equal(
    jsonQuery(`SELECT "isActive"::text FROM billing."MerchantPricingPlan" WHERE "id"='arch031-draft-plan';`),
    true,
  );
  console.log("PASS READY plan may be activated explicitly after translation completion");
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
    assert.equal(names.at(-1), targetMigration, "publication lifecycle migration must be the latest ordered migration");
    for (const name of names) {
      if (name === targetMigration) break;
      applyMigration(name);
    }

    if (mode === "upgrade") seedCompletePlanBeforeTarget();
    applyMigration(targetMigration);
    assertSchemaObjects();
    if (mode === "upgrade") assertUpgradeConvergence();

    seedTranslationConfiguration();
    assertDraftLifecycle();
    assertReadyPromotion();

    console.log(`ARCH-031 Merchant Pricing publication lifecycle ${mode} PostgreSQL rehearsal passed.`);
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
