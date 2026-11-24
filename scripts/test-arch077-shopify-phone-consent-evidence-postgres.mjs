import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// ARCH-077-DATABASE-001: invocation-owned, network-isolated PostgreSQL 17.
// This test never touches a developer/production connection string.
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 1), ["--mode"], "Usage: --mode fresh|upgrade");
assert.ok(args.length === 2 && ["fresh", "upgrade"].includes(args[1]));
const mode = args[1];
const target = "20261124110000_arch077_shopify_phone_consent_evidence";
const container = `moda-arch077-shopify-evidence-${randomUUID()}`;
const database = "arch077_shopify_evidence_fixture";
const migrations = new URL("../prisma/migrations/", import.meta.url);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const t = second => quote(`2026-11-24T10:00:${String(second).padStart(2, "0")}.000Z`);
const digest = hex => `decode(repeat(${quote(hex)},32),'hex')`;
const table = { shop: 'commerce."Shop"', customer: 'commerce."Customer"',
  phone: 'commerce."CustomerPhone"', evidence: 'commerce."WhatsAppConsentEvidence"',
  installation: 'woocommerce."WooCommerceInstallation"' };
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
  "-h", "127.0.0.1", "-U", "postgres", "-d", database];
let started = false;
let checks = 0;
const docker = (args, options = {}) => execFileSync("docker", args, {
  encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options,
});
const sql = statement => docker(psqlArgs, { input: statement }).trim();
const scalar = statement => docker([...psqlArgs, "-A", "-t"], { input: statement }).trim().split("\n").at(-1) ?? "";
function equal(actual, expected, label) { assert.equal(actual, expected, label); checks++; }
function denied(label, statement, expected = /ERROR:/) {
  try { sql(statement); } catch (error) {
    assert.match(String(error.stderr), expected, `${label}: unexpected PostgreSQL error`);
    checks++;
    return;
  }
  assert.fail(`${label}: unexpectedly accepted`);
}
function apply(name) {
  sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
  console.log(`APPLIED ${name}`);
}
async function boot() {
  docker(["run", "-d", "--name", container, "--network", "none",
    "-e", "POSTGRES_PASSWORD=fixture-only", "-e", `POSTGRES_DB=${database}`,
    "pgvector/pgvector:pg17"]);
  started = true;
  for (let i = 0; i < 90; i++) {
    try {
      docker(["exec", container, "pg_isready", "-q", "-h", "127.0.0.1",
        "-U", "postgres", "-d", database], { stdio: "ignore" });
      return;
    } catch { await delay(500); }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}
function contract() {
  const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.split("model WhatsAppConsentEvidence {")[1]?.split("\n}")[0];
  assert.ok(model, "WhatsAppConsentEvidence model missing");
  assert.match(model, /installationId\s+String\?\s+@db\.Text/);
  assert.match(model, /installation\s+WooCommerceInstallation\?\s+@relation\(fields: \[installationId, shopId\], references: \[id, shopId\], onDelete: Restrict, onUpdate: Restrict\)/);
  const source = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), "utf8");
  assert.match(source, /ALTER COLUMN "installationId" DROP NOT NULL/);
  assert.match(source, /CREATE OR REPLACE FUNCTION "commerce"\.arch045_woo_evidence_guard\(\)/);
  assert.match(source, /CREATE OR REPLACE FUNCTION "commerce"\.arch045_woo_consent_commit_guard\(\)/);
  assert.doesNotMatch(source, /\b(?:DROP TABLE|TRUNCATE|CREATE TRIGGER|DROP TRIGGER|CREATE TABLE)\b/i);
  console.log("PASS Prisma and SQL migration contracts");
}
function seedWoo() {
  sql(`INSERT INTO ${table.shop} ("id","domain","platform","updatedAt") VALUES
    ('woo','https://woo.example.invalid','WOOCOMMERCE',now()),
    ('woo-other','https://woo-other.example.invalid','WOOCOMMERCE',now());
    INSERT INTO ${table.customer} ("id","shopId","updatedAt") VALUES
    ('woo-customer','woo',now());
    INSERT INTO ${table.phone} ("id","customerId","phone","whatsappCanonicalPhone",
      "whatsappPhoneVerifiedAt","updatedAt") VALUES
    ('woo-phone','woo-customer','+447911111111','447911111111',${t(0)},now());
    INSERT INTO ${table.installation} ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES
    ('woo-install','woo','https://woo.example.invalid',${digest("ab")},now()),
    ('woo-other-install','woo-other','https://woo-other.example.invalid',${digest("cd")},now());`);
}
function seedShopify() {
  sql(`INSERT INTO ${table.shop} ("id","domain","platform","updatedAt") VALUES
    ('shopify','shopify.example.invalid','SHOPIFY',now()),
    ('shopify-other','other-shopify.example.invalid','SHOPIFY',now());
    INSERT INTO ${table.customer} ("id","shopId","updatedAt") VALUES
    ('guest','shopify',now()), ('other-guest','shopify-other',now());
    INSERT INTO ${table.phone} ("id","customerId","phone","whatsappCanonicalPhone",
      "whatsappPhoneVerifiedAt","updatedAt") VALUES
    ('customer-phone','guest','+447900000001','447900000001',${t(0)},now()),
    ('billing-phone','guest','+447900000002','447900000002',${t(0)},now()),
    ('shipping-phone','guest','+447900000003','447900000003',${t(0)},now()),
    ('other-phone','other-guest','+447900000001','447900000001',${t(0)},now());`);
}
const registered = {
  "customer-phone": ["guest", "shopify", "447900000001"],
  "billing-phone": ["guest", "shopify", "447900000002"],
  "shipping-phone": ["guest", "shopify", "447900000003"],
  "other-phone": ["other-guest", "shopify-other", "447900000001"],
  "woo-phone": ["woo-customer", "woo", "447911111111"],
};
function consent(phone, decision, revision, sequence, at, source = "SHOPIFY_NATIVE") {
  return `UPDATE ${table.phone} SET "whatsappConsentDecision"=${quote(decision)},
    "whatsappConsentSource"=${quote(source)},
    "whatsappConsentProviderObservedAt"=${t(at)}, "whatsappConsentVerifiedAt"=${t(at + 1)},
    "whatsappConsentRevision"=${revision}, "whatsappConsentDecisionSequence"=${sequence}
    WHERE "id"=${quote(phone)};`;
}
function evidence(id, phone, decision, revision, sequence, at, options = {}) {
  const [customerId, shopId, canonical] = registered[phone];
  const installation = options.installation === undefined ? "NULL" : quote(options.installation);
  const payload = options.digest ?? "ab";
  return `INSERT INTO ${table.evidence} (
    "id","shopId","installationId","eventId","payloadDigest","customerId",
    "customerPhoneId","canonicalPhone","purpose","decision","decisionSequence",
    "phoneConsentRevision","decisionAt","disclosureText","disclosureVersion","disclosureLocale"
  ) VALUES (${quote(id)},${quote(options.shopId ?? shopId)},${installation},
    ${quote(options.eventId ?? `receipt-${id}`)},${digest(payload)},
    ${quote(options.customerId ?? customerId)},${quote(options.phone ?? phone)},
    ${quote(options.canonical ?? canonical)},'WHATSAPP_CHECKOUT_RECOVERY',
    ${quote(decision)},${sequence},${revision},${t(at)},
    ${quote(options.disclosure ?? "Send me WhatsApp shopping updates, reminders and offers.")},
    '1','en-GB');`;
}
function write(phone, decision, revision, sequence, at, id, options = {}) {
  return `BEGIN;
    ${consent(phone, decision === "GRANT" ? "GRANTED" : "REVOKED", revision, sequence, at,
      options.source ?? (phone === "woo-phone" ? "WOO_MODA_CHECKBOX" : "SHOPIFY_NATIVE"))}
    ${evidence(id, phone, decision, revision, sequence, at, {
      ...options, ...(phone === "woo-phone" ? { installation: "woo-install" } : {}),
    })}
    COMMIT;`;
}
function metadata() {
  equal(scalar(`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='WhatsAppConsentEvidence'
      AND column_name='installationId';`), "YES", "Shopify installation nullable");
  equal(scalar(`SELECT count(*) FROM pg_constraint WHERE conname='WhatsAppConsentEvidence_installation_fkey';`),
    "1", "existing Woo composite FK preserved");
  equal(scalar(`SELECT count(*) FROM pg_trigger WHERE tgname IN (
      'arch045_woo_evidence_guard','arch045_woo_consent_commit_guard') AND NOT tgisinternal;`),
    "2", "existing triggers preserved");
  console.log("PASS nullable Shopify association, original Woo FK and trigger identities");
}
function shopifyConsent() {
  denied("Shopify GRANT without evidence", consent("customer-phone", "GRANTED", 1, 1, 1),
    /Shopify permission write requires matching same-transaction evidence/);
  equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone}
    WHERE "id"='customer-phone';`), "UNKNOWN", "missing-evidence update rolled back");
  for (const [i, phone] of ["customer-phone", "billing-phone", "shipping-phone"].entries()) {
    sql(write(phone, "GRANT", 1, 1, i + 1, `initial-${phone}`, { digest: `a${i + 1}` }));
  }
  equal(scalar(`SELECT count(*) FROM ${table.evidence} WHERE "shopId"='shopify';`),
    "3", "one receipt evidence per distinct Shopify number");
  equal(scalar(`SELECT count(*) FROM ${table.phone} p WHERE p."customerId"='guest'
    AND p."whatsappConsentDecision"='GRANTED';`), "3", "three independent grants");
  denied("missing Shopify REVOKE evidence", consent("customer-phone", "REVOKED", 2, 2, 5),
    /Shopify permission write requires matching same-transaction evidence/);
  sql(write("customer-phone", "REVOKE", 2, 2, 5, "revoke-customer"));
  sql(write("shipping-phone", "REVOKE", 2, 2, 6, "revoke-shipping"));
  equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone}
    WHERE "id"='billing-phone';`), "GRANTED", "other phone stays granted");
  equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone}
    WHERE "id"='customer-phone';`), "REVOKED", "specific phone revoked");
  // A previously accepted receipt is an idempotent no-op even after a new decision.
  sql(evidence("duplicate-replay", "customer-phone", "GRANT", 1, 1, 1,
    { eventId: "receipt-initial-customer-phone", digest: "a1" }));
  equal(scalar(`SELECT count(*) FROM ${table.evidence} WHERE "shopId"='shopify';`),
    "5", "same event and digest replays as no-op");
  denied("event ID with differing digest", evidence("conflicting-replay", "customer-phone", "GRANT", 1, 1, 1,
    { eventId: "receipt-initial-customer-phone", digest: "ff" }),
    /same eventId with different consent payload/);
  denied("wrong number in current evidence", evidence("wrong-number", "billing-phone", "GRANT", 1, 1, 2,
    { canonical: "447900000003" }), /Shopify evidence must match exact current phone decision/);
  denied("wrong customer FK", evidence("wrong-customer", "billing-phone", "GRANT", 1, 1, 2,
    { customerId: "other-guest" }), /Shopify evidence must match exact current phone decision/);
  denied("wrong tenant FK", evidence("wrong-shop", "billing-phone", "GRANT", 1, 1, 2,
    { shopId: "shopify-other" }), /Shopify evidence must match exact current phone decision/);
  denied("wrong observed time", evidence("wrong-time", "billing-phone", "GRANT", 1, 1, 4),
    /Shopify evidence must match exact current phone decision/);
  denied("wrong decision", evidence("wrong-decision", "billing-phone", "REVOKE", 1, 1, 2),
    /Shopify evidence must match exact current phone decision/);
  denied("wrong revision", evidence("wrong-revision", "billing-phone", "GRANT", 3, 1, 2),
    /Shopify evidence must match exact current phone decision/);
  denied("wrong sequence", evidence("wrong-sequence", "billing-phone", "GRANT", 1, 2, 2),
    /Shopify evidence must match exact current phone decision/);
  denied("empty disclosure GRANT", evidence("bad-disclosure", "billing-phone", "GRANT", 1, 1, 2,
    { disclosure: "" }), /WhatsAppConsentEvidence_verified_check/);
  denied("evidence UPDATE is immutable", `UPDATE ${table.evidence}
    SET "decision"='REVOKE' WHERE "id"='initial-billing-phone';`);
  denied("evidence DELETE is immutable", `DELETE FROM ${table.evidence}
    WHERE "id"='initial-billing-phone';`);
  sql(`UPDATE ${table.phone} SET "whatsappNoContact"=TRUE,
    "whatsappNoContactReason"='CUSTOMER_STOP',"whatsappNoContactAt"=${t(9)},
    "whatsappNoContactRevision"=1 WHERE "id"='billing-phone';`);
  equal(scalar(`SELECT "whatsappNoContact"::text FROM ${table.phone}
    WHERE "id"='customer-phone';`), "false", "STOP must not spread to other phone");
  denied("STOP cannot be lifted", `UPDATE ${table.phone} SET "whatsappNoContact"=FALSE,
    "whatsappNoContactReason"=NULL,"whatsappNoContactRevision"=2
    WHERE "id"='billing-phone';`);
  // Provider GRANT is legal as a consent fact but must not clear the independent STOP.
  sql(write("billing-phone", "GRANT", 2, 2, 10, "regrant-stopped"));
  equal(scalar(`SELECT "whatsappNoContact"::text FROM ${table.phone}
    WHERE "id"='billing-phone';`), "true", "later GRANT retains phone-specific STOP");
  denied("Shopify evidence must not use Woo installation", evidence("shopify-fake-install",
    "customer-phone", "REVOKE", 2, 2, 5, { installation: "woo-install" }),
    /evidence requires active authenticated installation/);
  denied("Shopify cannot claim Woo source", consent("customer-phone", "GRANTED", 3, 3, 10,
    "WOO_MODA_CHECKBOX"), /Woo consent on non-Woo merchant/);
  denied("same Customer may not duplicate an active canonical number", `INSERT INTO ${table.phone}
    ("id","customerId","phone","whatsappCanonicalPhone","updatedAt") VALUES
    ('duplicate-canonical','guest','+447900000001','447900000001',now());`);
  // The same canonical number is valid at a different Shopify merchant.
  sql(write("other-phone", "GRANT", 1, 1, 1, "other-shop-grant"));
  equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone}
    WHERE "id"='other-phone';`), "GRANTED", "same phone is scoped to merchant");
  equal(scalar(`SELECT count(*) FROM ${table.evidence}
    WHERE "shopId"='shopify-other';`), "1", "other merchant has independent evidence");
  console.log("PASS Shopify multi-phone GRANT/REVOKE, exact evidence, replay, isolation and STOP");
}
function wooRegression() {
  equal(scalar(`SELECT count(*) FROM ${table.evidence}
    WHERE "shopId"='woo' AND "installationId"='woo-install';`),
    "1", "existing Woo evidence preserved");
  denied("Woo cannot omit installation", evidence("woo-null", "woo-phone", "GRANT", 1, 1, 1));
  denied("Woo requires existing installation", evidence("woo-missing", "woo-phone", "GRANT", 1, 1, 1,
    { installation: "missing-install" }));
  denied("Woo installation must belong to same shop", evidence("woo-wrong-shop",
    "woo-phone", "GRANT", 1, 1, 1, { installation: "woo-other-install" }));
  denied("Woo REVOKE requires evidence", consent("woo-phone", "REVOKED", 2, 2, 5, "WOO_MODA_CHECKBOX"));
  sql(write("woo-phone", "REVOKE", 2, 2, 5, "woo-revoke"));
  sql(`UPDATE ${table.installation} SET "status"='REVOKED',"revokedAt"=${t(7)}
    WHERE "id"='woo-install';`);
  denied("revoked Woo installation cannot insert evidence", evidence("woo-revoked",
    "woo-phone", "REVOKE", 2, 2, 5, { installation: "woo-install" }));
  denied("revoked Woo installation cannot support new grant", write("woo-phone", "GRANT",
    3, 3, 10, "woo-regrant-revoked"));
  console.log("PASS Woo authenticated installation, unchanged decision and evidence enforcement");
}
async function main() {
  contract();
  try {
    await boot();
    const names = readdirSync(migrations).filter(n => /^\d{14}_/.test(n)).sort();
    const index = names.indexOf(target);
    assert.ok(index >= 0, "ARCH-077 migration must exist in this checkout");
    for (const name of names.slice(0, index)) apply(name);
    // Upgrade exercises a pre-existing valid Woo evidence row, never historical
    // Shopify consent. Fresh creates the identical fixture after migration.
    if (mode === "upgrade") { seedWoo(); sql(write("woo-phone", "GRANT", 1, 1, 1, "woo-initial")); }
    apply(target);
    if (mode === "fresh") { seedWoo(); sql(write("woo-phone", "GRANT", 1, 1, 1, "woo-initial")); }
    seedShopify();
    metadata(); shopifyConsent(); wooRegression();
    console.log(`PASS ARCH-077-DATABASE-001 PostgreSQL ${mode}: ${checks} checks`);
  } finally {
    if (started) {
      docker(["rm", "-f", container], { stdio: "ignore" });
      console.log(`CLEANED disposable PostgreSQL container ${container}`);
    }
  }
}
await main();
