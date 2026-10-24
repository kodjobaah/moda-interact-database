import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Apply the actual migration history to a disposable, network-isolated database.
// Never connect to DATABASE_URL, a developer database or a production database.
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Use --mode fresh or --mode upgrade');
const target = '20261023173000_arch047_whatsapp_template_audit_actions';
const directory = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-arch047-db001-${randomUUID()}`;
const database = 'arch047_template_audit_fixture';
const actions = [
  'CREATE_WHATSAPP_TEMPLATE_VARIANT',
  'UPDATE_WHATSAPP_TEMPLATE_VARIANT',
  'ENABLE_WHATSAPP_TEMPLATE_VARIANT',
  'DISABLE_WHATSAPP_TEMPLATE_VARIANT',
  'BULK_ASSIGN_WHATSAPP_TEMPLATE_VARIANT',
  'BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT',
];
let started = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
  });
}
function sql(source) {
  return docker(['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q',
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', database],
  { input: source }).trim();
}
const scalar = source => sql(source).split('\n').at(-1)?.trim() ?? '';
const count = source => Number(scalar(source));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const auditTable = '"commerce"."CommerceAuditEvent"';
const migration = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), 'utf8');

async function ready() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      docker(['exec', container, 'pg_isready', '-q', '-h', '127.0.0.1',
        '-U', 'postgres', '-d', database], { stdio: 'ignore' });
      return;
    } catch { await delay(500); }
  }
  throw new Error('Isolated PostgreSQL did not start');
}
function apply(name) {
  sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
}
function seedHistoricalAudit() {
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt") VALUES
    ('arch047-shop-one','arch047-one.example',now()),
    ('arch047-shop-two','arch047-two.example',now());
    INSERT INTO "public"."PlatformAdmin" ("id","email","role","updatedAt") VALUES
    ('arch047-admin','arch047-super-admin@example.test','SUPER_ADMIN',now());
    INSERT INTO ${auditTable}
      ("id","actorAdminId","action","shopId","operationId","environment","reason","metadata")
    VALUES ('arch047-historical','arch047-admin','SET_OPENROUTER_CREDENTIAL',
      'arch047-shop-one','arch047-historical-operation','DEVELOPMENT','Pre-existing audit',
      '{"before":null,"after":{"purpose":"LEGACY"}}'::jsonb);`);
}
function historical() {
  return JSON.parse(scalar(`SELECT jsonb_build_object(
    'actorAdminId',"actorAdminId", 'shopId',"shopId", 'operationId',"operationId",
    'action',"action"::text, 'reason',"reason", 'metadata',"metadata"
    )::text FROM ${auditTable} WHERE "id"='arch047-historical';`));
}
function templateEnumValues() {
  return JSON.parse(scalar(`SELECT coalesce(json_agg(enumlabel ORDER BY enumsortorder),'[]'::json)::text
    FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid
      JOIN pg_namespace ON pg_namespace.oid=pg_type.typnamespace
    WHERE pg_namespace.nspname='commerce' AND pg_type.typname='CommerceAuditAction';`));
}
function auditColumns() {
  return scalar(`SELECT md5(coalesce(string_agg(column_name || ':' || data_type || ':' || is_nullable,
    ',' ORDER BY ordinal_position),'')) FROM information_schema.columns
    WHERE table_schema='commerce' AND table_name='CommerceAuditEvent';`);
}
function auditIndexes() {
  return scalar(`SELECT md5(coalesce(string_agg(indexname || ':' || indexdef,
    ',' ORDER BY indexname),'')) FROM pg_indexes
    WHERE schemaname='commerce' AND tablename='CommerceAuditEvent';`);
}
function persistAndReadNewActions(before) {
  const previous = { enabled: false, status: 'PENDING' };
  const next = { enabled: true, status: 'APPROVED' };
  for (const [index, action] of actions.entries()) {
    const shopId = index % 2 === 0 ? 'arch047-shop-one' : 'arch047-shop-two';
    const meta = { variantId: `arch047-variant-${index}`, before: previous, after: next };
    sql(`INSERT INTO ${auditTable}
      ("id","actorAdminId","shopId","operationId","action","reason","metadata") VALUES
      (${quote(`arch047-new-${index}`)},'arch047-admin',${quote(shopId)},
       ${quote(`arch047-operation-${index}`)},${quote(action)}::"commerce"."CommerceAuditAction",
       'Admin WhatsApp template assignment',${json(meta)});`);
    const selected = JSON.parse(scalar(`SELECT jsonb_build_object(
      'actorAdminId',"actorAdminId", 'shopId',"shopId", 'operationId',"operationId",
      'action',"action"::text, 'reason',"reason", 'metadata',"metadata"
      )::text FROM ${auditTable} WHERE "id"=${quote(`arch047-new-${index}`)};`));
    assert.deepEqual(selected, {
      actorAdminId: 'arch047-admin', shopId, operationId: `arch047-operation-${index}`,
      action, reason: 'Admin WhatsApp template assignment', metadata: meta,
    }, `${action} must round-trip with complete shop/actor/before-after evidence`);
  }
  assert.equal(count(`SELECT count(*) FROM ${auditTable} WHERE "actorAdminId"='arch047-admin'`), 7);
  assert.equal(count(`SELECT count(*) FROM ${auditTable} WHERE "shopId"='arch047-shop-one'`), 4);
  assert.equal(count(`SELECT count(*) FROM ${auditTable} WHERE "shopId"='arch047-shop-two'`), 3);
  for (const [label, shopId, operationId] of [
    ['missing shop', 'NULL', "'arch047-invalid-no-shop'"],
    ['missing operation ID', "'arch047-shop-one'", 'NULL'],
  ]) {
    assert.throws(() => sql(`INSERT INTO ${auditTable}
      ("id","actorAdminId","shopId","operationId","action","reason","metadata")
      VALUES (${quote(`arch047-invalid-${label}`)},'arch047-admin',${shopId},${operationId},
      'ENABLE_WHATSAPP_TEMPLATE_VARIANT','Must be rejected','{}'::jsonb);`),
    undefined, `WhatsApp audit ${label} must not persist`);
  }
  assert.throws(() => sql(`INSERT INTO ${auditTable}
    ("id","actorAdminId","shopId","operationId","action","reason","metadata")
    VALUES ('arch047-too-large','arch047-admin','arch047-shop-one',
      'arch047-invalid-large','UPDATE_WHATSAPP_TEMPLATE_VARIANT','Must be rejected',
      ${json({ before: null, after: { content: 'x'.repeat(9000) } })});`),
  undefined, 'Existing bounded audit metadata check must still apply');
  assert.deepEqual(historical(), before, 'Existing audited records must be semantically unchanged');
  assert.equal(count(`SELECT count(*) FROM "whatsapp"."WhatsAppTemplateVariant"`), 0,
    'Audit migration must not create or mutate shop template assignments');
}
async function main() {
  try {
    docker(['run', '-d', '--name', container, '--network', 'none',
      '-e', 'POSTGRES_PASSWORD=arch047-fixture', '-e', `POSTGRES_DB=${database}`,
      'pgvector/pgvector:pg17']);
    started = true;
    await ready();
    // Only migrate through the target; newer independent tasks must not affect
    // this task's isolated fresh/upgrade regression contract.
    const migrations = readdirSync(directory)
      .filter(name => /^\d{14}_/.test(name) && name <= target).sort();
    assert.ok(migrations.includes(target), 'ARCH-047 migration must be present');
    for (const name of migrations) {
      if (mode === 'upgrade' && name === target) break;
      apply(name);
    }
    if (mode === 'fresh') {
      seedHistoricalAudit();
    } else {
      assert.equal(actions.filter(action => templateEnumValues().includes(action)).length, 0,
        'New actions must not preexist in the upgraded baseline');
      seedHistoricalAudit();
    }
    const beforeHistorical = historical();
    const previousActions = templateEnumValues();
    const previousColumns = auditColumns();
    const previousIndexes = auditIndexes();
    if (mode === 'upgrade') apply(target);
    assert.deepEqual(templateEnumValues().filter(action => !previousActions.includes(action)),
      mode === 'upgrade' ? actions : [], 'Upgrade adds only six audit enum values');
    assert.equal(auditColumns(), previousColumns, 'Audit table columns must remain unchanged');
    assert.equal(auditIndexes(), previousIndexes, 'Audit indexes must remain unchanged');
    // pg_get_constraintdef can contain embedded newlines for a large CASE
    // expression. Query each predicate inside PostgreSQL rather than passing
    // the definition through scalar(), which keeps only the last output line.
    for (const action of actions) {
      assert.equal(scalar(`SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='"commerce"."CommerceAuditEvent"'::regclass
          AND conname='arch020_audit_targets'
          AND strpos(pg_get_constraintdef(oid), ${quote(action)}) > 0
      );`), 't', `Existing audit CHECK must admit ${action}`);
    }
    for (const action of actions) assert.ok(templateEnumValues().includes(action));
    assert.ok(templateEnumValues().includes('CREATE_PROMPT_TEMPLATE'));
    persistAndReadNewActions(beforeHistorical);
    // Replaying the forward SQL is safe: the ordinary Prisma migration system
    // tracks it once, while IF NOT EXISTS makes the statement itself repeat-safe.
    sql(migration);
    assert.equal(actions.filter(action => templateEnumValues().includes(action)).length, 6);
    assert.deepEqual(historical(), beforeHistorical);
    console.log(`PASS ARCH-047 PostgreSQL ${mode}: historical audit preserved, six new actor/shop/operation events`);
  } finally {
    if (started) docker(['rm', '-f', container], { stdio: 'ignore' });
  }
}
await main();
