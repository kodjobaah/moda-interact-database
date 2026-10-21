import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static owner/contract drift check; live integrity is verified by the
// separate Docker/PostgreSQL fresh and upgrade tests.
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../prisma/migrations/20261021170000_arch045_shared_woo_consent_privacy/migration.sql', import.meta.url), 'utf8');
function model(name) {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `${name} model missing`);
  return schema.slice(start, schema.indexOf('\n}', start) + 2);
}
const phone = model('CustomerPhone');
const customer = model('Customer');
const installation = model('WooCommerceInstallation');
const reachability = model('WhatsAppRecipientReachability');
const evidence = model('WooWhatsAppConsentEvidence');
const identity = model('WooCheckoutCustomerIdentity');
const erasure = model('CustomerPrivacyErasureFence');
const checkoutRecovery = model('CheckoutRecovery');
for (const name of ['whatsappConsentDecision', 'whatsappCanonicalPhone', 'whatsappConsentSource',
  'whatsappConsentSourceEpoch', 'whatsappConsentRevision', 'whatsappConsentDecisionSequence',
  'whatsappConsentVerifiedAt', 'whatsappNoContact', 'whatsappNoContactRevision']) {
  assert.match(phone, new RegExp(`\\b${name}\\b`));
}
assert.match(phone, /whatsappConsentDecision\s+WhatsAppRecoveryConsentDecision\s+@default\(UNKNOWN\)/);
assert.match(customer, /privacyErasedAt/);
assert.match(installation, /whatsappConsentMode\s+WooWhatsAppConsentCollectionMode\s+@default\(NOT_CONFIGURED\)/);
assert.match(installation, /whatsappConsentSourceEpoch/);
assert.match(reachability, /permanentNoContact\s+Boolean\s+@default\(false\)/);
assert.match(reachability, /suppressUntil/);
for (const name of ['shopId', 'installationId', 'eventId', 'payloadDigest', 'customerId',
  'customerPhoneId', 'canonicalPhone', 'decision', 'disclosureText', 'disclosureVersion',
  'disclosureLocale', 'sourceEpoch', 'phoneConsentRevision', 'redactedAt']) {
  assert.match(evidence, new RegExp(`\\b${name}\\b`));
}
assert.match(evidence, /@@unique\(\[shopId, eventId\]/);
assert.doesNotMatch(evidence, /\b(?:claim|lease|retry|ack|poll|ready|outbox|nextAttemptAt)\b/i);
assert.match(identity, /checkoutKeyDigest/);
assert.match(identity, /sessionGeneration/);
assert.doesNotMatch(identity, /\b(?:sessionToken|sessionCookie|rawCheckoutKey)\b/);
assert.match(erasure, /@@unique\(\[shopId, platform, principalDigest\]/);
assert.doesNotMatch(checkoutRecovery, /consent|privacy/i);
assert.equal((schema.match(/model WooWhatsAppConsentEvidence\s*{/g) ?? []).length, 1);
assert.equal((schema.match(/model CustomerPrivacyErasureFence\s*{/g) ?? []).length, 1);
for (const key of [
  'CustomerPhone_one_verified_active_per_customer_key',
  'WooCheckoutIdentity_one_live_checkout_key',
  'WooCheckoutIdentity_one_live_session_generation',
  'arch045_customer_privacy_guard',
  'arch045_customer_phone_guard',
  'arch045_unbound_stop_guard',
  'arch045_source_epoch_guard',
  'arch045_checkout_identity_guard',
  'arch045_woo_evidence_guard',
  'arch045_privacy_fence_guard',
  'arch045_lock_verified_principal',
]) assert.ok(sql.includes(key), `${key} missing in SQL`);
assert.doesNotMatch(sql, /\bCREATE (?:QUEUE|WORKLIST|OUTBOX)\b/i);
console.log('PASS ARCH-045/046 schema boundaries, default deny, evidence, identity, erasure and SQL guards');
