import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { defaults, definition, locale, registration, variant, operation, target, shop, admin, history,
  purposes, q, insert, defaultRow, defId, compiled, seedCatalogue, seedMerchant, waba, otherWaba } from './fixtures/whatsapp-recovery-default-formats.mjs';

// No DATABASE_URL is read; use only our isolated disposable test container.
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]), 'Usage: --mode fresh|upgrade');
const mode = args[1];
const migration = '20261125010000_whatsapp_recovery_default_formats';
const directory = new URL('../prisma/migrations/', import.meta.url);
const migrationSql = readFileSync(new URL(`${migration}/migration.sql`, directory), 'utf8');
const container = `moda-default-formats-${randomUUID()}`;
const database = 'default_formats_fixture';
const docker = (command, options = {}) => execFileSync('docker', command, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
// The image's temporary init server listens only on Unix sockets. Use loopback
// TCP inside our isolated container to reach the permanent server, not that server.
const sql = statement => docker(['exec', '-i', '-e', 'PGPASSWORD=fixture-only', '-e', 'PGCONNECT_TIMEOUT=2',
  container, 'psql', '-X', '-qAt', '-w', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
  { input: statement, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const count = table => Number(sql(`SELECT count(*) FROM ${table};`));
const snapshot = tables => tables.map(table => JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."id"), '[]'::jsonb) FROM ${table} t;`)));
function expectState(statement, state) {
  sql(`DO $test$ DECLARE actual text; BEGIN
    BEGIN ${statement.replace(/;\s*$/, '')};
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;
    IF actual IS DISTINCT FROM ${q(state)} THEN RAISE EXCEPTION 'Expected SQLSTATE %, received %', ${q(state)}, actual; END IF;
  END $test$;`);
}
function apply(name) {
  sql(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function seedOldPointers() {
  for (const purpose of purposes) sql(defaultRow(`default-${purpose}`, purpose, defId(purpose, 'IMAGE')));
  sql(defaultRow('legacy-none', purposes[0], 'legacy-no-header', otherWaba));
  sql(defaultRow('legacy-text', purposes[1], 'legacy-text-header', otherWaba));
}
function expectRollback(message) {
  const before = snapshot([defaults, ...history]);
  assert.throws(() => sql(migrationSql), error => String(error.stderr).includes(message));
  assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema='whatsapp'
    AND table_name='WhatsAppRecoveryTemplateDefault' AND column_name='format';`), '0');
  assert.deepEqual(snapshot([defaults, ...history]), before);
  assert.equal(sql(`SELECT count(*) FROM pg_indexes WHERE schemaname='whatsapp'
    AND indexname='WhatsAppRecoveryTemplateDefault_wabaId_purpose_key';`), '1');
}
function migrationRejectsUnclassifiableEvidence() {
  const id = `${defId(purposes[0], 'IMAGE')}-fr`;
  const json = value => `${q(JSON.stringify(value))}::jsonb`;
  // A migrated pointer cannot be inferred from a single approved English row.
  const original = compiled('IMAGE');
  const wrong = compiled('TEXT');
  sql(`UPDATE ${registration} SET "componentsSnapshot"=${json(wrong.components)} WHERE "id"=${q(id)};`);
  expectRollback('frozen header mismatch');
  sql(`UPDATE ${registration} SET "componentsSnapshot"=${json(original.components)} WHERE "id"=${q(id)};`);
  sql(`UPDATE ${registration} SET "parameterBindingsSnapshot"='{}'::jsonb WHERE "id"=${q(id)};`);
  expectRollback('incompatible media binding');
  sql(`UPDATE ${registration} SET "parameterBindingsSnapshot"=${json(original.parameterBindings)} WHERE "id"=${q(id)};`);
  sql(`UPDATE ${locale} SET "localeAst"=jsonb_set(jsonb_set("localeAst", '{prepared,components}', ${json(wrong.components)}), '{prepared,parameterBindings}', ${json(wrong.parameterBindings)}) WHERE "id"=${q(id)};
    UPDATE ${registration} SET "componentsSnapshot"=${json(wrong.components)}, "parameterBindingsSnapshot"=${json(wrong.parameterBindings)} WHERE "id"=${q(id)};`);
  expectRollback('mixed locale header formats');
  sql(`UPDATE ${locale} SET "localeAst"=jsonb_set(jsonb_set("localeAst", '{prepared,components}', ${json(original.components)}), '{prepared,parameterBindings}', ${json(original.parameterBindings)}) WHERE "id"=${q(id)};
    UPDATE ${registration} SET "componentsSnapshot"=${json(original.components)}, "parameterBindingsSnapshot"=${json(original.parameterBindings)} WHERE "id"=${q(id)};`);
  // Missing cohort: move an existing registration to a different WABA; FK references survive.
  sql(`UPDATE ${registration} SET "wabaId"='9999999999999999' WHERE "id"=${q(id)};`);
  expectRollback('registration identity');
  sql(`UPDATE ${registration} SET "wabaId"=${q(waba)} WHERE "id"=${q(id)};`);
  // Unsupported/mismatched definition is also rejected before any default is classified.
  sql(`UPDATE ${defaults} SET "definitionId"=${q(defId(purposes[1], 'IMAGE'))} WHERE "id"=${q(`default-${purposes[0]}`)};`);
  expectRollback('incompatible definition');
  sql(`UPDATE ${defaults} SET "definitionId"=${q(defId(purposes[0], 'IMAGE'))} WHERE "id"=${q(`default-${purposes[0]}`)};`);
  // A revoked observation is not a format change; preserve the configured pointer.
  sql(`UPDATE ${registration} SET "providerStatus"='REJECTED' WHERE "id"=${q(id)};`);
  console.log('PASS migration refuses ambiguous/incomplete frozen evidence atomically');
}
function assertBackfill(beforePointers, beforeHistory) {
  const actual = snapshot([defaults])[0];
  const withoutFormat = actual.map(({ format, ...rest }) => rest);
  assert.deepEqual(withoutFormat, beforePointers, 'All existing pointer IDs, actor IDs, choices and timestamps must survive');
  assert.equal(actual.filter(row => row.wabaId === waba && row.format === 'IMAGE').length, 6);
  assert.equal(actual.find(row => row.id === 'legacy-none')?.format, 'TEXT');
  assert.equal(actual.find(row => row.id === 'legacy-text')?.format, 'TEXT');
  assert.deepEqual(snapshot(history), beforeHistory, 'Do not alter merchant assignments, registrations or history');
  assert.equal(count(variant), 120);
  assert.equal(count(target), 120);
  console.log('PASS six IMAGE choices, 120 variants and historical data retained; TEXT/NONE correctly classified');
}
function exercise() {
  if (mode === 'fresh') {
    assert.equal(count(defaults), 0, 'No automatic defaults on a fresh migration');
    seedCatalogue(sql);
    for (const purpose of purposes) sql(defaultRow(`default-${purpose}`, purpose, defId(purpose, 'IMAGE'), waba, 'IMAGE'));
    sql(defaultRow('legacy-none', purposes[0], 'legacy-no-header', otherWaba, 'TEXT'));
    sql(defaultRow('legacy-text', purposes[1], 'legacy-text-header', otherWaba, 'TEXT'));
    seedMerchant(sql, 'IMAGE');
  }
  const before = snapshot(history);
  for (const purpose of purposes) sql(defaultRow(`text-${purpose}`, purpose, defId(purpose, 'TEXT'), waba, 'TEXT'));
  assert.equal(count(defaults), 14);
  assert.deepEqual(snapshot(history), before);
  for (const format of ['IMAGE','TEXT']) expectState(defaultRow(`duplicate-${format}`, purposes[0], defId(purposes[0], format), waba, format), '23505');
  expectState(defaultRow('missing-format', purposes[0], defId(purposes[0], 'IMAGE'), otherWaba), '23502');
  expectState(defaultRow('bad-format', purposes[0], defId(purposes[0], 'IMAGE'), otherWaba, 'VIDEO'), '23514');
  expectState(defaultRow('bad-purpose', 'UNKNOWN', defId(purposes[0], 'IMAGE'), waba, 'IMAGE'), '23514');
  expectState(defaultRow('blank-waba', purposes[0], defId(purposes[0], 'IMAGE'), '', 'IMAGE'), '23514');
  expectState(defaultRow('bad-definition', purposes[0], 'missing', otherWaba, 'IMAGE'), '23503');
  expectState(insert(defaults, { id: 'bad-admin', wabaId: otherWaba, purpose: purposes[0],
    definitionId: defId(purposes[0], 'IMAGE'), format: 'IMAGE', updatedByAdminId: 'missing' }), '23503');
  expectState(`DELETE FROM ${admin} WHERE "id"='selector'`, '23503');
  const textBefore = JSON.parse(sql(`SELECT to_jsonb(d) FROM ${defaults} d WHERE "id"=${q(`text-${purposes[0]}`)};`));
  sql(`UPDATE ${defaults} SET "definitionId"='replacement-image', "updatedAt"=now() WHERE "id"=${q(`default-${purposes[0]}`)};`);
  assert.deepEqual(JSON.parse(sql(`SELECT to_jsonb(d) FROM ${defaults} d WHERE "id"=${q(`text-${purposes[0]}`)};`)), textBefore);
  assert.deepEqual(snapshot(history), before, 'Changing one default must not alter either merchant format');
  // Existing variant and target identity support both formats without a migration.
  seedMerchant(sql, 'TEXT');
  assert.equal(count(variant), 240);
  assert.equal(count(target), 240);
  const saved = snapshot([defaults, admin, definition, locale, registration, operation]);
  sql(`BEGIN; DELETE FROM ${target} WHERE "shopId"='shop-a'; DELETE FROM ${variant} WHERE "shopId"='shop-a'; DELETE FROM ${shop} WHERE "id"='shop-a'; COMMIT;`);
  assert.equal(count(shop), 0);
  assert.equal(count(variant), 0);
  assert.equal(count(target), 0);
  assert.deepEqual(snapshot([defaults, admin, definition, locale, registration, operation]), saved);
  console.log('PASS independent format/WABA slots, strict constraints, 240 assignments, and merchant reset preservation');
}
let started = false;
try {
  docker(['run', '--detach', '--name', container, '--network', 'none', '--env', 'POSTGRES_PASSWORD=fixture-only',
    '--env', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if (sql('SELECT 1;') === '1') { ready = true; break; }
    } catch {
      // Expected while the permanent server is not yet accepting TCP connections.
    }
    await delay(500);
  }
  assert.ok(ready, 'Disposable PostgreSQL failed to start');
  const names = readdirSync(directory).filter(name => /^\d{14}_/.test(name) && name <= migration).sort();
  assert.ok(names.includes(migration));
  for (const name of names.filter(name => name !== migration)) apply(name);
  if (mode === 'upgrade') {
    seedCatalogue(sql); seedMerchant(sql, 'IMAGE'); seedOldPointers();
    migrationRejectsUnclassifiableEvidence();
    const [beforePointers, ...beforeHistory] = snapshot([defaults, ...history]);
    apply(migration);
    assertBackfill(beforePointers, beforeHistory);
  } else apply(migration);
  exercise();
  console.log(`PASS recovery template default formats PostgreSQL ${mode}`);
} finally {
  if (started) { docker(['rm', '--force', '--volumes', container]); console.log(`CLEANUP ${container}`); }
}
