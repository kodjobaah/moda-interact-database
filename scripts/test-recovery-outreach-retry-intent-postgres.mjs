import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Always create a disposable database. Never read DATABASE_URL or connect to
// the merchant's database. Check both fresh and populated upgrade paths.
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--mode' && ['fresh', 'upgrade'].includes(args[1]), 'Usage: --mode fresh|upgrade');
const mode = args[1];
const migration = '20261125180000_recovery_outreach_retry_intent';
const directory = new URL('../prisma/migrations/', import.meta.url);
const container = `moda-retry-intent-${randomUUID()}`;
const database = 'retry_intent_fixture';
const docker = (command, options = {}) => execFileSync('docker', command, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
const sql = statement => docker(['exec', '-i', '-e', 'PGPASSWORD=fixture-only', '-e', 'PGCONNECT_TIMEOUT=2',
  container, 'psql', '-X', '-qAt', '-w', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database],
  { input: statement, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function apply(name) {
  sql(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
  console.log(`APPLIED ${name}`);
}
function expectState(statement, state) {
  sql(`DO $test$ DECLARE actual text; BEGIN
    BEGIN ${statement.replace(/;\s*$/, '')};
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;
    IF actual IS DISTINCT FROM '${state}' THEN RAISE EXCEPTION 'Expected SQLSTATE %, received %', '${state}', actual; END IF;
  END $test$;`);
}
const attempts = 'commerce."RecoveryOutreachAttempt"';
const messages = 'whatsapp."ConversationMessage"';
const reservations = 'billing."UsageReservation"';
const intents = 'commerce."RecoveryOutreachRetryIntent"';
function seed() {
  sql(`INSERT INTO commerce."Shop" ("id","domain","platform","status","updatedAt") VALUES ('shop','retry.invalid','SHOPIFY','ACTIVE',now());
    INSERT INTO billing."ShopEntitlementCounter" ("id","shopId","counter","grantedQuantity","updatedAt") VALUES ('counter','shop','LIFETIME_FREE_RECOVERY_CREDITS',1,now());
    INSERT INTO commerce."CheckoutRecovery" ("id","shopId","checkoutToken","status","lastExternalActivityAt","updatedAt") VALUES ('recovery','shop','checkout','MESSAGE_SENT','2026-11-25T11:00:00',now());
    INSERT INTO whatsapp."Conversation" ("id","checkoutRecoveryId","type","updatedAt") VALUES ('conversation','recovery','RECOVERY',now());
    INSERT INTO ${messages} ("id","conversationId","direction","senderType","status","content","providerMessageId","providerFailureCode","sentAt","failedAt") VALUES ('message','conversation','OUTBOUND','AUTOMATION','FAILED','test','wamid-fixture','131049','2026-11-25T11:32:40','2026-11-25T11:32:42');
    INSERT INTO ${attempts} ("id","checkoutRecoveryId","sequence","trigger","status","configuredOfferMode","recipient","outboundMessageId","sentAt","closedAt","updatedAt") VALUES ('attempt','recovery',1,'INITIAL','FAILED','NONE','15551234567','message','2026-11-25T11:32:40','2026-11-25T11:32:42',now());
    INSERT INTO ${reservations} ("id","shopId","counterId","sourceKey","quantity","status","updatedAt") VALUES ('reservation','shop','counter','recovery:shop:recovery-outreach:attempt',1,'RELEASED',now());`);
}
const snapshot = () => [attempts, messages, reservations].map(table => JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM ${table} t;`)));
const insert = ({ id = 'intent', attempt = 'attempt', message = 'message', reservation = 'reservation', policy = 'PROVIDER_POLICY_HOLD', due = "'2026-11-26T11:32:42Z'", generation = 1 } = {}) =>
  `INSERT INTO ${intents} ("id","failedAttemptId","failedMessageId","fundingReservationId","providerFailureCode","policy","notBeforeAt","expectedGeneration","expectedLastExternalActivityAt","updatedAt") VALUES ('${id}','${attempt}','${message}','${reservation}','131049','${policy}',${due},${generation},'2026-11-25T11:00:00',now())`;
let started = false;
try {
  docker(['run', '--detach', '--name', container, '--network', 'none', '--env', 'POSTGRES_PASSWORD=fixture-only', '--env', `POSTGRES_DB=${database}`, 'pgvector/pgvector:pg17']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if (sql('SELECT 1;') === '1') { ready = true; break; } } catch { /* permanent server not ready */ }
    await delay(500);
  }
  assert.ok(ready, 'Disposable PostgreSQL failed to start');
  const names = readdirSync(directory).filter(name => /^\d{14}_/.test(name) && name <= migration).sort();
  assert.ok(names.includes(migration));
  for (const name of names.filter(name => name !== migration)) apply(name);
  let before;
  if (mode === 'upgrade') { seed(); before = snapshot(); }
  apply(migration);
  if (mode === 'upgrade') assert.deepEqual(snapshot(), before, 'Migration must not rewrite old attempts/messages/reservations');
  else seed();
  assert.equal(sql(`SELECT count(*) FROM ${intents}`), '0', 'No historical automatic retry backfill');
  const original = snapshot();
  expectState(insert({ policy: 'AFTER_COOLDOWN', due: 'NULL' }), '23514');
  expectState(insert({ policy: 'DO_NOT_RETRY' }), '23514');
  expectState(insert({ generation: 0 }), '23514');
  expectState(insert({ attempt: 'missing' }), '23503');
  expectState(insert({ message: 'missing' }), '23503');
  expectState(insert({ reservation: 'missing' }), '23503');
  sql(insert());
  expectState(insert({ id: 'duplicate' }), '23505');
  // Legacy slot uniqueness is deliberately unchanged until all consumers migrate.
  expectState(`INSERT INTO ${attempts} ("id","checkoutRecoveryId","sequence","trigger","configuredOfferMode","recipient","updatedAt") VALUES ('duplicate-attempt','recovery',1,'INITIAL','NONE','15551234567',now())`, '23505');
  assert.deepEqual(snapshot(), original);
  assert.equal(sql(`SELECT count(*) FROM ${intents}`), '1');
  sql(`UPDATE ${intents} SET "cancelledAt"=now(),"updatedAt"=now() WHERE "id"='intent';`);
  assert.equal(sql(`SELECT count(*) FROM ${intents} WHERE "cancelledAt" IS NOT NULL`), '1');
  sql(`DELETE FROM ${reservations} WHERE "id"='reservation';`);
  assert.equal(sql(`SELECT count(*) FROM ${intents}`), '0', 'Retry intent is removed with its source');
  console.log(`PASS recovery outreach retry intent PostgreSQL ${mode}`);
} finally {
  if (started) { docker(['rm', '--force', '--volumes', container]); console.log(`CLEANUP ${container}`); }
}
