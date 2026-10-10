import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';

const target = '20261010120000_arch026_woocommerce_rest_read_grant';
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
assert.ok(['fresh', 'upgrade'].includes(mode), 'Pass --mode fresh|upgrade');
const variable = mode === 'fresh' ? 'ARCH026_READ_FRESH_DATABASE_URL' : 'ARCH026_READ_UPGRADE_DATABASE_URL';
const connection = process.env[variable];
assert.ok(connection, `${variable} must point to an EMPTY disposable PostgreSQL fixture database`);
const parsed = new URL(connection);
assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol), 'PostgreSQL is required');
assert.equal(decodeURIComponent(parsed.pathname.slice(1)), `arch026_read_${mode}_fixture`,
  'Refusing to run migrations on a database without the exact disposable fixture name');
const migrations = readdirSync(new URL('../prisma/migrations/', import.meta.url))
  .filter(name => /^\d{14}_/.test(name)).sort();
assert.equal(migrations.at(-1), target);

const psqlArgs = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', connection];
function psql(sql, capture = false) {
  try {
    return execFileSync('psql', capture ? [...psqlArgs.slice(0, -1), '-A', '-t', connection] : psqlArgs,
      {encoding: 'utf8', input: sql, maxBuffer: 32 * 1024 * 1024}).trim();
  } catch (error) {
    throw new Error(`psql failed: ${error.stderr?.trim() ?? error.message}`, {cause: error});
  }
}
function scalar(sql) { return psql(sql, true); }
function rejected(label, sql, code = '23514') {
  try { psql(sql); } catch (error) {
    assert.match(error.message, new RegExp(code), `${label}: unexpected PostgreSQL SQLSTATE`);
    console.log(`PASS ${label}`);
    return;
  }
  assert.fail(`Expected rejection: ${label}`);
}
function applyMigration(name) {
  psql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  console.log(`APPLIED ${name}`);
}
const sha = n => `decode(repeat('${n.toString(16).padStart(2, '0')}',32),'hex')`;
function shops() {
  psql(`INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES
    ('woo-read-shop','read-shop.arch026.invalid','WOOCOMMERCE',now()),
    ('woo-read-other','read-other.arch026.invalid','WOOCOMMERCE',now()),
    ('woo-read-shopify','shopify.arch026.invalid','SHOPIFY',now());
  INSERT INTO woocommerce."WooCommerceInstallation"
    ("id","shopId","canonicalSiteUrl","credentialDigest","updatedAt") VALUES
    ('woo-read-install','woo-read-shop','https://read-shop.arch026.invalid',${sha(11)},now()),
    ('woo-read-other-install','woo-read-other','https://read-other.arch026.invalid',${sha(12)},now()),
    ('woo-read-shopify-install','woo-read-shopify','https://shopify.arch026.invalid',${sha(13)},now());
  INSERT INTO billing."ShopEntitlementCounter"
    ("id","shopId","counter","grantedQuantity","updatedAt") VALUES
    ('woo-read-credit','woo-read-shop','LIFETIME_FREE_RECOVERY_CREDITS',7,now());`);
}
function attempt(id, digest, install = 'woo-read-install', shop = 'woo-read-shop', version = 1) {
  return `INSERT INTO woocommerce."WooCommerceRestReadAttempt"
    ("id","installationId","shopId","tokenDigest","credentialVersionSnapshot","expiresAt") VALUES
    ('${id}','${install}','${shop}',${sha(digest)},${version},clock_timestamp()+interval '5 minutes')`;
}
function sequence(id) {
  return scalar(`SELECT "attemptSequence" FROM woocommerce."WooCommerceRestReadAttempt" WHERE "id"='${id}'`);
}
function successful(id) {
  return `UPDATE woocommerce."WooCommerceRestReadAttempt" SET "status"='SUCCEEDED',"consumedAt"=clock_timestamp()
    WHERE "id"='${id}' AND "status"='PENDING'`;
}
function grantValues(id, seq, {install = 'woo-read-install', shop = 'woo-read-shop', rotation = 1} = {}) {
  return `"authorizationAttemptId"='${id}',"authorizationAttemptSequence"=${seq},
    "credentialVersionSnapshot"=1,"rotationVersion"=${rotation},"status"='ACTIVE',
    "credentialCiphertext"=decode('a1b2c3','hex'),"credentialNonce"=decode(repeat('02',12),'hex'),
    "credentialAuthTag"=decode(repeat('03',16),'hex'),"encryptionKeyId"='fixture-key',
    "providerKeyId"='123',"authorizedScope"='read',"verifiedAt"=clock_timestamp(),
    "revokedAt"=NULL,"invalidatedAt"=NULL`;
}
function insertGrant(id, seq, install = 'woo-read-install', shop = 'woo-read-shop') {
  return `INSERT INTO woocommerce."WooCommerceRestReadGrant" (
    "id","installationId","shopId","authorizationAttemptId","authorizationAttemptSequence",
    "credentialVersionSnapshot","rotationVersion","status","credentialCiphertext",
    "credentialNonce","credentialAuthTag","encryptionKeyId","providerKeyId","authorizedScope","verifiedAt"
  ) VALUES (
    'woo-read-grant','${install}','${shop}','${id}',${seq},1,1,'ACTIVE',
    decode('a1b2c3','hex'),decode(repeat('02',12),'hex'),decode(repeat('03',16),'hex'),
    'fixture-key','123','read',clock_timestamp()
  )`;
}
function rotate(id, seq, rotation) {
  return `UPDATE woocommerce."WooCommerceRestReadGrant" SET ${grantValues(id, seq, {rotation})}
    WHERE "installationId"='woo-read-install'`;
}
async function concurrent(sql) {
  return await new Promise(resolve => {
    const child = spawn('psql', psqlArgs, {stdio: ['pipe', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.resume();
    child.on('error', error => resolve({code: -1, stderr: error.message}));
    child.on('close', code => resolve({code, stderr}));
    child.stdin.end(sql);
  });
}

async function main() {
  assert.equal(scalar(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'`), '0', 'fixture database must be empty');
  for (const name of migrations) {
    if (mode === 'upgrade' && name === target) {
      shops();
      console.log('SEEDED existing Woo installations and lifetime Free credits before migration');
    }
    applyMigration(name);
  }
  if (mode === 'fresh') shops();
  assert.equal(scalar(`SELECT count(*) FROM woocommerce."WooCommerceRestReadGrant"`), '0');
  assert.equal(scalar(`SELECT encode("credentialDigest",'hex') FROM woocommerce."WooCommerceInstallation"
    WHERE "id"='woo-read-install'`), '0b'.repeat(32), 'inbound digest must be unchanged');
  assert.equal(scalar(`SELECT "grantedQuantity" FROM billing."ShopEntitlementCounter"
    WHERE "id"='woo-read-credit'`), '7', 'Free credit balance must be unchanged');
  console.log('PASS existing Woo identity and billing preserved with no grant backfill');

  // The BEFORE INSERT ownership guard rejects the wrong shop first (23514);
  // the composite foreign key remains a second line of defence.
  rejected('cross-installation attempt shopId', attempt('wrong-owner', 20, 'woo-read-install', 'woo-read-other'));
  rejected('Shopify tenant cannot request Woo REST grant', attempt('shopify-owner', 21,
    'woo-read-shopify-install', 'woo-read-shopify'));
  rejected('attempt expiry bounded to 15 minutes', attempt('long-expiry', 22).replace('5 minutes', '16 minutes'));
  rejected('digest must be 32 bytes', attempt('short-digest', 23).replace(sha(23), "decode('ff','hex')"));
  psql([attempt('initial', 31), attempt('older', 32), attempt('newer', 33)].join(';') + ';');
  rejected('duplicate bearer digest blocked', attempt('duplicate', 31), '23505');
  psql(attempt('expired', 24).replace('5 minutes', '1 second') + ';');
  await new Promise(resolve => setTimeout(resolve, 1350));
  rejected('expired attempt cannot be consumed', successful('expired'));
  rejected('missing AEAD tag is rejected', `BEGIN; ${successful('initial')};
    ${insertGrant('initial', sequence('initial')).replace("repeat('03',16)", "repeat('03',15)")}; COMMIT;`);
  assert.equal(scalar(`SELECT "status" FROM woocommerce."WooCommerceRestReadAttempt" WHERE "id"='initial'`),
    'PENDING', 'invalid credential envelope must roll back consumption');
  rejected('successful attempt without grant cannot commit', `BEGIN; ${successful('initial')};
    SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`);
  assert.equal(scalar(`SELECT "status" FROM woocommerce."WooCommerceRestReadAttempt" WHERE "id"='initial'`),
    'PENDING', 'failed consumption must roll back');

  const initial = sequence('initial');
  psql(`BEGIN; ${successful('initial')}; ${insertGrant('initial', initial)}; COMMIT;`);
  assert.equal(scalar(`SELECT "status" FROM woocommerce."WooCommerceRestReadGrant"`), 'ACTIVE');
  assert.equal(scalar(`SELECT "rotationVersion" FROM woocommerce."WooCommerceRestReadGrant"`), '1');
  console.log('PASS one-time consumption and grant activate atomically');
  // A conditional retry must affect no rows after the attempt is consumed.
  assert.equal(scalar(`WITH replay AS (${successful('initial')} RETURNING "id")
    SELECT count(*) FROM replay`), '0', 'successful bearer retry must be a no-op');
  console.log('PASS successful attempt conditional replay is a no-op');
  // A caller bypassing the PENDING predicate must still be rejected by the trigger.
  rejected('successful attempt is immutable after consumption',
    `UPDATE woocommerce."WooCommerceRestReadAttempt"
     SET "status"='SUCCEEDED',"consumedAt"=clock_timestamp() WHERE "id"='initial'`);
  psql(attempt('denied', 36) + ';');
  psql(`UPDATE woocommerce."WooCommerceRestReadAttempt" SET
    "status"='FAILED',"consumedAt"=clock_timestamp(),"failureCode"='merchant_denied'
    WHERE "id"='denied'`);
  assert.equal(scalar(`WITH replay AS (${successful('denied')} RETURNING "id")
    SELECT count(*) FROM replay`), '0', 'failed bearer retry must be a no-op');
  console.log('PASS failed attempt conditional replay is a no-op');
  rejected('failed authorisation attempt cannot be reopened',
    `UPDATE woocommerce."WooCommerceRestReadAttempt"
     SET "status"='PENDING',"consumedAt"=NULL,"failureCode"=NULL,
         "consumptionTransactionId"=NULL WHERE "id"='denied'`);
  rejected('grant ciphertext cannot change without new consent', `UPDATE woocommerce."WooCommerceRestReadGrant"
    SET "credentialCiphertext"=decode('1122','hex') WHERE "id"='woo-read-grant'`);
  rejected('grant cannot upgrade permission', `UPDATE woocommerce."WooCommerceRestReadGrant"
    SET "authorizedScope"='read_write' WHERE "id"='woo-read-grant'`);
  rejected('cross-tenant grant cannot reuse successful attempt',
    insertGrant('initial', initial, 'woo-read-other-install', 'woo-read-other')
      .replace("'woo-read-grant'", "'woo-read-other-grant'"));
  rejected('grant shopId is immutable', `UPDATE woocommerce."WooCommerceRestReadGrant"
    SET "shopId"='woo-read-other' WHERE "id"='woo-read-grant'`);

  const newer = sequence('newer');
  psql(`BEGIN; ${successful('newer')}; ${rotate('newer', newer, 2)}; COMMIT;`);
  const older = sequence('older');
  rejected('older callback cannot replace newer selected grant',
    `BEGIN; ${successful('older')}; ${rotate('older', older, 3)}; COMMIT;`);
  assert.equal(scalar(`SELECT "status" FROM woocommerce."WooCommerceRestReadAttempt" WHERE "id"='older'`),
    'PENDING', 'rejected older callback must remain unconsumed');
  console.log('PASS monotonic sequence guards stale callback replacement');

  psql(`UPDATE woocommerce."WooCommerceRestReadGrant" SET "status"='REVOKED',"revokedAt"=clock_timestamp()
    WHERE "id"='woo-read-grant'`);
  rejected('revoked grant cannot reactivate without new consent', `UPDATE woocommerce."WooCommerceRestReadGrant"
    SET "status"='ACTIVE',"revokedAt"=NULL WHERE "id"='woo-read-grant'`);
  psql(attempt('reauth', 34) + ';');
  const reauth = sequence('reauth');
  psql(`BEGIN; ${successful('reauth')}; ${rotate('reauth', reauth, 3)}; COMMIT;`);
  assert.equal(scalar(`SELECT "status" FROM woocommerce."WooCommerceRestReadGrant"`), 'ACTIVE');
  console.log('PASS locally revoked grant can be rotated only with new consent');

  psql(attempt('stale-generation', 35, 'woo-read-other-install', 'woo-read-other') + ';');
  psql(`UPDATE woocommerce."WooCommerceInstallation" SET "credentialVersion"=2
    WHERE "id"='woo-read-other-install'`);
  rejected('stale installation credential generation rejected', successful('stale-generation'));

  psql([attempt('slow', 41), attempt('fast', 42)].join(';') + ';');
  const slow = sequence('slow');
  const fast = sequence('fast');
  const oldSql = `BEGIN; ${successful('slow')}; SELECT pg_sleep(2.0); ${rotate('slow', slow, 5)}; COMMIT;`;
  const newSql = `BEGIN; ${successful('fast')}; ${rotate('fast', fast, 4)}; COMMIT;`;
  const olderProcess = concurrent(oldSql);
  const newerProcess = concurrent(newSql);
  const [slowResult, fastResult] = await Promise.all([olderProcess, newerProcess]);
  assert.equal(fastResult.code, 0, `newer concurrent authorisation must succeed: ${fastResult.stderr}`);
  assert.notEqual(slowResult.code, 0, 'older concurrent authorisation must fail');
  assert.match(slowResult.stderr, /23514/);
  assert.equal(scalar(`SELECT "authorizationAttemptId" FROM woocommerce."WooCommerceRestReadGrant"`),
    'fast', 'highest accepted sequence wins');
  console.log('PASS concurrent grant rotation keeps newer success');

  psql(`DELETE FROM woocommerce."WooCommerceRestReadGrant" WHERE "id"='woo-read-grant'`);
  rejected('consumed callback cannot mint another grant in a later transaction',
    insertGrant('fast', fast));
  psql(attempt('cascade', 44) + ';');
  psql(`BEGIN; ${successful('cascade')}; ${insertGrant('cascade', sequence('cascade'))}; COMMIT;`);
  psql(`DELETE FROM commerce."Shop" WHERE "id"='woo-read-shop'`);
  assert.equal(scalar(`SELECT count(*) FROM woocommerce."WooCommerceRestReadAttempt" WHERE "shopId"='woo-read-shop'`), '0');
  assert.equal(scalar(`SELECT count(*) FROM woocommerce."WooCommerceRestReadGrant" WHERE "shopId"='woo-read-shop'`), '0');
  assert.equal(scalar(`SELECT count(*) FROM commerce."Shop" WHERE "id"='woo-read-shopify'`), '1');
  console.log(`PASS ${mode}: cascades, tenant separation, non-plaintext envelope, replay and rotation`);
}
await main();
