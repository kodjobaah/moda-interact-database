# ARCH-045-DATABASE-002 — WhatsApp consent and privacy persistence

This is the database-only contract for ARCH-045 **and** ARCH-046. The SQL
migration is `20261021170000_arch045_shared_woo_consent_privacy`. Ingress,
Shopify GraphQL, Woo authentication, phone canonicalisation, notices, Meta
preflight, sending, billing and WordPress privacy adapters belong to their
respective service tasks. **No consent event schedules a recovery.**

## Authority and exact recipient

- `commerce.CustomerPhone` is the **only** current WhatsApp recovery consent
  projection. A legacy or new row defaults to `UNKNOWN`, revision/sequence zero,
  no verified canonical recipient and no inferred grant. Its existing `phone`
  field may be NULL after erasure, even for ended historical records.
- `whatsappCanonicalPhone` is the *digits-only* E.164 number without `+`, e.g.
  `447911123456`. **Never** convert a national number by guessing the shop
  locale. Node callers must use the published `ARCH-045-SHARED-001` identity
  implementation and verified country context; the Woo PHP producer uses its
  identical golden vectors. A malformed/ambiguous phone is not eligible.
- `Customer.verifiedPrincipalDigest` is a **keyed HMAC-SHA256** of an
  independently authenticated Shopify Customer GID or Woo account/guest
  principal, scoped by `verifiedPrincipalPlatform` and `shopId`. No phone or
  email match can establish identity. Legacy Customers without verification
  remain valid for preexisting uses but **cannot** acquire new WhatsApp grants.
  The verified-principal digest must be calculated consistently with privacy
  fence lookup. The HMAC key must remain available for fence checks for the
  full legally required fence lifetime; planned key rotation must support old
  keyed digests rather than silently re-enabling erased identities.
- `CustomerPhone.whatsappConsentDecision` is `UNKNOWN`, `GRANTED` or `REVOKED`,
  with purpose fixed to `WHATSAPP_CHECKOUT_RECOVERY`. An eligible grant needs
  active phone, verified principal, E.164 digits, verification/observation
  timestamps, strict monotonic `whatsappConsentRevision` and
  `whatsappConsentDecisionSequence`, and source/epoch compatible with the
  current shop/installation. A new verified recipient is a new active row;
  end/revoke the old row and never transfer its grant to a changed phone or
  to a different Customer. Only one **verified active** phone per Customer is
  permitted; two Customers may share a phone without sharing authorisation.
- For Shopify, use `SHOPIFY_NATIVE`, no source epoch/provider ID, and a fresh
  authoritative customer+recipient status check. For Woo, use
  `WOO_MODA_CHECKBOX` or `WOO_APPROVED_EXTERNAL`, and match
  `WooCommerceInstallation.whatsappConsentMode`, provider and
  `whatsappConsentSourceEpoch`. The mode defaults to `NOT_CONFIGURED`; external
  providers require explicit approval in the API, not mere DB field presence.
  Changing A → B → A advances the epoch **twice**; the old A grant fails.
- Local `CustomerPhone.whatsappNoContact` is a **negative override**, e.g.
  `CUSTOMER_STOP` or `MERCHANT_OPT_OUT`, with its own revision. It takes
  precedence over `GRANTED`. A prior local STOP can be cleared only by newer,
  separately verified affirmative permission with provider observation later
  than the STOP and an updated consent sequence/revision.
- `whatsapp.WhatsAppRecipientReachability.permanentNoContact` is another
  **negative-only** fence, for authenticated shop/recipient STOP without a
  verified CustomerPhone. It is distinct from the provider-delivery
  `suppressUntil` and never grants anything; a newer verified grant for the
  exact shop/recipient is required to clear it. Check both fences at dispatch.

## Transactional source/decision/dispatch contract

Callers do not call remote providers or Redis *inside* SQL transactions.
Always use CAS `WHERE id=:id AND whatsappConsentRevision=:expectedRevision`
(and provider decision sequence checks) and reject zero updated rows. Check
`shopId` through `commerce.Customer`, not raw phone; verify the *currently
active* canonical phone. A Woo GRANT/REVOKE locks the authenticated
installation/customer, checks mode/provider/epoch, updates the exact phone
row, and inserts the immutable evidence fact **in the same transaction**.
The DB trigger also checks that evidence matches current phone state and
source; it cannot independently validate browser/authentication proof.

The short dispatch fence needs an authenticated shop/Customer/phone ID,
canonical recipient, verified platform-principal digest and expected phone
revision. After an out-of-transaction provider preflight:

```sql
BEGIN;
-- Serialize with privacy erasure and STOP even when the negative row is absent.
SELECT commerce.arch045_lock_verified_principal(
  :shopId, :shopPlatform::commerce."ShopPlatform", :principalDigest);
SELECT c."id" FROM commerce."Customer" c
WHERE c."id" = :customerId AND c."shopId" = :shopId
  AND c."privacyErasedAt" IS NULL FOR SHARE;
SELECT whatsapp.arch045_lock_contact_recipient(:shopId, :recipientDigits);
-- For Woo, first SELECT the matching WooCommerceInstallation FOR SHARE.
-- Re-check all eligibility against current committed values under these locks.
SELECT cp."id", cp."whatsappConsentRevision", cp."whatsappConsentSourceEpoch"
FROM commerce."CustomerPhone" cp
JOIN commerce."Customer" c ON c."id" = cp."customerId"
JOIN commerce."Shop" s ON s."id" = c."shopId"
WHERE c."shopId" = :shopId AND c."id" = :customerId
  AND s."status" = 'ACTIVE' AND s."platform" = :shopPlatform::commerce."ShopPlatform"
  AND c."privacyErasedAt" IS NULL
  AND c."verifiedPrincipalPlatform" = :shopPlatform::commerce."ShopPlatform"
  AND c."verifiedPrincipalDigest" = :principalDigest
  AND cp."id" = :customerPhoneId AND cp."endedAt" IS NULL
  AND cp."whatsappCanonicalPhone" = :recipientDigits
  AND cp."whatsappConsentRevision" = :expectedRevision
  AND cp."whatsappConsentDecision" = 'GRANTED'
  AND ((s."platform" = 'SHOPIFY' AND cp."whatsappConsentSource" = 'SHOPIFY_NATIVE'
           AND cp."whatsappConsentSourceEpoch" IS NULL)
       OR (s."platform" = 'WOOCOMMERCE' AND EXISTS (
         SELECT 1 FROM woocommerce."WooCommerceInstallation" i
         WHERE i."shopId"=s."id" AND i."status"='ACTIVE'
           AND i."whatsappConsentSourceEpoch"=cp."whatsappConsentSourceEpoch"
           AND ((i."whatsappConsentMode"='MODA_CHECKBOX' AND cp."whatsappConsentSource"='WOO_MODA_CHECKBOX')
             OR (i."whatsappConsentMode"='APPROVED_EXTERNAL'
                 AND cp."whatsappConsentSource"='WOO_APPROVED_EXTERNAL'
                 AND i."whatsappConsentProviderId"=cp."whatsappConsentProviderId"))
       )))
  AND NOT cp."whatsappNoContact"
  AND NOT EXISTS (
    SELECT 1 FROM commerce."CustomerPrivacyErasureFence" f
    WHERE f."shopId" = c."shopId" AND f."platform" = :shopPlatform::commerce."ShopPlatform"
      AND f."principalDigest" = :principalDigest)
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp."WhatsAppRecipientReachability" r
    WHERE r."shopId" = c."shopId" AND r."recipient" = cp."whatsappCanonicalPhone"
      AND r."permanentNoContact")
FOR SHARE OF cp, c;
-- The provider preflight (outside this transaction) must separately confirm
-- the current Shopify/Meta permission. Do not send if any row is absent.
COMMIT;
```

The lock helper for exact recipients is also called by STOP and verified
CustomerPhone trigger paths, preventing insertion of a missing STOP row from
racing the final read. All writers should acquire locks in this order:
verified principal, customer, canonical recipient, phone/installation. A
transaction that loses a deadlock or serialisation race retries from verified
source state; it **never** assumes grant. This DB check cannot make a later
Meta HTTP send atomic with a Shopify customer changing permission in the
intervening interval; provider preflight, bounded freshness, compensation
and fail-closed delivery remain Background responsibilities.

## Woo verified identity, evidence and replay

`WooCheckoutCustomerIdentity` is the **one permitted non-consent join entity**:
existing Commerce `Customer` / `CheckoutRecovery` contain no verified Woo
account/guest + installation + checkout association. It stores only HMAC
SHA-256 principal and checkout-key digests, plus installation/shop/customer,
`ACCOUNT` or `GUEST_SESSION`, generation, verification/expiry and revocation.
The plugin/API must validate cryptographic server proof, nonce/session binding,
login/logout and checkout provenance before writing it. There are unique
active checkout and active principal/session-generation constraints scoped to
**installation**, not globally by checkout key. Rotation revokes the old row,
increments generation and inserts a new one; a revoked row cannot reactivate.
An identity association expires at most 30 days after verification (this is
**session retention**, not consent expiry). Purge expired and revoked links by
ordinary non-consent housekeeping; never use them as current permission.

Exactly one history table, `WooWhatsAppConsentEvidence`, stores an ordinary
accepted GRANT/REVOKE *fact*. Source epoch/revision, decision sequence, current
phone revision, exact recipient, validated disclosure text/version/locale,
optional verified checkout binding, event ID, recorded time and HMAC of the
**canonical request** are captured at the same commit as the phone decision.
It has **no readiness, lease, claim, retry, polling, ack or recovery worklist**.
`UNIQUE(shopId,eventId)` ensures only one fact per event. The database rejects
an already-visible same-ID/different-digest event and treats an identical replay
as a no-op **before** requiring the old event to match today's consent state.
The API MUST also compare stored `payloadDigest` with the incoming digest if
`ON CONFLICT DO NOTHING` returns no row, since a concurrently committed insert
might not have been visible to the BEFORE INSERT trigger. Equal means identical
idempotent retry; unequal means a rejected conflicting replay (never a new
decision). The API must resolve this duplicate **before** advancing the current
phone consent revision. Older separately named GRANT events cannot advance the
CAS sequence after a REVOKE.

## Privacy rights, fences and erasure

- Privacy callers validate and authorise an actual Shopify/Woo privacy request;
  the DB cannot verify Shopify signatures, Woo identity proof or a lawful basis.
  No raw customer ID, phone, session token or checkout key is stored in
  `CustomerPrivacyErasureFence`: only shop/platform/HMAC principal digest,
  erasure cutoff and monotonic revision. The row **persists** across erasure,
  protects the old lifecycle, and is not a positive consent authority.
- Acquire `commerce.arch045_lock_verified_principal` for **every** authenticated
  principal digest (Woo guest/account plus Shopify GID as applicable), in
  deterministic digest order. Fence insertion itself also acquires that lock.
  In the **same transaction**, insert/upsert the fence, pseudonymise all Woo
  evidence fields, set `Customer.privacyErasedAt`/revision and clear Customer
  contact/name/provider IDs/verified digest, clear `phone`, canonical phone,
  source, verification and STOP contact metadata on **all** active and ended
  CustomerPhone rows, then remove Woo identity associations. A redacted
  Customer is terminal: future writes of phone/contact PII and grants fail.
- Ordinary Woo evidence is DB-immutable. A one-way privacy UPDATE may NULL
  `customerId`, `customerPhoneId`, identity ID, recipient, disclosure,
  provider ID/time and checkout digest and set `redactedAt`; subsequent UPDATE
  cannot restore them. The HMAC payload digest, opaque non-PII event ID,
  decision, source epoch/revision and revision counts remain as integrity
  metadata **only where an approved legal retention basis exists**; otherwise
  authorised erasure may DELETE evidence inside a transaction with
  `SET LOCAL moda.verified_privacy_erasure = 'on'`. For full-shop teardown,
  fence deletion additionally requires `SET LOCAL moda.verified_shop_teardown = 'on'`.
  Never use these settings outside verified erasure/shop-teardown operations;
  application/database access controls must restrict them to trusted handlers.
- An erasure fence denies reuse of its old principal digest, even for a new
  Customer row or guest binding. A truly **new verified customer lifecycle**
  with independent authenticated principal/epoch/digest can bind a new row;
  a source retry/restore using the old identity cannot. If the provider reuses
  the same principal after deletion, do not infer a new lifecycle from a
  timestamp alone: require an independently verified reauthorisation design
  before relaxing the tombstone. No automatic fence expiry is defined.
- Whole-shop deletion must clear/redact evidence before removing its referenced
  Customer/identity rows and use a verified teardown context for any direct
  evidence deletion. Tenant-scoped cascades remove remaining rows and fences.
  `WooConsentEvidence` foreign keys deliberately do **not** silently delete
  audit rows on Customer/identity deletion.
- Retention/export/legal basis and signing/HMAC secret lifecycle are explicit
  deployment decisions, not claims made by this migration. Ordinary retention
  is governed by the merchant privacy policy and applicable law, **never**
  by an invented 72-hour consent timer.

## Migration and validation / rollback

The migration creates enums, nullable/additive columns and indexed new tables;
existing phone/installation records remain UNKNOWN/NOT_CONFIGURED. No current
consent or CheckoutRecovery is fabricated. Preserve old writes as UNKNOWN
until both producers/consumers enforce the new verified principal and
conditional revision contracts. Deploy migration first, then approved Shared
package/consumers, then enable Shopify/Woo consent ingress only after privacy
and STOP writers and send fences are live. Rolling back the app must disable
new consent-producing paths; do **not** drop tombstones or evidence through a
blind down migration. No destructive/down migration is provided.

Run `npm run validate`, `npm run prisma:generate`,
`npm run test:arch045-consent-schema`,
`npm run test:arch045-consent:postgres:fresh`,
`npm run test:arch045-consent:postgres:upgrade`, `npm run lint` and
`git diff --check` in the implementation worktree. The PostgreSQL tests use an
isolated disposable `pgvector/pgvector:pg17` Docker container (`--network none`)
and validate source switching/ABA, concurrent CAS, identity takeover, replay,
privacy and negative STOP constraints. Separate Shopify/API/Woo/System tests
must cover the authenticated provider/client side and UK local/+44 vectors.
