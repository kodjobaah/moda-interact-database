import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable, network-isolated PostgreSQL tests applying the REAL ordered migrations.
// This checks persistence and CAS; Admin/MCP own application-level JSON validation.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Run with --mode fresh|upgrade');
const target = '20261015160000_arch032_mcp_platform_policy_jsonb';
const container = `moda-arch032-database001-${randomUUID()}`;
const db = 'arch032_mcp_policy_fixture';
const migrations = new URL('../prisma/migrations/', import.meta.url);
let started = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}
function psql(statement, capture = false) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    ...(capture ? ['-A', '-t'] : []), '-U', 'postgres', '-d', db], { input: statement }).trim();
}
function scalar(statement) { return psql(statement, true).split('\n').at(-1)?.trim() ?? ''; }
function json(statement) { return JSON.parse(scalar(statement)); }
function migration(name) {
  psql(readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function tableList() {
  return json(`SELECT coalesce(json_agg(table_schema || '.' || table_name ORDER BY table_schema, table_name), '[]'::json)::text
    FROM information_schema.tables WHERE table_schema IN ('billing', 'commerce', 'public', 'shopify', 'woocommerce', 'support', 'whatsapp') AND table_type = 'BASE TABLE';`);
}
const policyTable = '"billing"."PlatformBillingPolicy"';
function policy() { return json(`SELECT to_jsonb(p)::text FROM ${policyTable} AS p WHERE "id" = 'default';`); }
function billingFields(value) {
  // Whole-row compare excluding precisely the expected mutable CAS/JSONB fields.
  const { mcpExecutionPolicy: _mcp, version: _version, updatedAt: _updated, ...rest } = value;
  return rest;
}
function write(expectedVersion, expression) {
  const updated = scalar(`WITH changed AS (
    UPDATE ${policyTable}
    SET "mcpExecutionPolicy" = ${expression}, "version" = "version" + 1, "updatedAt" = now()
    WHERE "id" = 'default' AND "version" = ${expectedVersion}
    RETURNING "version"
  ) SELECT count(*) FROM changed;`);
  return Number(updated);
}
function writeBilling(expectedVersion) {
  return Number(scalar(`WITH changed AS (
    UPDATE ${policyTable}
    SET "globalPauseNewRecoveries" = NOT "globalPauseNewRecoveries",
        "version" = "version" + 1, "updatedAt" = now()
    WHERE "id" = 'default' AND "version" = ${expectedVersion}
    RETURNING "version"
  ) SELECT count(*) FROM changed;`));
}
function quoteJson(value) { return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`; }
const seededSettings = { toolDeadlineMs: 10000, providerResponseTimeoutMs: 10000,
  maxProviderRequests: 12, maxResponseBytes: 262144 };
const environments = ['LOCAL', 'TEST', 'DEVELOPMENT', 'STAGING', 'PRODUCTION'];
const seededPolicy = { schemaVersion: 1,
  environments: Object.fromEntries(environments.map((key) => [key, seededSettings])) };
const updatedDevelopment = { ...seededSettings, toolDeadlineMs: 20000 };

function assertions(mode, previous) {
  const column = json(`SELECT row_to_json(x)::text FROM (
    SELECT data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='billing' AND table_name='PlatformBillingPolicy' AND column_name='mcpExecutionPolicy'
  ) x;`);
  assert.deepEqual(column, { data_type: 'jsonb', udt_name: 'jsonb', is_nullable: 'YES', column_default: null });
  const initial = policy();
  assert.ok(initial, 'A fresh migration must provision the platform policy singleton');
  assert.equal(initial.id, 'default');
  assert.deepEqual(initial.mcpExecutionPolicy, seededPolicy,
    'Migration must seed current MCP limits for every Commerce environment');
  const base = mode === 'upgrade' ? previous.version + 1 : 0;
  assert.equal(initial.version, base, 'Upgrade increments CAS token exactly once; fresh seed starts at zero');
  if (mode === 'upgrade') {
    assert.deepEqual(billingFields(initial), billingFields(previous),
      'Upgrade must not overwrite existing billing policy edits');
  } else {
    assert.deepEqual({
      globalPauseNewRecoveries: initial.globalPauseNewRecoveries,
      globalPauseAutomatedWhatsapp: initial.globalPauseAutomatedWhatsapp,
      lifetimeFreeRecoveryAllowance: initial.lifetimeFreeRecoveryAllowance,
      minimumUpgradePremiumBps: initial.minimumUpgradePremiumBps,
      absoluteOutboundHardLimit: initial.absoluteOutboundHardLimit,
      defaultWarningPercent: initial.defaultWarningPercent,
      defaultOutboundSoftLimit: initial.defaultOutboundSoftLimit,
      defaultOutboundHardLimit: initial.defaultOutboundHardLimit,
      terminalMessageReservedSlots: initial.terminalMessageReservedSlots,
      whatsappRecipientSuppressionDays: initial.whatsappRecipientSuppressionDays,
    }, {
      globalPauseNewRecoveries: false,
      globalPauseAutomatedWhatsapp: false,
      lifetimeFreeRecoveryAllowance: 5,
      minimumUpgradePremiumBps: 2000,
      absoluteOutboundHardLimit: 2000,
      defaultWarningPercent: 80,
      defaultOutboundSoftLimit: 1000,
      defaultOutboundHardLimit: 2000,
      terminalMessageReservedSlots: 1,
      whatsappRecipientSuppressionDays: 7,
    }, 'Fresh database must have all billing policy defaults');
  }
  const billingBefore = billingFields(initial);

  // A normal edit preserves every other environment created by the migration.
  assert.equal(write(base, `jsonb_set("mcpExecutionPolicy", '{environments,DEVELOPMENT}', ${quoteJson(updatedDevelopment)}, false)`), 1);
  assert.equal(policy().version, base + 1);
  assert.deepEqual(policy().mcpExecutionPolicy.environments, {
    ...seededPolicy.environments, DEVELOPMENT: updatedDevelopment,
  });

  const customProduction = { ...seededSettings, maxProviderRequests: 8 };
  assert.equal(write(base + 1, `jsonb_set("mcpExecutionPolicy", '{environments,PRODUCTION}', ${quoteJson(customProduction)}, false)`), 1);
  assert.equal(policy().version, base + 2);
  assert.deepEqual(policy().mcpExecutionPolicy.environments.PRODUCTION, customProduction);

  // Two form submissions captured at the same version cannot both succeed.
  assert.equal(write(base + 1, `jsonb_set("mcpExecutionPolicy", '{environments,LOCAL}', ${quoteJson(updatedDevelopment)}, false)`), 0);
  assert.deepEqual(policy().mcpExecutionPolicy.environments.LOCAL, seededSettings);

  // Billing and MCP must use the same version to prevent cross-section lost updates.
  assert.equal(writeBilling(base + 2), 1);
  assert.equal(policy().version, base + 3);
  assert.equal(write(base + 2, `jsonb_set("mcpExecutionPolicy", '{environments,TEST}', ${quoteJson(updatedDevelopment)}, false)`), 0);
  assert.deepEqual(policy().mcpExecutionPolicy.environments.TEST, seededSettings);
  assert.equal(policy().globalPauseNewRecoveries, !billingBefore.globalPauseNewRecoveries);

  // Clearing only one environment must preserve all other environments and version.
  assert.equal(write(base + 3, `"mcpExecutionPolicy" #- '{environments,PRODUCTION}'`), 1);
  assert.equal(policy().version, base + 4);
  assert.equal(policy().mcpExecutionPolicy.environments.PRODUCTION, undefined);
  assert.deepEqual(policy().mcpExecutionPolicy.environments.LOCAL, seededSettings);

  // A configured policy is allowed to be cleared later; the migration seed is
  // one-time and must not act as a runtime fallback/recreation mechanism.
  assert.equal(write(base + 4, 'NULL'), 1);
  assert.equal(policy().version, base + 5);
  assert.equal(policy().mcpExecutionPolicy, null);
  assert.equal(write(base + 3, quoteJson(seededPolicy)), 0,
    'Stale create-clear-replay must not recreate cleared policy');
  assert.equal(write(base + 5, quoteJson(seededPolicy)), 1,
    'Only a new authorised form using the current revision may restore settings');
  assert.equal(policy().version, base + 6);
  assert.deepEqual(policy().mcpExecutionPolicy, seededPolicy);
  assert.equal(write(0, quoteJson(seededPolicy)), 0,
    'The default seed must not become an unconditional reset/update operation');
  assert.deepEqual(billingFields(policy()), { ...billingBefore,
    globalPauseNewRecoveries: !billingBefore.globalPauseNewRecoveries });
  console.log('PASS seeded billing/MCP defaults, environment isolation, CAS and stale create-clear-replay');
}

async function main() {
  try {
    docker(['run', '-d', '--name', container, '--network', 'none', '-e', 'POSTGRES_PASSWORD=arch032-fixture',
      '-e', `POSTGRES_DB=${db}`, 'pgvector/pgvector:pg17']);
    started = true;
    let ready = false;
    for (let i = 0; i < 90; i++) {
      try {
        docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', db]);
        ready = true;
        break;
      } catch { await delay(1000); }
    }
    assert.ok(ready, 'Disposable PostgreSQL failed readiness');
    console.log(`ISOLATION mode=${mode} container=${container} network=none database=${db}`);
    const names = readdirSync(migrations).filter(n => /^\d{14}_.+/.test(n)).sort();
    assert.equal(names.at(-1), target, 'The new migration must be newest in this baseline');
    let tablesBefore = null;
    let previous = null;
    for (const name of names) {
      if (name === target) {
        tablesBefore = tableList();
        if (mode === 'upgrade') {
          psql(`INSERT INTO ${policyTable} ("id", "absoluteOutboundHardLimit", "defaultWarningPercent",
            "globalPauseNewRecoveries", "version", "updatedAt")
            VALUES ('default', 5000, 75, true, 7, now());`);
          previous = policy();
          assert.ok(previous);
        } else {
          assert.equal(scalar(`SELECT count(*) FROM ${policyTable};`), '0',
            'Pre-existing migrations must not implicitly provision the platform singleton');
        }
      }
      migration(name);
    }
    assert.deepEqual(tableList(), tablesBefore, 'Migration must not create/drop any table');
    assert.equal(scalar(`SELECT count(*) FROM ${policyTable};`), '1',
      'Migration must provision exactly one platform policy singleton');
    assertions(mode, previous);
    console.log(`PASS ARCH-032-DATABASE-001 ${mode} PostgreSQL certification`);
  } finally {
    if (started) {
      docker(['rm', '-f', '-v', container]);
      console.log(`CLEANUP removed ${container}`);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
