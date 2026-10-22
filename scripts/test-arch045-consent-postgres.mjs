import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable, isolated pgvector/PostgreSQL integration fixture. No connection
// to developer or production DB. HTTP/API caller authentication and the Shared
// country-aware phone normaliser are separate consumer-owned validations.
const mode = process.argv.at(process.argv.indexOf('--mode') + 1);
assert.ok(['fresh', 'upgrade'].includes(mode), 'pass --mode fresh or --mode upgrade');
const target = '20261021170000_arch045_shared_woo_consent_privacy';
const container = `moda-arch045-db002-${randomUUID()}`;
const database = 'arch045_consent_fixture';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q',
  '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', database];
const psql = sql => docker(psqlArgs, { input: sql }).trim();
const scalar = sql => psql(sql).split('\n').at(-1)?.trim() ?? '';
const number = sql => Number(scalar(sql));
const digest = chars => `decode(repeat('${chars}',32),'hex')`;
const rejected = (label, sql) => {
  try { psql(sql); } catch (error) {
    assert.match(String(error.stderr), /ERROR:/, `${label}: expected PostgreSQL rejection`);
    return;
  }
  assert.fail(`${label}: PostgreSQL unexpectedly accepted write`);
};
const table = {
  shop: '"commerce"."Shop"', customer: '"commerce"."Customer"',
  phone: '"commerce"."CustomerPhone"',
  installation: '"woocommerce"."WooCommerceInstallation"',
  evidence: '"commerce"."WhatsAppConsentEvidence"',
  reach: '"whatsapp"."WhatsAppRecipientReachability"',
  recovery: '"commerce"."CheckoutRecovery"',
  usage: '"billing"."UsageEvent"',
};
function seed() {
  psql(`INSERT INTO ${table.shop} ("id","domain","platform","updatedAt") VALUES
    ('woo-shop','https://woo.test','WOOCOMMERCE',now()),
    ('other-shop','https://woo-other.test','WOOCOMMERCE',now()),
    ('shopify-shop','shopify-test.myshopify.com','SHOPIFY',now());
    INSERT INTO ${table.customer} ("id","shopId","phone","updatedAt") VALUES
    ('woo-customer','woo-shop','07911123456',now()),
    ('woo-ambiguous','woo-shop','07911123456',now()),
    ('woo-unknown','woo-shop','07922111111',now()),
    ('other-customer','other-shop','07911123456',now()),
    ('shopify-customer','shopify-shop','07911123456',now());
    INSERT INTO ${table.phone} ("id","customerId","phone","updatedAt") VALUES
    ('woo-phone','woo-customer','07911123456',now()),
    ('woo-duplicate','woo-ambiguous','07911123456',now()),
    ('woo-unknown-phone','woo-unknown','07922111111',now()),
    ('other-phone','other-customer','07911123456',now()),
    ('shopify-phone','shopify-customer','07911123456',now());
    INSERT INTO ${table.installation} ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES
    ('woo-installation','woo-shop','https://woo.test',${digest('12')},now()),
    ('other-installation','other-shop','https://woo-other.test',${digest('34')},now());`);
}
function structureAndDefaults() {
  assert.equal(number(`SELECT count(*) FROM information_schema.tables WHERE table_schema='commerce' AND table_name='WhatsAppConsentEvidence'`), 1);
  assert.equal(number(`SELECT count(*) FROM information_schema.tables WHERE table_name IN (
    'WooWhatsAppConsentEvidence','WooCheckoutCustomerIdentity','CustomerPrivacyErasureFence')`), 0);
  assert.equal(number(`SELECT count(*) FROM information_schema.columns WHERE
    (table_schema='commerce' AND table_name='Customer' AND column_name IN ('privacyErasedAt','verifiedPrincipalDigest','verifiedPrincipalPlatform','privacyRevision'))
    OR (table_schema='woocommerce' AND table_name='WooCommerceInstallation' AND column_name LIKE 'whatsappConsent%')
    OR (table_schema='whatsapp' AND table_name='WhatsAppRecipientReachability' AND column_name LIKE 'permanentNoContact%')`), 0);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'UNKNOWN');
  assert.equal(scalar(`SELECT "whatsappConsentRevision"=0 AND NOT "whatsappNoContact" FROM ${table.phone} WHERE "id"='woo-phone'`), 't');
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 0);
  rejected('no verified recipient means default deny', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentRevision"=1,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='woo-phone';`);
  rejected('local zero-prefix cannot be stored as international canonical', `UPDATE ${table.phone} SET
    "whatsappCanonicalPhone"='07911123456',"whatsappConsentRevision"=1 WHERE "id"='woo-phone';`);
  rejected('plus prefix cannot be stored in digits-only canonical', `UPDATE ${table.phone} SET
    "whatsappCanonicalPhone"='+447911123456',"whatsappConsentRevision"=1 WHERE "id"='woo-phone';`);
  console.log('PASS one-table boundary, no excluded structures, UNKNOWN default, canonical format');
}
function lookupAndIdentity() {
  psql(`UPDATE ${table.phone} SET "whatsappCanonicalPhone"='447911123456',
    "whatsappPhoneVerifiedAt"=now()-interval '10 seconds',"whatsappConsentRevision"=1
    WHERE "id" IN ('woo-phone','woo-duplicate','other-phone','shopify-phone');`);
  const lookup = (shopId, digits) => number(`SELECT count(DISTINCT c."id")
    FROM ${table.phone} cp JOIN ${table.customer} c ON cp."customerId"=c."id"
    WHERE c."shopId"='${shopId}' AND cp."endedAt" IS NULL
      AND cp."whatsappCanonicalPhone"='${digits}'`);
  assert.equal(lookup('woo-shop','447911123456'), 2, 'two matches must be treated as ambiguous by API');
  assert.equal(lookup('other-shop','447911123456'), 1, 'other tenant has its own recipient');
  assert.equal(lookup('woo-shop','447900000000'), 0, 'no match is not consent');
  assert.equal(lookup('woo-shop','447922111111'), 0, 'raw phone is not automatically verified/canonical');
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-duplicate'`), 'UNKNOWN');
  rejected('unique canonical active per Customer', `INSERT INTO ${table.phone}
    ("id","customerId","phone","whatsappCanonicalPhone","updatedAt")
    VALUES ('double-phone','woo-customer','07911123456','447911123456',now());`);
  rejected('Shopify source cannot grant Woo recipient', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentSource"='SHOPIFY_NATIVE',
    "whatsappConsentProviderObservedAt"=now()-interval '2 seconds',
    "whatsappConsentVerifiedAt"=now(),"whatsappConsentRevision"=2,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='woo-phone';`);
  // A confirmed Shopify-native read may update Shopify CustomerPhone directly;
  // there is no Woo audit evidence for a Shopify provider observation.
  psql(`UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentSource"='SHOPIFY_NATIVE',
    "whatsappConsentProviderObservedAt"=now()-interval '2 seconds',
    "whatsappConsentVerifiedAt"=now(),"whatsappConsentRevision"=2,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='shopify-phone';`);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-duplicate'`), 'UNKNOWN');
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 0);
  console.log('PASS shop isolation, one/none/ambiguous lookup, consent distinct from identity, Shopify native');
}
function insertEvidence(id, eventId, digestHex, revision, sequence, decision,
  timestamp = 'now()', phoneId = 'woo-phone', customerId = 'woo-customer', shopId = 'woo-shop', installationId = 'woo-installation', digits = '447911123456') {
  return `INSERT INTO ${table.evidence} (
    "id","shopId","installationId","eventId","payloadDigest",
    "customerId","customerPhoneId","canonicalPhone","decision",
    "decisionSequence","phoneConsentRevision","decisionAt",
    "disclosureText","disclosureVersion","disclosureLocale"
  ) VALUES ('${id}','${shopId}','${installationId}','${eventId}',${digest(digestHex)},
    '${customerId}','${phoneId}','${digits}','${decision}',${sequence},${revision},${timestamp},
    'Optional unchecked WhatsApp checkout recovery consent','v1','en-GB');`;
}
function wooTransaction(id, eventId, digestHex, revision, sequence, decision, timestamp = 'now()') {
  return `BEGIN;
    UPDATE ${table.phone} SET "whatsappConsentDecision"='${decision === 'GRANT' ? 'GRANTED' : 'REVOKED'}',
      "whatsappConsentSource"='WOO_MODA_CHECKBOX',
      "whatsappConsentProviderObservedAt"=${timestamp},
      "whatsappConsentVerifiedAt"=${timestamp},
      "whatsappConsentRevision"=${revision},"whatsappConsentDecisionSequence"=${sequence}
      WHERE "id"='woo-phone';
    ${insertEvidence(id, eventId, digestHex, revision, sequence, decision, timestamp)}
    COMMIT;`;
}
function consentAndEvidence() {
  rejected('Woo current grant without same-transaction evidence', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentSource"='WOO_MODA_CHECKBOX',
    "whatsappConsentProviderObservedAt"=now()-interval '1 second',
    "whatsappConsentVerifiedAt"=now(),"whatsappConsentRevision"=2,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='woo-phone';`);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'UNKNOWN');
  const occurred1 = "now()-interval '1 second'";
  psql(wooTransaction('e-grant','evt-grant','aa',2,1,'GRANT',occurred1));
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'GRANTED');
  assert.equal(number(`SELECT count(*) FROM ${table.evidence} WHERE "shopId"='woo-shop' AND "eventId"='evt-grant'`), 1);
  rejected('wrong tenant cannot use Woo installation and Customer',
    insertEvidence('bad-shop','evt-other-shop','dd',2,1,'GRANT',occurred1,
      'woo-phone','woo-customer','other-shop','other-installation'));
  rejected('wrong CustomerPhone cannot borrow grant',
    insertEvidence('bad-phone','evt-other-phone','dd',2,1,'GRANT',occurred1,
      'woo-duplicate','woo-ambiguous'));
  rejected('evidence cannot change after acceptance', `UPDATE ${table.evidence} SET "decision"='REVOKE' WHERE "id"='e-grant';`);
  rejected('evidence cannot be deleted', `DELETE FROM ${table.evidence} WHERE "id"='e-grant';`);
  psql(wooTransaction('e-revoke','evt-revoke','bb',3,2,'REVOKE',"now()+interval '1 second'"));
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'REVOKED');
  // Both replays happen after phone state has moved to REVOKED.
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 2);
  psql(insertEvidence('another-grant','evt-grant','aa',2,1,'GRANT',occurred1));
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 2, 'identical replay is idempotent');
  rejected('same event ID with conflicting payload digest',
    insertEvidence('conflicting-grant','evt-grant','cc',2,1,'GRANT',occurred1));
  rejected('stale grant sequence rejected', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentRevision"=4,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='woo-phone';`);
  psql(wooTransaction('e-regrant','evt-regrant','dd',4,3,'GRANT',"now()+interval '2 seconds'"));
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 3);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'GRANTED');
  console.log('PASS atomic Woo grant/withdraw/regrant, exact evidence, immutable history, replay');
}
function stopAndInstallation() {
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=TRUE,
    "whatsappNoContactReason"='MERCHANT_OPT_OUT',
    "whatsappNoContactAt"=now(),"whatsappNoContactRevision"=1
    WHERE "id"='woo-phone';`);
  assert.equal(scalar(`SELECT "whatsappNoContact" FROM ${table.phone} WHERE "id"='woo-phone'`), 't');
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=FALSE,
    "whatsappNoContactReason"=NULL,"whatsappNoContactRevision"=2,
    "whatsappNoContactClearedAt"=now()+interval '1 second'
    WHERE "id"='woo-phone';`);
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=TRUE,
    "whatsappNoContactReason"='CUSTOMER_STOP',"whatsappNoContactAt"=now(),
    "whatsappNoContactRevision"=3 WHERE "id"='woo-phone';`);
  rejected('later Shopify or Woo grant cannot clear Customer STOP', `UPDATE ${table.phone} SET
    "whatsappNoContact"=FALSE,"whatsappNoContactReason"=NULL,
    "whatsappNoContactRevision"=4,"whatsappNoContactClearedAt"=now()+interval '1 second'
    WHERE "id"='woo-phone';`);
  rejected('STOP cannot be downgraded to merchant suppression', `UPDATE ${table.phone} SET
    "whatsappNoContactReason"='MERCHANT_OPT_OUT',"whatsappNoContactRevision"=4
    WHERE "id"='woo-phone';`);
  // A revoked installation cannot accept new Woo positive permission or audit.
  psql(`UPDATE ${table.installation} SET "status"='REVOKED',"revokedAt"=now()
    WHERE "id"='woo-installation';`);
  rejected('revoked installation cannot grant', `UPDATE ${table.phone} SET
    "whatsappConsentRevision"=5,"whatsappConsentDecisionSequence"=4,
    "whatsappConsentProviderObservedAt"=now()+interval '3 seconds',
    "whatsappConsentVerifiedAt"=now()+interval '3 seconds'
    WHERE "id"='woo-phone';`);
  psql(`UPDATE ${table.installation} SET "status"='ACTIVE',"revokedAt"=NULL,
    "credentialVersion"="credentialVersion"+1 WHERE "id"='woo-installation';`);
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 3,
    'credential rotation/reconnection must never create affirmative consent or evidence');
  assert.equal(scalar(`SELECT "whatsappNoContact" FROM ${table.phone} WHERE "id"='woo-phone'`), 't',
    'STOP remains after installation reconnection');
  // Revoke without a new matching evidence fact must also roll back.
  rejected('Woo withdrawal needs atomic evidence', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='REVOKED',"whatsappConsentRevision"=5,
    "whatsappConsentDecisionSequence"=4,
    "whatsappConsentProviderObservedAt"=now()+interval '3 seconds',
    "whatsappConsentVerifiedAt"=now()+interval '3 seconds' WHERE "id"='woo-phone';`);
  console.log('PASS customer STOP, merchant suppression, revoked/reconnected installation');
}
function rotationAndSuppression() {
  // Exercise a fresh post-withdrawal opt-in without clearing the customer STOP.
  psql(wooTransaction('e-post-race-regrant','evt-post-race-regrant','11',6,5,'GRANT',
    "now()+interval '5 seconds'"));
  assert.equal(scalar(`SELECT "whatsappNoContact" FROM ${table.phone} WHERE "id"='woo-phone'`), 't');
  // Attempt to transfer the existing consent to a different number is rejected.
  rejected('recipient changed while GRANTED', `UPDATE ${table.phone} SET
    "whatsappCanonicalPhone"='447933333333',"whatsappConsentRevision"=7,
    "whatsappPhoneVerifiedAt"=now() WHERE "id"='woo-phone';`);
  // End the old consent lifecycle by resetting its state. STOP is retained.
  psql(`UPDATE ${table.phone} SET
    "phone"='07933333333',"whatsappCanonicalPhone"='447933333333',
    "whatsappPhoneVerifiedAt"=now(),
    "whatsappConsentDecision"='UNKNOWN',"whatsappConsentSource"=NULL,
    "whatsappConsentProviderObservedAt"=NULL,"whatsappConsentVerifiedAt"=NULL,
    "whatsappConsentRevision"=7,"whatsappConsentDecisionSequence"=6
    WHERE "id"='woo-phone';`);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'UNKNOWN');
  assert.equal(scalar(`SELECT "whatsappNoContact" FROM ${table.phone} WHERE "id"='woo-phone'`), 't');
  rejected('Customer STOP remains irreversible after phone rotation', `UPDATE ${table.phone} SET
    "whatsappNoContact"=FALSE,"whatsappNoContactReason"=NULL,
    "whatsappNoContactRevision"=4 WHERE "id"='woo-phone';`);
  // A merchant suppression on an ungranted CustomerPhone cannot be removed.
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=TRUE,
    "whatsappNoContactReason"='MERCHANT_OPT_OUT',
    "whatsappNoContactAt"=now(),"whatsappNoContactRevision"=1
    WHERE "id"='woo-unknown-phone';`);
  rejected('merchant suppression cannot become grant', `UPDATE ${table.phone} SET
    "whatsappNoContact"=FALSE,"whatsappNoContactReason"=NULL,
    "whatsappNoContactRevision"=2,"whatsappNoContactClearedAt"=now()+interval '1 second'
    WHERE "id"='woo-unknown-phone';`);
  assert.equal(number(`SELECT count(*) FROM ${table.recovery}`), 0);
  assert.equal(number(`SELECT count(*) FROM ${table.usage}`), 0);
  console.log('PASS phone rotation, suppression cannot mint consent, no recovery/credits');
}
async function concurrentConsent() {
  const command = (eventId, digestHex) => `BEGIN;
    UPDATE ${table.phone} SET "whatsappConsentDecision"='REVOKED',
      "whatsappConsentProviderObservedAt"=now()+interval '4 seconds',
      "whatsappConsentVerifiedAt"=now()+interval '4 seconds',
      "whatsappConsentRevision"=5,"whatsappConsentDecisionSequence"=4
      WHERE "id"='woo-phone' AND "whatsappConsentRevision"=4 RETURNING "id";
    ${insertEvidence(`race-${eventId}`, eventId, digestHex, 5, 4, 'REVOKE', "now()+interval '4 seconds'")}
    COMMIT;`;
  // Use a separate, still-current GRANTED Woo recipient, because the earlier
  // rotation fixture deliberately retired woo-phone's old consent state.
  // (Here the concurrency test runs before rotationAndSuppression.)
  const concurrent = sql => new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', error = '';
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => error += c);
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, error }));
    child.stdin.end(sql);
  });
  const [first, second] = await Promise.all([
    concurrent(command('evt-race-a','ee')),
    concurrent(command('evt-race-b','ff')),
  ]);
  assert.equal([first, second].filter(r => r.code === 0).length, 1,
    `exactly one stale-revision contender must commit: ${JSON.stringify([first,second])}`);
  assert.equal(number(`SELECT count(*) FROM ${table.evidence} WHERE "eventId" IN ('evt-race-a','evt-race-b')`), 1);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'REVOKED');
  console.log('PASS concurrent Woo consent transitions: one revision/one evidence wins');
}
async function run() {
  let started = false;
  try {
    docker(['run','-d','--name',container,'--network','none',
      '-e','POSTGRES_PASSWORD=arch045-test','-e',`POSTGRES_DB=${database}`,'pgvector/pgvector:pg17']);
    started = true;
    // TCP is served only by the final postgres instance, not initdb's
    // short-lived socket-only bootstrap server.
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { docker(['exec',container,'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',database]); ready = true; break; }
      catch { await delay(1000); }
    }
    assert.ok(ready, 'disposable PostgreSQL final TCP server did not become ready');
    const migrationNames = readdirSync(new URL('../prisma/migrations/', import.meta.url))
      .filter(n => /^\d{14}_/.test(n)).sort();
    assert.equal(migrationNames.at(-1), target, 'unexpected migration order');
    for (const name of migrationNames) {
      if (name === target && mode === 'upgrade') seed();
      psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    if (mode === 'fresh') seed();
    structureAndDefaults(); lookupAndIdentity(); consentAndEvidence();
    stopAndInstallation(); await concurrentConsent(); rotationAndSuppression();
    console.log(`PASS ARCH-045-DATABASE-002 PostgreSQL ${mode} (${migrationNames.length} migrations)`);
  } finally {
    if (started) docker(['rm','-f',container], { stdio: 'ignore' });
  }
}
await run();
