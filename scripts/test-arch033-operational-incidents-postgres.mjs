import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const target = "20261011210000_arch033_drop_legacy_mcp_operational_incidents";
const genericMigration = "20261011160000_arch033_generic_operational_incidents";
const mode = process.argv.at(process.argv.indexOf("--mode") + 1);
assert.ok(["fresh", "upgrade"].includes(mode), "Use --mode fresh|upgrade");
const container = `moda-arch033-incidents-${randomUUID()}`;
const database = "arch033_incident_fixture";
let started = false;
const docker = (args, extra = {}) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 32*1024*1024, ...extra });
const sql = (statement, capture = false) => docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", ...(capture ? ["-A", "-t"] : []), "-U", "postgres", "-d", database], { input: statement }).trim();
const scalar = (statement) => sql(statement, true);
function rejected(label, statement, expected) {
  sql(`DO $block$ DECLARE actual text; BEGIN
  BEGIN ${statement.replace(/;\s*$/, "")};
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
  IF actual <> '${expected}' THEN RAISE; END IF; END;
  IF actual IS NULL THEN RAISE EXCEPTION '${label} unexpectedly succeeded'; END IF;
  END $block$;`);
}
async function waitForPostgres() {
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-d", database]); return; }
    catch { await delay(500); }
  }
  throw new Error("disposable PostgreSQL did not become ready");
}
function migration(name) {
  sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
  console.log(`APPLIED ${name}`);
}
const shop = `INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES ('arch033-shop','arch033.example.invalid','SHOPIFY',now());`;
const newIncident = `INSERT INTO support."OperationalIncident" ("id","incidentKey","sourceService","environment","category","reasonCode","resourceKey","shopId","severity","firstOccurredAt","lastOccurredAt","lastCorrelationId") VALUES ('arch033-incident','${'a'.repeat(64)}','background','test','INTEGRATION_ACCESS','SHOPIFY_ACCESS_REVOKED','recovery:123','arch033-shop','HIGH',now(),now(),'corr-1')`;
function tests() {
  assert.equal(scalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema='support' AND table_name IN ('McpOperationalIncident','McpOperationalEvent')`), '0', 'legacy MCP incident tables must be gone');
  assert.equal(scalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema='support' AND table_name IN ('MerchantSupportThread','MerchantSupportMessage')`), '2', 'merchant support must be preserved');
  assert.equal(scalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema='support' AND table_name IN ('OperationalIncident','OperationalIncidentEvent')`), '2');
  sql(newIncident + ';');
  rejected('duplicate incident', newIncident.replace('arch033-incident','arch033-incident-2'), '23505');
  rejected('bad environment', newIncident.replace('arch033-incident','arch033-incident-3').replace('a'.repeat(64), 'c'.repeat(64)).replace("'test'","'production-test'"), '23514');
  rejected('invalid shop', newIncident.replace('arch033-incident','arch033-incident-4').replace('a'.repeat(64), 'd'.repeat(64)).replace("'arch033-shop'","'unknown-shop'"), '23503');
  rejected('missing owner timestamp', `UPDATE support."OperationalIncident" SET "ownerPlatformAdminId"='unknown' WHERE "id"='arch033-incident'`, '23514');
  rejected('bad occurrences', `UPDATE support."OperationalIncident" SET "occurrenceCount"=0 WHERE "id"='arch033-incident'`, '23514');
  rejected('resolved without actor', `UPDATE support."OperationalIncident" SET "status"='RESOLVED',"resolvedAt"=now(),"resolutionNote"='fixed' WHERE "id"='arch033-incident'`, '23514');
  sql(`INSERT INTO support."OperationalIncidentEvent" ("id","incidentId","eventType","correlationId") VALUES ('00000000-0000-4000-8000-000000000010','arch033-incident','OCCURRED','corr-1');`);
  rejected('duplicate occurrence', `INSERT INTO support."OperationalIncidentEvent" ("id","incidentId","eventType") VALUES ('00000000-0000-4000-8000-000000000010','arch033-incident','OCCURRED')`, '23505');
  rejected('event requires actor', `INSERT INTO support."OperationalIncidentEvent" ("id","incidentId","eventType") VALUES ('00000000-0000-4000-8000-000000000011','arch033-incident','CLAIMED')`, '23514');
  rejected('event immutable', `UPDATE support."OperationalIncidentEvent" SET "correlationId"='edited'`, '23514');
  rejected('event immutable delete', `DELETE FROM support."OperationalIncidentEvent"`, '23514');
  assert.equal(scalar(`SELECT count(*) FROM support."OperationalIncidentEvent"`), '1');
  // Conditional claim is a single-row CAS: a competing claim cannot overwrite the first.
  assert.equal(scalar(`WITH claimed AS (UPDATE support."OperationalIncident" SET "revision"="revision"+1 WHERE "id"='arch033-incident' AND "status"='OPEN' AND "ownerPlatformAdminId" IS NULL AND "revision"=0 RETURNING "id") SELECT count(*) FROM claimed`), '1');
  assert.equal(scalar(`WITH claimed AS (UPDATE support."OperationalIncident" SET "revision"="revision"+1 WHERE "id"='arch033-incident' AND "status"='OPEN' AND "ownerPlatformAdminId" IS NULL AND "revision"=0 RETURNING "id") SELECT count(*) FROM claimed`), '0');
  // Shopless incidents permitted for infrastructure-level failures.
  sql(newIncident.replace('arch033-incident', 'arch033-platform').replace('a'.repeat(64), 'b'.repeat(64)).replace("'arch033-shop'",'NULL') + ';');
  assert.equal(scalar(`SELECT count(*) FROM support."OperationalIncident" WHERE "shopId" IS NULL`),'1');
  console.log('PASS generic schema, CAS, identity, validation and audit integrity');
}
async function main() {
  try {
    docker(['run','--detach','--name',container,'--network','none','--env','POSTGRES_PASSWORD=fixture-only','--env',`POSTGRES_DB=${database}`,'pgvector/pgvector:pg17']);
    started = true;
    await waitForPostgres();
    const names = readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter((n)=>/^\d{14}_/.test(n)).sort();
    assert.equal(names.at(-1),target,'ARCH-033 migration must be the last migration');
    for (const name of names) {
      if (mode === 'upgrade' && name === target) {
        // The existing database has applied ARCH-032 and ARCH-033's generic schema.
        // Preserve a live legacy fixture across the forward-only cleanup migration.
        sql(`INSERT INTO support."McpOperationalIncident" ("id","incidentKey","shopId","capabilityKey","reasonCode","firstOccurredAt","lastOccurredAt","lastErrorId") VALUES ('arch033-legacy','${'e'.repeat(64)}','arch033-shop','product_search','MCP_WOOCOMMERCE_REST_GRANT_REVOKED',now(),now(),'00000000-0000-4000-8000-000000000030');`);
        sql(`INSERT INTO support."McpOperationalEvent" ("id","shopId","incidentKey","capabilityKey","reasonCode","eventType") VALUES ('00000000-0000-4000-8000-000000000031','arch033-shop','${'e'.repeat(64)}','product_search','MCP_WOOCOMMERCE_REST_GRANT_REVOKED','MCP_TOOL_EXECUTION_BLOCKED');`);
        assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalEvent"`), '1');
      }
      migration(name);
      if (name === genericMigration) sql(shop);
    }
    tests();
    console.log(`PASS ARCH-033 ${mode} disposable PostgreSQL`);
  } finally {
    if (started) {
      try { docker(['rm','-f',container]); console.log(`CLEANUP ${container}`); }
      catch (err) { console.error('CLEANUP FAILED', err); process.exitCode=1; }
    }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
