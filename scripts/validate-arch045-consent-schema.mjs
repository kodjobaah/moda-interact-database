import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Static contract/drift guard. Disposable PG fresh+upgrade suites validate
// the executable constraints, triggers, isolation and ordered transitions.
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../prisma/migrations/20261021170000_arch045_shared_woo_consent_privacy/migration.sql', import.meta.url), 'utf8');
function block(type, name) {
  const start = schema.indexOf(`${type} ${name} {`);
  assert.ok(start >= 0, `${type} ${name} missing`);
  return schema.slice(start, schema.indexOf('\n}', start) + 2);
}
const phone = block('model', 'CustomerPhone');
const evidence = block('model', 'WhatsAppConsentEvidence');
const shop = block('model', 'Shop');
const customer = block('model', 'Customer');
const installation = block('model', 'WooCommerceInstallation');
const reach = block('model', 'WhatsAppRecipientReachability');
const recovery = block('model', 'CheckoutRecovery');
for (const field of [
  'whatsappCanonicalPhone', 'whatsappPhoneVerifiedAt', 'whatsappConsentPurpose',
  'whatsappConsentDecision', 'whatsappConsentSource', 'whatsappConsentProviderObservedAt',
  'whatsappConsentVerifiedAt', 'whatsappConsentRevision', 'whatsappConsentDecisionSequence',
  'whatsappNoContact', 'whatsappNoContactReason', 'whatsappNoContactAt',
  'whatsappNoContactRevision', 'whatsappNoContactClearedAt',
]) assert.match(phone, new RegExp(`\\b${field}\\b`), `CustomerPhone missing ${field}`);
assert.match(phone, /whatsappConsentDecision\s+WhatsAppRecoveryConsentDecision\s+@default\(UNKNOWN\)/);
assert.match(phone, /whatsappNoContact\s+Boolean\s+@default\(false\)/);
assert.match(block('enum', 'WhatsAppRecoveryConsentSource'), /SHOPIFY_NATIVE[\s\S]*WOO_MODA_CHECKBOX/);
assert.doesNotMatch(block('enum', 'WhatsAppRecoveryConsentSource'), /EXTERNAL/);
assert.match(block('enum', 'WhatsAppConsentEvidenceDecision'), /GRANT[\s\S]*REVOKE/);
for (const field of [
  'shopId', 'installationId', 'eventId', 'payloadDigest', 'customerId',
  'customerPhoneId', 'canonicalPhone', 'decision', 'decisionSequence',
  'phoneConsentRevision', 'decisionAt', 'disclosureText', 'disclosureVersion',
  'disclosureLocale', 'recordedAt',
]) assert.match(evidence, new RegExp(`\\b${field}\\b`), `Evidence missing ${field}`);
assert.match(evidence, /@@unique\(\[shopId, eventId\]/);
assert.match(evidence, /@@unique\(\[customerPhoneId, phoneConsentRevision\]/);
assert.match(evidence, /@@schema\("commerce"\)/);
for (const parent of [shop, customer, installation, phone]) {
  assert.match(parent, /whatsAppConsentEvidence\s+WhatsAppConsentEvidence\[\]/);
}
for (const [name, data] of [['Customer', customer], ['WooCommerceInstallation', installation],
  ['WhatsAppRecipientReachability', reach]]) {
  assert.doesNotMatch(data, /verifiedPrincipal|privacyErasedAt|privacyRevision|ConsentMode|ConsentProviderId|ConsentSourceEpoch|ConsentSourceRevision|permanentNoContact|WooCheckoutCustomerIdentity|CustomerPrivacyErasureFence/i,
    `${name} retains excluded fields`);
}
assert.match(customer, /@@unique\(\[id, shopId\]/);
assert.doesNotMatch(recovery, /consent|privacy/i);
assert.equal((schema.match(/^model WhatsAppConsentEvidence\s*{/gm) || []).length, 1);
for (const obsolete of [
  'WooCheckoutCustomerIdentity', 'WooCheckoutPrincipalKind', 'CustomerPrivacyErasureFence',
  'WooWhatsAppConsentEvidence', 'WooWhatsAppConsentCollectionMode',
  'WOO_APPROVED_EXTERNAL', 'whatsappConsentProviderId', 'whatsappConsentSourceEpoch',
  'verifiedPrincipalDigest', 'privacyErasedAt', 'permanentNoContact',
]) {
  assert.ok(!schema.includes(obsolete), `obsolete schema element remains: ${obsolete}`);
  assert.ok(!sql.includes(obsolete), `obsolete migration element remains: ${obsolete}`);
}
const creates = [...sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"\."([^"]+)"/g)];
assert.deepEqual(creates.map(m => `${m[1]}.${m[2]}`), ['commerce.WhatsAppConsentEvidence']);
const alters = [...sql.matchAll(/ALTER\s+TABLE\s+"([^"]+)"\."([^"]+)"/g)];
assert.deepEqual(alters.map(m => `${m[1]}.${m[2]}`), ['commerce.CustomerPhone']);
assert.doesNotMatch(sql, /(?:CREATE|ALTER)\s+(?:QUEUE|WORKLIST|OUTBOX)\b/i);
for (const mechanism of [
  'CustomerPhone_verified_grant_check', 'CustomerPhone_canonical_check',
  'CustomerPhone_unique_active_canonical_per_customer_key',
  'WhatsAppConsentEvidence_shop_event_key', 'WhatsAppConsentEvidence_phone_revision_key',
  'WhatsAppConsentEvidence_phone_fkey',
  'arch045_customer_phone_guard', 'arch045_woo_evidence_guard',
  'arch045_woo_consent_commit_guard', 'DEFERRABLE INITIALLY DEFERRED',
]) assert.ok(sql.includes(mechanism), `missing SQL guard ${mechanism}`);
console.log('PASS ARCH-045/046 one-table consent/evidence schema, default deny and exclusions');
