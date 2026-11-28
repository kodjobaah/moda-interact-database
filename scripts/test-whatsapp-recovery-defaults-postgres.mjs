import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Never read DATABASE_URL or connect to an existing PostgreSQL server.
const args = process.argv.slice(2);
assert.ok(
  args.length === 2 &&
    args[0] === "--mode" &&
    ["fresh", "upgrade"].includes(args[1]),
  "Usage: --mode fresh|upgrade",
);
const mode = args[1];
const migration = "20261124163000_whatsapp_recovery_template_defaults";
const directory = new URL("../prisma/migrations/", import.meta.url);
const container = `moda-recovery-defaults-${randomUUID()}`;
const database = "recovery_defaults_fixture";
const defaults = 'whatsapp."WhatsAppRecoveryTemplateDefault"';
const definition = 'whatsapp."WhatsAppTemplateDefinition"';
const locale = 'whatsapp."WhatsAppTemplateLocale"';
const registration = 'whatsapp."WhatsAppTemplateMetaRegistration"';
const variant = 'whatsapp."WhatsAppTemplateVariant"';
const operation = 'whatsapp."WhatsAppTemplatePublicationOperation"';
const target = 'whatsapp."WhatsAppTemplatePublicationTarget"';
const shop = 'commerce."Shop"';
const admin = 'public."PlatformAdmin"';
const purposes = [
  "INITIAL_NO_OFFER",
  "INITIAL_CODE_OFFER",
  "INITIAL_AUTOMATIC_OFFER",
  "FOLLOW_UP_NO_OFFER",
  "FOLLOW_UP_CODE_OFFER",
  "FOLLOW_UP_AUTOMATIC_OFFER",
];
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const val = (value) =>
  value === null
    ? "NULL"
    : typeof value === "boolean" || typeof value === "number"
      ? String(value)
      : typeof value === "object"
        ? `${q(JSON.stringify(value))}::jsonb`
        : q(value);
const insert = (table, data) => `INSERT INTO ${table} (${Object.keys(data)
  .map((k) => `"${k}"`)
  .join(",")})
  VALUES (${Object.values(data).map(val).join(",")});`;
const docker = (command, options = {}) =>
  execFileSync("docker", command, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
const sql = (statement) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
    ],
    { input: statement },
  ).trim();
const count = (table) => Number(sql(`SELECT count(*) FROM ${table};`));
function expectState(statement, state) {
  // Catch only the attempted write in a subtransaction; no invalid row survives.
  sql(`DO $test$ DECLARE actual text; BEGIN
    BEGIN ${statement.replace(/;\s*$/, "")};
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
    END;
    IF actual IS DISTINCT FROM ${q(state)} THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, received %', ${q(state)}, actual;
    END IF;
  END $test$;`);
}
function apply(name) {
  sql(readFileSync(new URL(`${name}/migration.sql`, directory), "utf8"));
  console.log(`APPLIED ${name}`);
}
async function ready() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      docker(
        ["exec", container, "pg_isready", "-U", "postgres", "-d", database],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error("Disposable PostgreSQL failed to start");
}
const stamp = "2026-11-23T00:00:00Z";
const hash = "a".repeat(64);
function seedCatalogue() {
  const rows = [
    insert(admin, {
      id: "author",
      email: "author@example.invalid",
      role: "SUPER_ADMIN",
      updatedAt: stamp,
    }),
    insert(admin, {
      id: "selector",
      email: "selector@example.invalid",
      role: "SUPER_ADMIN",
      updatedAt: stamp,
    }),
  ];
  for (const [id, purpose] of [
    ...purposes.map((p) => [p, p]),
    ["replacement", purposes[0]],
    ["unreferenced", purposes[0]],
  ]) {
    const [stage, offer] = purpose.startsWith("FOLLOW_UP_")
      ? ["FOLLOW_UP", purpose.slice("FOLLOW_UP_".length)]
      : ["INITIAL", purpose.slice("INITIAL_".length)];
    rows.push(
      insert(definition, {
        id,
        kind: "META_RECOVERY",
        purpose: stage,
        offerType: offer,
        providerTemplateName: `fixture_${id.toLowerCase()}`,
        category: "MARKETING",
        sourceLanguageTag: "en",
        astSchemaVersion: 1,
        sourceHash: hash,
        status: "PUBLISHED",
        publishedAt: stamp,
        createdByAdminId: "author",
      }),
    );
  }
  // Two languages suffice for storage testing; application approval of the full
  // 20-language cohort is intentionally not implemented in the DB migration.
  for (const language of ["en", "fr"]) {
    const id = `${purposes[0]}-${language}`;
    const name = `fixture_${purposes[0].toLowerCase()}`;
    rows.push(
      insert(locale, {
        id,
        definitionId: purposes[0],
        languageTag: language,
        providerLanguageCode: language,
        localeAst: { body: ["Fixture"] },
        contentHash: hash,
        status: "REVIEWED",
        reviewedByAdminId: "author",
        reviewedAt: stamp,
      }),
    );
    rows.push(
      insert(registration, {
        id,
        localeId: id,
        wabaId: "waba-a",
        providerTemplateName: name,
        providerLanguageCode: language,
        category: "MARKETING",
        componentsSnapshot: [],
        parameterBindingsSnapshot: {},
        submittedContentHash: hash,
        providerTemplateId: `meta-${language}`,
        submissionState: "APPROVED",
        providerStatus: "APPROVED",
        lastReconciledAt: stamp,
      }),
    );
  }
  sql(`BEGIN; ${rows.join("\n")} COMMIT;`);
}
function seedMerchant() {
  const id = `${purposes[0]}-fr`;
  sql(`BEGIN;
    ${insert(shop, {
      id: "shop-a",
      domain: "recovery-defaults.example.invalid",
      platform: "SHOPIFY",
      onboardingCompleted: true,
      storeLocale: "fr",
      defaultLanguageTag: "fr",
      updatedAt: stamp,
    })}
    ${insert(variant, {
      id: "variant-fr",
      shopId: "shop-a",
      providerAccountId: "waba-a",
      purpose: purposes[0],
      languageTag: "fr",
      providerLanguageCode: "fr",
      providerTemplateName: `fixture_${purposes[0].toLowerCase()}`,
      providerTemplateId: "meta-fr",
      metaRegistrationId: id,
      status: "APPROVED",
      enabled: true,
      updatedAt: stamp,
    })}
    ${insert(operation, {
      id: "publication-a",
      definitionId: purposes[0],
      requestedByAdminId: "author",
      operationKey: "fixture-publication",
      scopeSnapshot: { scope: { mode: "one", shopId: "shop-a" } },
      status: "COMPLETE",
      totalTargets: 1,
      succeededTargets: 1,
      failedTargets: 0,
      completedAt: stamp,
    })}
    ${insert(target, {
      id: "target-fr",
      operationId: "publication-a",
      shopId: "shop-a",
      languageTag: "fr",
      metaRegistrationId: id,
      newVariantId: "variant-fr",
      status: "SUCCEEDED",
      processedAt: stamp,
    })}
    COMMIT;`);
}
function snapshot(tables) {
  return tables.map((table) =>
    JSON.parse(
      sql(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."id"), '[]'::jsonb) FROM ${table} t;`,
      ),
    ),
  );
}
const catalogue = [admin, definition, locale, registration];
const history = [...catalogue, shop, variant, operation, target];
const defaultRow = (
  id,
  purpose = purposes[0],
  wabaId = "waba-a",
  definitionId = purpose,
  updatedByAdminId = "selector",
) => insert(defaults, { id, wabaId, purpose, definitionId, updatedByAdminId });
function removeMerchant() {
  // Existing FK requires explicit removal of merchant publication targets first.
  sql(`BEGIN; DELETE FROM ${target} WHERE "shopId"='shop-a';
    DELETE FROM ${variant} WHERE "shopId"='shop-a';
    DELETE FROM ${shop} WHERE "id"='shop-a'; COMMIT;`);
}
function exercise() {
  assert.equal(
    count(defaults),
    0,
    "Migration must never choose existing published definitions",
  );
  const before = snapshot(history);
  for (const purpose of purposes)
    sql(defaultRow(`default-${purpose}`, purpose));
  assert.equal(count(defaults), 6);
  assert.deepEqual(
    snapshot(history),
    before,
    "Setting defaults cannot update existing merchant or provider rows",
  );
  expectState(defaultRow("duplicate"), "23505");
  expectState(
    defaultRow("invalid-purpose", "OTHER", "waba-a", purposes[0]),
    "23514",
  );
  expectState(defaultRow("blank-waba", purposes[0], ""), "23514");
  expectState(defaultRow("space-waba", purposes[0], "waba a"), "23514");
  expectState(
    defaultRow("bad-definition", purposes[0], "waba-b", "missing"),
    "23503",
  );
  expectState(
    defaultRow("bad-admin", purposes[0], "waba-b", purposes[0], "missing"),
    "23503",
  );
  sql(defaultRow("another-waba", purposes[0], "waba-b"));
  assert.equal(count(defaults), 7, "Same purpose is independent across WABAs");
  expectState(
    `UPDATE ${defaults} SET "wabaId"='waba-a' WHERE "id"='another-waba'`,
    "23505",
  );
  expectState(`DELETE FROM ${admin} WHERE "id"='selector'`, "23503");
  // A definition referenced only by a default cannot be deleted or rekeyed.
  expectState(
    `DELETE FROM ${definition} WHERE "id"='INITIAL_CODE_OFFER'`,
    "23503",
  );
  expectState(
    `UPDATE ${definition} SET "id"='changed' WHERE "id"='INITIAL_CODE_OFFER'`,
    "23503",
  );
  sql(`UPDATE ${defaults} SET "definitionId"='replacement', "updatedAt"=now()
    WHERE "wabaId"='waba-a' AND "purpose"='INITIAL_NO_OFFER';`);
  assert.equal(count(defaults), 7);
  assert.equal(
    sql(
      `SELECT "definitionId" FROM ${defaults} WHERE "id"='default-INITIAL_NO_OFFER';`,
    ),
    "replacement",
  );
  assert.deepEqual(
    snapshot(history),
    before,
    "Changing defaults must not republish or replace merchant assignments",
  );
  if (mode === "fresh") seedMerchant();
  assert.equal(count(shop), 1);
  assert.equal(count(variant), 1);
  const saved = snapshot([defaults, ...catalogue, operation]);
  removeMerchant();
  assert.equal(count(shop), 0);
  assert.equal(count(variant), 0);
  assert.equal(count(target), 0);
  assert.deepEqual(
    snapshot([defaults, ...catalogue, operation]),
    saved,
    "Merchant deletion must preserve platform defaults and provider catalogue",
  );
  sql(defaultRow("no-shops", purposes[1], "waba-b"));
  assert.equal(count(defaults), 8, "Defaults can be created with no shops");
  console.log(
    "PASS uniqueness, foreign keys, purpose/WABA identity, explicit replacement, merchant independence and preservation",
  );
}
let started = false;
try {
  docker([
    "run",
    "--detach",
    "--name",
    container,
    "--network",
    "none",
    "--env",
    "POSTGRES_PASSWORD=fixture-only",
    "--env",
    `POSTGRES_DB=${database}`,
    "pgvector/pgvector:pg17",
  ]);
  started = true;
  await ready();
  const names = readdirSync(directory)
    .filter((name) => /^\d{14}_/.test(name) && name <= migration)
    .sort();
  assert.ok(names.includes(migration));
  for (const name of names.filter((name) => name !== migration)) apply(name);
  let before;
  if (mode === "upgrade") {
    seedCatalogue();
    seedMerchant();
    before = snapshot(history);
  }
  apply(migration);
  assert.equal(count(defaults), 0);
  if (mode === "upgrade")
    assert.deepEqual(
      snapshot(history),
      before,
      "Upgrade must leave all existing rows unchanged",
    );
  else {
    assert.equal(count(shop), 0);
    seedCatalogue();
  }
  exercise();
  console.log(`PASS recovery template defaults PostgreSQL ${mode}`);
} finally {
  if (started) {
    docker(["rm", "--force", "--volumes", container]);
    console.log(`CLEANUP ${container}`);
  }
}
