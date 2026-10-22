# ARCH-045 / ARCH-046 — CustomerPhone consent and Woo evidence database contract

**Owner:** `ARCH-045-DATABASE-002` (`moda-interact-database`). This note describes
only the database boundary. The implementation is an in-flight amendment to the
already claimed, unmerged Attempt 1.

## Scope and source of truth

- `commerce.CustomerPhone` is the **only current permission authority** for
  checkout-recovery WhatsApp. Older rows and new phones default to `UNKNOWN`.
  `UNKNOWN`, `REVOKED` and all local no-contact states deny permission.
- `commerce.WhatsAppConsentEvidence` is the **single new table**, used only for
  immutable, authenticated Woo Moda-checkout-checkbox opt-in/withdrawal facts.
  Its history is not a current-consent projection, worklist, recovery queue or
  evidence-derived scheduler.
- `SHOPIFY_NATIVE` is set only by the Shopify-authorised provider read/write
  boundary. `WOO_MODA_CHECKBOX` is set only by Moda's own deliberate, initially
  unchecked WooCommerce checkout action. There is no third-party provider,
  merchant source selector or Woo installation consent setting.
- Existing `commerce.Customer` owns the `shopId` tenant scope, and the existing
  `woocommerce.WooCommerceInstallation` authenticates the merchant integration.
  No new Woo checkout identity, principal-digest, privacy-erasure or reachability
  schema is part of this task. Privacy export, erasure and anti-recollection
  controls require a separately approved architecture.

## Exact recipient and customer resolution

The API/Background boundary supplies a country-aware, validated E.164 canonical
recipient as **digits without `+`**, for example UK local `07911123456` or
`+44 7911 123456` both map to `447911123456` when the country context is UK.
The database checks the digits-only representation but does not itself infer a
country code from an ambiguous local number. Consumers must use the published
Shared normalisation/identity contract before writing `whatsappCanonicalPhone`.

Resolve against existing `Customer` + **currently active** `CustomerPhone`,
scoped to the authenticated merchant, never by phone alone:

```sql
SELECT DISTINCT c."id"
FROM "commerce"."Customer" AS c
JOIN "commerce"."CustomerPhone" AS cp ON cp."customerId" = c."id"
WHERE c."shopId" = $1
  AND cp."whatsappCanonicalPhone" = $2
  AND cp."endedAt" IS NULL;
```

- Zero matches: the owning consumer may create ordinary Customer/CustomerPhone
  records, without granting permission. Concurrent creations require
  coordination and rechecking for ambiguity; there is intentionally **no**
  unique `(shopId, phone)` constraint that merges different Customers.
- Exactly one distinct Customer match: reuse that Customer only after the
  consumer independently authenticates and verifies the consent action.
- Multiple distinct Customer matches: **deny and report ambiguity**; never
  broadcast, merge Customers or select an arbitrary row. An existing phone
  match never means the shopper checked the Woo checkbox.
- A changed recipient must not inherit consent from the previous number.
  Reset to `UNKNOWN` and require a new verified grant for that exact recipient.

## Permission and no-contact ordering

`whatsappConsentRevision` increases on every accepted consent/phone-state
change; `whatsappConsentDecisionSequence` increases on each new permission
observation/decision. Writers use a compare-and-set on the expected revision
under a short transaction, and never regress an accepted observation timestamp.
No prior phone match, migration, installation credential rotation/reconnection,
manual merchant action, or imported checkout turns `UNKNOWN` into `GRANTED`.

`whatsappNoContact` with `CUSTOMER_STOP` is a terminal, stronger local override:
Shopify `GRANTED` or Woo grant can update the provider decision but **cannot
clear customer STOP**. Merchant `MERCHANT_OPT_OUT` is suppression only. Its
removal requires a currently valid `GRANTED` decision and does not mint consent
or override `CUSTOMER_STOP`. Merchant authentication/authorization and
standalone STOP fan-out to all relevant merchants are consumer-owned. The
existing `whatsapp.WhatsAppRecipientReachability` remains unchanged and must
not be confused with this permission model.

Dispatch consumers must read current `CustomerPhone` by exact shop+recipient
and require **all**: active phone, decision `GRANTED`, matching canonical
recipient, and no local no-contact override. A Woo permission also must have
been written with matching audit evidence as an atomic transaction. No
`CheckoutRecovery` is created solely because consent is missing, and a consent
change neither schedules recovery nor charges credits.

## Atomic Woo grant / withdrawal and audit history

The Woo API verifies the merchant installation and deliberate checkout checkbox
origin **before** the transaction. It updates the selected CustomerPhone and
inserts one `WhatsAppConsentEvidence` row in the **same database transaction**.
The deferred constraint trigger rejects a committed Woo decision that lacks a
matching `(customerPhoneId, canonicalPhone, revision, sequence, decisionAt,
decision)` evidence fact; the evidence insert guard checks the current state and
an active installation. A withdrawal uses `REVOKE` with `CustomerPhone.REVOKED`.
A regrant requires a later decision/sequence and a new event ID.

Evidence stores `shopId`, `installationId`, `customerId`, `customerPhoneId`,
canonical recipient, purpose, decision, accepted revision/sequence, decision
instant, event ID, SHA-256-sized payload digest and optional disclosure wording
(`GRANT` requires non-empty text, version and locale). Do **not** store raw
Woo guest sessions, bearer tokens, checkout secrets or provider credentials.
The database checks tenant-safe composite foreign keys and immutability.

`(shopId,eventId)` is unique. Identical replay of an accepted event returns a
no-op even after a later withdrawal; same event ID with a changed payload
digest is rejected. Concurrent retries must use `INSERT ... ON CONFLICT DO
NOTHING` plus a **post-conflict digest comparison** within their owning
transaction: before-insert trigger lookups cannot see another transaction's
uncommitted row. Do not mistake unique-conflict resolution for matching-payload
verification.

PostgreSQL cannot establish that an HTTP checkbox submission was genuinely
made by the shopper: authenticated installation/session binding, checkout
origin, disclosure displayed, manual merchant suppression authorization and
provider reads remain with the owning API/Shopify/Woo task.

## Migration and validation

This is a **pre-merge replacement of the existing**
`20261021170000_arch045_shared_woo_consent_privacy/migration.sql`, not an
additional undo migration. The amended SQL creates only
`commerce.WhatsAppConsentEvidence` and adds consent-related fields to
`commerce.CustomerPhone`; a composite unique index on existing Customer is
needed for a tenant-safe foreign key. `Shop`, `Customer`, `WooCommerceInstallation`
and `CustomerPhone` receive Prisma relation declarations only, not extra
persisted identity/provider/privacy columns. There are no new persisted fields
on `WhatsAppRecipientReachability`.

The previous disposable-test runs do not validate this changed SQL. Run Prisma
schema validation/client generation, `test:arch045-consent-schema`, and both
`test:arch045-consent:postgres:fresh` and
`test:arch045-consent:postgres:upgrade`. Each PostgreSQL test creates its own
isolated Docker PostgreSQL/pgvector container and removes it in `finally`.
If the superseded version of this migration has already been applied to a
persistent database, do **not** silently rewrite migration history: separately
plan a reset or a new corrective migration for that environment.

The task's status remains `in_progress`, Attempt 1, developer-owned until fresh
validation and Completion Report reconciliation are recorded and reviewed.
