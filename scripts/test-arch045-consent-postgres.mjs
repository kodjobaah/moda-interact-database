import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable PostgreSQL/pgvector fixture: exercises DB guarantees, not Woo
// server/session cryptographic proof or published Shared phone canonicalisation.
const mode = process.argv.at(process.argv.indexOf('--mode') + 1);
assert.ok(['fresh', 'upgrade'].includes(mode), 'pass --mode fresh or --mode upgrade');
const target = '20261021170000_arch045_shared_woo_consent_privacy';
const container = `moda-arch045-db002-${randomUUID()}`;
const database = 'arch045_consent_fixture';
const docker = (args, options = {}) => execFileSync('docker', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
});
const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-U', 'postgres', '-d', database];
const psql = sql => docker(psqlArgs, { input: sql }).trim();
const scalar = sql => psql(sql).split('\n').at(-1)?.trim() ?? '';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const digest = chars => `decode(repeat('${chars}',32),'hex')`;
const rejected = (label, sql) => {
  try { psql(sql); } catch (e) {
    assert.match(String(e.stderr), /ERROR:/, `${label}: expected PostgreSQL ERROR`);
    return;
  }
  assert.fail(`${label}: PostgreSQL unexpectedly accepted the write`);
};
const number = sql => Number(scalar(sql));
const table = {
  shop: '"commerce"."Shop"', customer: '"commerce"."Customer"',
  phone: '"commerce"."CustomerPhone"',
  installation: '"woocommerce"."WooCommerceInstallation"',
  identity: '"woocommerce"."WooCheckoutCustomerIdentity"',
  evidence: '"woocommerce"."WooWhatsAppConsentEvidence"',
  reach: '"whatsapp"."WhatsAppRecipientReachability"',
  fence: '"commerce"."CustomerPrivacyErasureFence"',
};
function seed() {
  psql(`INSERT INTO ${table.shop} ("id","domain","platform","updatedAt") VALUES
    ('woo-shop','https://woo.test','WOOCOMMERCE',now()),
    ('other-shop','https://woo-other.test','WOOCOMMERCE',now()),
    ('shopify-shop','shopify-consent.myshopify.com','SHOPIFY',now());
    INSERT INTO ${table.customer} ("id","shopId","phone","email","firstName","shopifyCustomerId","updatedAt") VALUES
    ('woo-customer','woo-shop','07911123456','customer@example.invalid','Test',NULL,now()),
    ('woo-other-customer','woo-shop',NULL,NULL,NULL,NULL,now()),
    ('other-customer','other-shop',NULL,NULL,NULL,NULL,now()),
    ('shopify-customer','shopify-shop',NULL,NULL,NULL,'gid://shopify/Customer/123',now());
    INSERT INTO ${table.phone} ("id","customerId","phone","updatedAt") VALUES
    ('woo-phone','woo-customer','07911123456',now()),
    ('woo-phone-history','woo-customer','07900000000',now()),
    ('other-phone','woo-other-customer','07911123456',now()),
    ('other-shop-phone','other-customer','07911123456',now());
    UPDATE ${table.phone} SET "endedAt"=now()-interval '1 day'
      WHERE "id"='woo-phone-history';
    INSERT INTO ${table.installation} ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES
    ('woo-installation','woo-shop','https://woo.test',${digest('12')},now()),
    ('other-installation','other-shop','https://woo-other.test',${digest('34')},now());
    INSERT INTO ${table.reach} ("id","shopId","recipient","updatedAt") VALUES
    ('recipient-stop','woo-shop','447911123456',now());`);
}
function defaults() {
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='woo-phone'`), 'UNKNOWN');
  assert.equal(scalar(`SELECT "whatsappConsentMode"::text FROM ${table.installation} WHERE "id"='woo-installation'`), 'NOT_CONFIGURED');
  assert.equal(scalar(`SELECT "whatsappCanonicalPhone" IS NULL FROM ${table.phone} WHERE "id"='woo-phone'`), 't');
  assert.equal(scalar(`SELECT "permanentNoContact" FROM ${table.reach} WHERE "id"='recipient-stop'`), 'f');
  assert.equal(number(`SELECT count(*) FROM ${table.evidence}`), 0);
  rejected('unverified raw local recipient cannot receive a grant', `UPDATE ${table.phone} SET "whatsappConsentDecision"='GRANTED', "whatsappConsentRevision"=1 WHERE "id"='woo-phone';`);
  console.log('PASS default deny, raw legacy phone, no opted-in migration');
}
function activate() {
  psql(`UPDATE ${table.customer} SET
    "verifiedPrincipalDigest"=${digest('ab')}, "verifiedPrincipalPlatform"='WOOCOMMERCE'
    WHERE "id"='woo-customer';
    UPDATE ${table.customer} SET
    "verifiedPrincipalDigest"=${digest('ef')}, "verifiedPrincipalPlatform"='WOOCOMMERCE'
    WHERE "id"='other-customer';
    UPDATE ${table.installation} SET "whatsappConsentMode"='MODA_CHECKBOX',
    "whatsappConsentSourceEpoch"=1, "whatsappConsentSourceRevision"=1 WHERE "id"='woo-installation';`);
  rejected('changing source without epoch increment', `UPDATE ${table.installation}
    SET "whatsappConsentMode"='NOT_CONFIGURED' WHERE "id"='woo-installation';`);
  // Advance the revision even on rejected candidates: otherwise the revision
  // trigger (rather than the format constraint) would be the only reason to fail.
  rejected('invalid national canonical', `UPDATE ${table.phone} SET "whatsappCanonicalPhone"='07911123456',
    "whatsappConsentRevision"=1 WHERE "id"='other-phone';`);
  rejected('plus prefix forbidden in canonical digit store', `UPDATE ${table.phone}
    SET "whatsappCanonicalPhone"='+447911123456', "whatsappConsentRevision"=1
    WHERE "id"='other-phone';`);
  psql(`UPDATE ${table.phone} SET
    "whatsappCanonicalPhone"='447911123456',
    "whatsappPhoneVerifiedAt"=now()-interval '10 seconds',
    "whatsappConsentDecision"='GRANTED', "whatsappConsentSource"='WOO_MODA_CHECKBOX',
    "whatsappConsentSourceEpoch"=1,
    "whatsappConsentProviderObservedAt"=now()-interval '2 seconds',
    "whatsappConsentVerifiedAt"=now()-interval '1 second',
    "whatsappConsentRevision"=1,"whatsappConsentDecisionSequence"=1
    WHERE "id"='woo-phone';
    -- Another customer (same shop AND phone) does not inherit permission.
    UPDATE ${table.phone} SET "whatsappCanonicalPhone"='447911123456',
      "whatsappPhoneVerifiedAt"=now(),"whatsappConsentRevision"=1
      WHERE "id"='other-phone';`);
  assert.equal(scalar(`SELECT "whatsappConsentDecision"::text FROM ${table.phone} WHERE "id"='other-phone'`), 'UNKNOWN');
  rejected('one active verified phone per customer', `UPDATE ${table.phone}
    SET "endedAt"=NULL,"whatsappCanonicalPhone"='447922222222',
      "whatsappConsentRevision"=1
    WHERE "id"='woo-phone-history';`);
  rejected('cross-platform permission', `UPDATE ${table.phone} SET
    "whatsappCanonicalPhone"='447900000000',"whatsappPhoneVerifiedAt"=now(),
    "whatsappConsentDecision"='GRANTED', "whatsappConsentSource"='SHOPIFY_NATIVE',
    "whatsappConsentProviderObservedAt"=now(),"whatsappConsentVerifiedAt"=now(),
    "whatsappConsentRevision"=1,"whatsappConsentDecisionSequence"=1
    WHERE "id"='other-shop-phone';`);
  console.log('PASS verified canonical scope, source, active phone uniqueness, cross-customer isolation');
}
function checkoutIdentity() {
  const insert = (id, shop, installation, customer, generation, kind, principal) =>
    `INSERT INTO ${table.identity} ("id","shopId","installationId","customerId",
      "principalKind","principalDigest","sessionGeneration","checkoutKeyDigest",
      "verifiedAt","expiresAt","updatedAt") VALUES
      (${quote(id)},${quote(shop)},${quote(installation)},${quote(customer)},
      ${quote(kind)},${digest(principal)},${generation},${digest('56')},
      now()-interval '1 minute',now()+interval '4 minutes',now());`;
  psql(insert('woo-guest-binding','woo-shop','woo-installation','woo-customer',1,'GUEST_SESSION','ab'));
  rejected('cross-shop customer binding', insert('wrong-shop','other-shop','other-installation','woo-customer',1,'GUEST_SESSION','cd'));
  psql(insert('same-checkout-other-shop','other-shop','other-installation','other-customer',1,'ACCOUNT','ef'));
  rejected('same checkout reused for another active session', insert('takeover','woo-shop','woo-installation','woo-other-customer',1,'GUEST_SESSION','ef'));
  rejected('cannot mutate signed/hashed binding', `UPDATE ${table.identity} SET "customerId"='woo-other-customer'
    WHERE "id"='woo-guest-binding';`);
  console.log('PASS guest/account binding, cross-shop and takeover isolation, no raw session/checkout keys');
}
function evidence() {
  const statement = (id, event, d, phoneRevision, decision, sequence, identity = 'woo-guest-binding') =>
    `INSERT INTO ${table.evidence} ("id","shopId","installationId","eventId","payloadDigest",
      "customerId","customerPhoneId","checkoutIdentityId","canonicalPhone","decision",
      "sourceMode","sourceEpoch","sourceRevision","decisionSequence","phoneConsentRevision",
      "disclosureText","disclosureVersion","disclosureLocale","verifiedCheckoutKeyDigest") VALUES
      (${quote(id)},'woo-shop','woo-installation',${quote(event)},${digest(d)},
      'woo-customer','woo-phone',${quote(identity)},'447911123456',${quote(decision)},
      'MODA_CHECKBOX',1,1,${sequence},${phoneRevision},
      'Receive abandoned checkout updates on WhatsApp?','v1','en-GB',${digest('56')});`;
  psql(statement('evidence-grant','evt-grant','aa',1,'GRANT',1));
  // The writer must SELECT and compare payloadDigest when ON CONFLICT DO NOTHING
  // returns zero: identical replay is idempotent, changed body is a conflict.
  // Reuse the full authenticated fact for an idempotent event retry.
  const duplicateGrant = statement('dup-id','evt-grant','aa',1,'GRANT',1)
    .replace(/;$/, ' ON CONFLICT ("shopId","eventId") DO NOTHING RETURNING 1;');
  assert.equal(number(duplicateGrant), 0);
  assert.equal(scalar(`SELECT "payloadDigest"=${digest('aa')} FROM ${table.evidence}
    WHERE "shopId"='woo-shop' AND "eventId"='evt-grant'`), 't');
  rejected('same ID changed payload', statement('conflicting-id','evt-grant','bb',1,'GRANT',1));
  rejected('ordinary UPDATE immutable', `UPDATE ${table.evidence} SET "decision"='REVOKE'
    WHERE "id"='evidence-grant';`);
  rejected('ordinary DELETE immutable', `DELETE FROM ${table.evidence} WHERE "id"='evidence-grant';`);
  rejected('wrong customer/phone evidence association', statement('wrong-phone','evt-bad','aa',1,'GRANT',1,'same-checkout-other-shop'));
  psql(`UPDATE ${table.phone} SET "whatsappConsentDecision"='REVOKED',
    "whatsappConsentRevision"=2,"whatsappConsentDecisionSequence"=2,
    "whatsappConsentProviderObservedAt"=now()-interval '1 second',
    "whatsappConsentVerifiedAt"=now()
    WHERE "id"='woo-phone';`);
  psql(statement('evidence-revoke','evt-revoke','cc',2,'REVOKE',2));
  // The same event remains idempotent after the current state has moved on;
  // a different payload digest can never overwrite the recorded grant.
  assert.equal(number(duplicateGrant), 0, 'identical grant retry must be a no-op after revoke');
  rejected('changed grant payload after revoke',
    statement('replayed-changed-grant','evt-grant','bb',1,'GRANT',1));
  rejected('old separately identified GRANT after withdrawal', `UPDATE ${table.phone} SET
    "whatsappConsentDecision"='GRANTED',"whatsappConsentRevision"=3,
    "whatsappConsentDecisionSequence"=1 WHERE "id"='woo-phone';`);
  psql(`UPDATE ${table.identity} SET "revokedAt"=now() WHERE "id"='woo-guest-binding';`);
  rejected('revoked guest cannot reactivate', `UPDATE ${table.identity}
    SET "revokedAt"=NULL WHERE "id"='woo-guest-binding';`);
  psql(`INSERT INTO ${table.identity} ("id","shopId","installationId","customerId",
    "principalKind","principalDigest","sessionGeneration","checkoutKeyDigest",
    "verifiedAt","expiresAt","updatedAt") VALUES
    ('rotated-guest-binding','woo-shop','woo-installation','woo-customer',
    'GUEST_SESSION',${digest('ab')},2,${digest('56')},now(),now()+interval '4 minutes',now());`);
  rejected('revoked checkout evidence cannot bind to old session',
    statement('old-session-replay','evt-old-session','ee',2,'REVOKE',2));
  console.log('PASS atomic source/decision revision, immutable evidence, guest rotation and event replay/digest contract');
}
async function concurrentCas() {
  const sql = `UPDATE ${table.phone} SET "whatsappConsentRevision"=3,
    "whatsappConsentDecisionSequence"=3,
    "whatsappConsentVerifiedAt"=now()+interval '1 second',
    "whatsappConsentProviderObservedAt"=now()+interval '1 second'
    WHERE "id"='woo-phone' AND "whatsappConsentRevision"=2 RETURNING 1;`;
  const competitor = () => new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', c => out += c);
    child.stderr.on('data', c => err += c);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out.trim() ? 1 : 0) : reject(new Error(err)));
    child.stdin.end(sql);
  });
  const [a, b] = await Promise.all([competitor(), competitor()]);
  assert.equal(a + b, 1, 'only one update can win revision 2');
  assert.equal(number(`SELECT "whatsappConsentRevision" FROM ${table.phone} WHERE "id"='woo-phone'`), 3);
  console.log('PASS concurrent CAS: one writer wins, no lost update');
}
function stopAndEpoch() {
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=TRUE,
    "whatsappNoContactReason"='MERCHANT_OPT_OUT',
    "whatsappNoContactAt"=now()+interval '3 seconds',
    "whatsappNoContactRevision"=1 WHERE "id"='woo-phone';
    UPDATE ${table.reach} SET "permanentNoContact"=TRUE,
    "permanentNoContactReason"='CUSTOMER_STOP',
    "permanentNoContactAt"=now()+interval '4 seconds',
    "permanentNoContactRevision"=1 WHERE "id"='recipient-stop';`);
  rejected('local STOP cannot be cleared by old consent', `UPDATE ${table.phone}
    SET "whatsappNoContact"=FALSE,"whatsappNoContactRevision"=2 WHERE "id"='woo-phone';`);
  rejected('unbound STOP cannot be cleared without later exact grant', `UPDATE ${table.reach}
    SET "permanentNoContact"=FALSE,"permanentNoContactRevision"=2,
      "permanentNoContactClearedAt"=now()+interval '6 seconds' WHERE "id"='recipient-stop';`);
  psql(`UPDATE ${table.phone} SET "whatsappNoContact"=FALSE,
    "whatsappNoContactRevision"=2,"whatsappNoContactClearedAt"=now()+interval '7 seconds',
    "whatsappConsentDecision"='GRANTED', "whatsappConsentRevision"=4,
    "whatsappConsentDecisionSequence"=4,
    "whatsappConsentProviderObservedAt"=now()+interval '5 seconds',
    "whatsappConsentVerifiedAt"=now()+interval '6 seconds'
    WHERE "id"='woo-phone';
    UPDATE ${table.reach} SET "permanentNoContact"=FALSE,
      "permanentNoContactRevision"=2,
      "permanentNoContactClearedAt"=now()+interval '7 seconds' WHERE "id"='recipient-stop';`);
  assert.equal(scalar(`SELECT "permanentNoContact" FROM ${table.reach} WHERE "id"='recipient-stop'`), 'f');
  psql(`UPDATE ${table.installation} SET "whatsappConsentMode"='NOT_CONFIGURED',
    "whatsappConsentSourceEpoch"=2,"whatsappConsentSourceRevision"=2 WHERE "id"='woo-installation';
    UPDATE ${table.installation} SET "whatsappConsentMode"='MODA_CHECKBOX',
    "whatsappConsentSourceEpoch"=3,"whatsappConsentSourceRevision"=3 WHERE "id"='woo-installation';`);
  rejected('A-B-A source epochs invalidate grant even if mode matches', `UPDATE ${table.phone}
    SET "whatsappConsentRevision"=5,"whatsappConsentDecisionSequence"=5,
    "whatsappConsentProviderObservedAt"=now()+interval '8 seconds'
    WHERE "id"='woo-phone';`);
  console.log('PASS STOP precedence, unbound negative-only protection, newer opt-in and source ABA');
}
function privacy() {
  const erase = `BEGIN;
    SELECT "commerce".arch045_lock_verified_principal('woo-shop','WOOCOMMERCE',${digest('ab')});
    INSERT INTO ${table.fence} ("id","shopId","platform","principalDigest","rejectedThroughAt")
    VALUES ('fence-woo','woo-shop','WOOCOMMERCE',${digest('ab')},now());
    UPDATE ${table.evidence} SET "customerId"=NULL,"customerPhoneId"=NULL,
      "checkoutIdentityId"=NULL,"canonicalPhone"=NULL,
      "providerId"=NULL,"providerOccurredAt"=NULL,
      "disclosureText"=NULL,"disclosureVersion"=NULL,"disclosureLocale"=NULL,
      "verifiedCheckoutKeyDigest"=NULL,"redactedAt"=now()+interval '1 second'
      WHERE "shopId"='woo-shop';
    UPDATE ${table.customer} SET "phone"=NULL,"email"=NULL,"firstName"=NULL,
      "lastName"=NULL,"shopifyCustomerId"=NULL,
      "verifiedPrincipalDigest"=NULL,"verifiedPrincipalPlatform"=NULL,"privacyErasedAt"=now(),
      "privacyRevision"=1 WHERE "id"='woo-customer';
    UPDATE ${table.phone} SET "phone"=NULL,"whatsappCanonicalPhone"=NULL,
      "whatsappPhoneVerifiedAt"=NULL,"whatsappConsentDecision"='UNKNOWN',
      "whatsappConsentSource"=NULL,"whatsappConsentProviderId"=NULL,
      "whatsappConsentSourceEpoch"=NULL,"whatsappConsentProviderObservedAt"=NULL,
      "whatsappConsentVerifiedAt"=NULL,"whatsappConsentRevision"="whatsappConsentRevision"+1,
      "whatsappNoContact"=FALSE,"whatsappNoContactReason"=NULL,"whatsappNoContactAt"=NULL,
      "whatsappNoContactRevision"="whatsappNoContactRevision"+1,
      "whatsappNoContactClearedAt"=NULL
      WHERE "customerId"='woo-customer';
    DELETE FROM ${table.identity} WHERE "customerId"='woo-customer';
    COMMIT;`;
  psql(erase);
  assert.equal(number(`SELECT count(*) FROM ${table.phone}
    WHERE "customerId"='woo-customer' AND ("phone" IS NOT NULL OR "whatsappCanonicalPhone" IS NOT NULL
      OR "whatsappConsentSource" IS NOT NULL OR "whatsappNoContactReason" IS NOT NULL)`), 0);
  assert.equal(number(`SELECT count(*) FROM ${table.evidence} WHERE "shopId"='woo-shop' AND
    "redactedAt" IS NULL`), 0);
  assert.equal(number(`SELECT count(*) FROM ${table.identity} WHERE "shopId"='woo-shop'`), 0);
  rejected('no rehydration on old Customer row', `UPDATE ${table.phone} SET "phone"='447911123456'
    WHERE "id"='woo-phone';`);
  rejected('no new raw contact row on erased Customer', `INSERT INTO ${table.phone}
    ("id","customerId","phone","updatedAt") VALUES ('late-phone','woo-customer','447911123456',now());`);
  rejected('no PII on erased Customer', `UPDATE ${table.customer} SET "phone"='447911123456'
    WHERE "id"='woo-customer';`);
  rejected('no provider metadata restored on erased phone', `UPDATE ${table.phone}
    SET "whatsappConsentProviderId"='restored-provider',"whatsappConsentRevision"="whatsappConsentRevision"+1
    WHERE "id"='woo-phone';`);
  rejected('no phone verification restored on erased phone', `UPDATE ${table.phone}
    SET "whatsappPhoneVerifiedAt"=now(),"whatsappConsentRevision"="whatsappConsentRevision"+1
    WHERE "id"='woo-phone';`);
  rejected('erasure fence cannot roll back cutoff', `UPDATE ${table.fence}
    SET "revision"=0 WHERE "id"='fence-woo';`);
  rejected('erased verified principal cannot create another Customer', `INSERT INTO ${table.customer}
    ("id","shopId","verifiedPrincipalDigest","verifiedPrincipalPlatform","updatedAt")
    VALUES ('rehydrated-customer','woo-shop',${digest('ab')},'WOOCOMMERCE',now());`);
  rejected('old erased guest session cannot be rebound to another customer', `INSERT INTO ${table.identity}
    ("id","shopId","installationId","customerId","principalKind",
     "principalDigest","checkoutKeyDigest","verifiedAt","expiresAt","updatedAt")
    VALUES ('rehydrated-guest','woo-shop','woo-installation','woo-other-customer',
      'GUEST_SESSION',${digest('ab')},${digest('56')},now(),now()+interval '1 day',now());`);
  psql(`INSERT INTO ${table.customer}
    ("id","shopId","verifiedPrincipalDigest","verifiedPrincipalPlatform","updatedAt")
    VALUES ('new-customer-lifecycle','woo-shop',${digest('cd')},'WOOCOMMERCE',now());`);
  rejected('redacted evidence cannot be repopulated', `UPDATE ${table.evidence}
    SET "canonicalPhone"='447911123456' WHERE "id"='evidence-grant';`);
  rejected('old event replay denied for erased Customer', `INSERT INTO ${table.evidence}
    ("id","shopId","installationId","eventId","payloadDigest","customerId",
     "customerPhoneId","canonicalPhone","decision","sourceMode","sourceEpoch",
     "sourceRevision","decisionSequence","phoneConsentRevision","disclosureText",
     "disclosureVersion","disclosureLocale") VALUES
     ('late-evidence','woo-shop','woo-installation','late-event',${digest('ab')},'woo-customer',
      'woo-phone','447911123456','GRANT','MODA_CHECKBOX',3,3,5,5,'yes','v1','en-GB');`);
  console.log('PASS privacy: active + historical erasure, one-way evidence anonymisation, late writer denial');
}
async function erasureRace() {
  // Principal locks and the Customer row prevent a regrant while an erasure
  // with no previously existing fence is in flight.
  psql(`INSERT INTO ${table.customer} ("id","shopId","phone",
    "verifiedPrincipalDigest","verifiedPrincipalPlatform","updatedAt")
    VALUES ('race-customer','woo-shop','07911123456',${digest('88')},'WOOCOMMERCE',now());
    INSERT INTO ${table.phone} ("id","customerId","phone","updatedAt")
    VALUES ('race-phone','race-customer','07911123456',now());`);
  const eraser = `BEGIN;
    SELECT "commerce".arch045_lock_verified_principal('woo-shop','WOOCOMMERCE',${digest('88')});
    INSERT INTO ${table.fence} ("id","shopId","platform","principalDigest","rejectedThroughAt")
      VALUES ('race-fence','woo-shop','WOOCOMMERCE',${digest('88')},now());
    UPDATE ${table.customer} SET "phone"=NULL,"verifiedPrincipalDigest"=NULL,
      "verifiedPrincipalPlatform"=NULL,"privacyErasedAt"=now(),"privacyRevision"=1
      WHERE "id"='race-customer';
    SELECT "id" FROM ${table.phone} WHERE "id"='race-phone' FOR UPDATE;
    SELECT pg_sleep(0.3);
    UPDATE ${table.phone} SET "phone"=NULL WHERE "id"='race-phone';
    COMMIT;`;
  const lateGrant = `BEGIN;
    SELECT pg_sleep(0.1);
    -- Production writers must acquire the verified-principal and Customer
    -- locks before updating CustomerPhone (the same order as erasure).
    SELECT "commerce".arch045_lock_verified_principal('woo-shop','WOOCOMMERCE',${digest('88')});
    SELECT "id" FROM ${table.customer} WHERE "id"='race-customer'
      AND "privacyErasedAt" IS NULL FOR SHARE;
    UPDATE ${table.phone} SET "whatsappCanonicalPhone"='447911123456',
      "whatsappPhoneVerifiedAt"=now(),"whatsappConsentDecision"='GRANTED',
      "whatsappConsentSource"='WOO_MODA_CHECKBOX',"whatsappConsentSourceEpoch"=3,
      "whatsappConsentProviderObservedAt"=now(),"whatsappConsentVerifiedAt"=now(),
      "whatsappConsentRevision"=1,"whatsappConsentDecisionSequence"=1
      WHERE "id"='race-phone';
    COMMIT;`;
  const concurrent = sql => new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => stderr += chunk);
    child.stdout.resume();
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr }));
    child.stdin.end(sql);
  });
  const [erased, stale] = await Promise.all([concurrent(eraser), concurrent(lateGrant)]);
  assert.equal(erased.code, 0, `erasure transaction should commit: ${erased.stderr}`);
  assert.notEqual(stale.code, 0, 'concurrent stale consent must not resurrect erased customer');
  assert.equal(scalar(`SELECT "phone" IS NULL AND "whatsappCanonicalPhone" IS NULL
    FROM ${table.phone} WHERE "id"='race-phone'`), 't');
  console.log('PASS erasure versus concurrent Woo regrant, no after-erasure PII');
}
async function run() {
  let started = false;
  try {
    docker(['run','-d','--name',container,'--network','none',
      '-e','POSTGRES_PASSWORD=arch045-test','-e',`POSTGRES_DB=${database}`,'pgvector/pgvector:pg17']);
    started = true;
    // The PostgreSQL image uses a socket-only temporary server for initdb.
    // Only the final PostgreSQL server accepts TCP, so a socket readiness
    // check can falsely pass immediately before the temporary server exits.
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try { docker(['exec',container,'pg_isready','-q','-h','127.0.0.1','-U','postgres','-d',database]); ready = true; break; }
      catch { await delay(1000); }
    }
    assert.ok(ready, 'PostgreSQL final TCP server did not become ready');
    const migrationNames = readdirSync(new URL('../prisma/migrations/', import.meta.url))
      .filter(n => /^\d{14}_/.test(n)).sort();
    assert.equal(migrationNames.at(-1), target, 'unexpected migration order');
    for (const name of migrationNames) {
      if (name === target && mode === 'upgrade') seed();
      psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
    }
    if (mode === 'fresh') seed();
    defaults(); activate(); checkoutIdentity(); evidence(); await concurrentCas(); stopAndEpoch(); privacy();
    await erasureRace();
    console.log(`PASS ARCH-045-DATABASE-002 PostgreSQL ${mode} (${migrationNames.length} migrations)`);
  } finally {
    if (started) docker(['rm','-f',container], { stdio: 'ignore' });
  }
}
await run();
