import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const target = "20261011120000_arch032_mcp_operational_events";
const modeIndex = process.argv.indexOf("--mode");
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(["fresh", "upgrade"].includes(mode), "Pass --mode fresh|upgrade");
const container = `moda-arch032-mcp014-${randomUUID()}`;
const database = "arch032_mcp_operational_fixture";
let started = false;

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
}
function psql(sql, capture = false) {
  return docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
    ...(capture ? ["-A", "-t"] : []), "-U", "postgres", "-d", database], { input: sql }).trim();
}
function scalar(sql) { return psql(sql, true); }
function rejected(label, sql, state) {
  psql(`DO $test$
DECLARE actual text;
BEGIN
  BEGIN
    ${sql.trim().replace(/;+$/, "")};
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
    IF actual <> '${state}' THEN RAISE; END IF;
  END;
  IF actual IS NULL THEN RAISE EXCEPTION 'Expected rejection: ${label}'; END IF;
END;
$test$;`);
  console.log(`PASS ${label} (${state})`);
}
async function ready() {
  for (let n = 0; n < 90; n++) {
    try { psql("SELECT 1;"); return; } catch { await delay(1000); }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}
function apply(name) {
  psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
  console.log(`APPLIED ${name}`);
}
function seedShop() {
  psql(`INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES
    ('arch032-shop','arch032.example.invalid','WOOCOMMERCE',now()),
    ('arch032-other','arch032-other.example.invalid','SHOPIFY',now());`);
}
const incident = `INSERT INTO support."McpOperationalIncident" (
  "id","incidentKey","shopId","capabilityKey","reasonCode","firstOccurredAt","lastOccurredAt","lastErrorId")
 VALUES ('arch032-incident','arch032-unique','arch032-shop','product_search',
 'MCP_WOOCOMMERCE_REST_GRANT_REVOKED',now(),now(),'00000000-0000-4000-8000-000000000001')`;
const event = (id, type, shop = "arch032-shop") => `INSERT INTO support."McpOperationalEvent"
  ("id","shopId","incidentKey","capabilityKey","reasonCode","eventType") VALUES
  ('${id}','${shop}','arch032-unique','product_search',
  'MCP_WOOCOMMERCE_REST_GRANT_REVOKED','${type}')`;

function exercise() {
  assert.equal(scalar(`SELECT count(*) FROM information_schema.tables WHERE table_schema='support'
    AND table_name IN ('McpOperationalIncident','McpOperationalEvent')`), "2");
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalIncident"`), "0");
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalEvent"`), "0");
  seedShop();
  psql(incident + ";");
  rejected("duplicate incident key", incident.replace("arch032-incident", "arch032-duplicate"), "23505");
  rejected("unknown incident shop", incident.replace("arch032-incident", "arch032-unknown")
    .replace("arch032-unique", "arch032-unknown").replace("'arch032-shop'", "'absent-shop'"), "23503");
  rejected("incident must have positive occurrences", `UPDATE support."McpOperationalIncident"
    SET "occurrenceCount"=0 WHERE "id"='arch032-incident'`, "23514");
  rejected("open incident cannot have resolved timestamp", `UPDATE support."McpOperationalIncident"
    SET "resolvedAt"=now() WHERE "id"='arch032-incident'`, "23514");
  rejected("resolved incident requires timestamp", `UPDATE support."McpOperationalIncident"
    SET "status"='RESOLVED' WHERE "id"='arch032-incident'`, "23514");
  rejected("invalid incident lifecycle status", `UPDATE support."McpOperationalIncident"
    SET "status"='IGNORED' WHERE "id"='arch032-incident'`, "23514");
  psql(event("00000000-0000-4000-8000-000000000011", "MCP_TOOL_EXECUTION_BLOCKED") + ";");
  psql(event("00000000-0000-4000-8000-000000000012", "MCP_TOOL_EXECUTION_BLOCKED") + ";");
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalEvent"`), "2");
  rejected("duplicate event id", event("00000000-0000-4000-8000-000000000011", "MCP_TOOL_EXECUTION_BLOCKED"), "23505");
  rejected("unknown event type", event("00000000-0000-4000-8000-000000000013", "UNKNOWN"), "23514");
  rejected("unknown event shop", event("00000000-0000-4000-8000-000000000014", "MCP_TOOL_EXECUTION_BLOCKED", "absent-shop"), "23503");
  psql(`UPDATE support."McpOperationalIncident" SET "occurrenceCount"=2,
    "lastErrorId"='00000000-0000-4000-8000-000000000002',"lastOccurredAt"=now()
    WHERE "id"='arch032-incident';`);
  assert.equal(scalar(`SELECT "occurrenceCount" FROM support."McpOperationalIncident"`), "2");
  psql(`UPDATE support."McpOperationalIncident" SET "status"='RESOLVED',"resolvedAt"=now()
    WHERE "id"='arch032-incident';`);
  psql(event("00000000-0000-4000-8000-000000000015", "MCP_TOOL_EXECUTION_RESOLVED") + ";");
  assert.equal(scalar(`SELECT "status" FROM support."McpOperationalIncident"`), "RESOLVED");
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalEvent"`), "3");
  console.log("PASS incidents, duplicate suppression keys, event types and resolution lifecycle");
  psql(`DELETE FROM commerce."Shop" WHERE "id"='arch032-shop';`);
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalIncident"`), "0");
  assert.equal(scalar(`SELECT count(*) FROM support."McpOperationalEvent"`), "0");
  console.log("PASS shop deletion cascades both operational tables");
}
async function main() {
  try {
    docker(["run", "--detach", "--name", container, "--network", "none",
      "--env", "POSTGRES_PASSWORD=fixture-only", "--env", `POSTGRES_DB=${database}`,
      "pgvector/pgvector:pg17"]);
    started = true;
    await ready();
    const names = readdirSync(new URL("../prisma/migrations/", import.meta.url))
      .filter((name) => /^\d{14}_/.test(name)).sort();
    assert.equal(names.at(-1), target, "MCP operational migration must be latest");
    assert.equal(scalar(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'`), "0", "fixture must start empty");
    for (const name of names) {
      if (name === target && mode === "upgrade") {
        seedShop();
        psql(`INSERT INTO support."MerchantSupportThread" ("id","shopId","updatedAt")
          VALUES ('arch032-existing-thread','arch032-shop',now());`);
        console.log("SEEDED existing merchant support thread before MCP migration");
      }
      apply(name);
    }
    if (mode === "upgrade") {
      assert.equal(scalar(`SELECT count(*) FROM support."MerchantSupportThread"
        WHERE "id"='arch032-existing-thread'`), "1", "existing support thread retained");
      console.log("PASS existing merchant support thread preserved");
      psql(`DELETE FROM commerce."Shop" WHERE "id" IN ('arch032-shop','arch032-other');`);
    }
    exercise();
    console.log(`PASS ARCH-032 MCP operational database ${mode}`);
  } finally {
    if (started) {
      docker(["rm", "--force", container]);
      console.log(`CLEANUP ${container}`);
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
