# ARCH-026: WooCommerce read-only REST grant persistence

Owned by `moda_database`. This is the persistence contract for
`ARCH-026-DATABASE-003`, consumed by `ARCH-026-API-007` and `ARCH-026-API-008`.
It does **not** replace `WooCommerceInstallation.credentialDigest`, the credential
for calls from the WordPress plugin to Moda.

## Scope and encryption

- `woocommerce.WooCommerceRestReadAttempt` stores a **SHA-256 digest only** of a
  random, one-use callback bearer. Its `attemptSequence` is globally increasing
  and only establishes ordering; it is not a secret or a tenant identifier.
- `woocommerce.WooCommerceRestReadGrant` stores one selected grant per
  installation: a single API-encrypted, authenticated envelope containing both
  the Woo consumer key and secret. The API owns AES-GCM encryption, keyring,
  authenticated context and plaintext lifetime. There are no plaintext DB
  fields. The DB requires a 12-byte nonce, 16-byte authentication tag, bounded
  ciphertext, nonblank key IDs and exactly `authorizedScope='read'`.
- The composite installation (`id`, `shopId`) foreign key prevents attaching a
  grant or attempt to another Shop; guards also require an **ACTIVE** installation
  belonging to a `WOOCOMMERCE` Shop before a new attempt or active grant.
- A grant's `credentialVersionSnapshot` must match the inbound installation
  generation **at activation**. All future reads must independently verify that
  the Shop is still WooCommerce, the installation is active, its current version
  matches the grant snapshot, and the grant is `ACTIVE`; a stored grant is not
  sufficient evidence on its own.

## Authorisation transaction (API-007)

1. Authenticated start creates a `PENDING` attempt with a SHA-256 token digest,
   the current installation/Shop/version and expiry no longer than 15 minutes.
2. After the exact-store read-only provider verification has completed, start a
   **single database transaction**. Recheck identity/version/expiry.
3. Update exactly one matching pending attempt to `SUCCEEDED` and assign
   ``consumedAt`. The DB records the consuming PostgreSQL transaction ID.
   An attempt cannot be reset, extended or consumed twice.
4. Insert the first grant, or rotate the existing grant with that attempt's
   larger `attemptSequence` and `rotationVersion = old + 1`. The DB rejects an
   older attempt replacing an already selected newer grant.
5. Commit both operations together. The grant guard checks that its attempt
   was consumed by this same transaction; a deferred constraint trigger rejects
   a successful attempt without its corresponding grant at commit. A bearer
   therefore cannot mint another grant in a later transaction even if the
   previously selected grant was deleted.

For a denied/invalid callback, the API may consume a still-pending attempt as
`FAILED` with a bounded failure code; this does **not** grant REST access.
The browser's `return_url` is advisory only and is not a grant credential.

## Revocation and retention

- `ACTIVE -> REVOKED` and `ACTIVE -> INVALID` are terminal for the selected
  credential. Reactivation requires a **new successful authorisation attempt**,
  not a status flip. The API must refuse REST reads immediately after either
  transition. Provider-side key revocation remains merchant-controlled.
- Grant rotation replaces the encrypted envelope in place. There is only one
  selected grant per Woo installation; previous ciphertext is not retained as a
  separate grant-history table.
- A grant references its successful attempt. Deleting that attempt cascades to
  the grant **fail closed**, so retention cleanup must never delete a selected
  successful attempt for an active, invalid or revoked grant. Unselected and
  expired attempts may be pruned by a future bounded retention job.
- Deleting a Woo installation (or its parent Shop) cascades to its attempts and
  grant. Deleting or revoking the outbound grant does not change the inbound
  installation credential, onboarding state, subscriptions or entitlements.

## Validation

Run `npm run prisma:validate`,
`npm run test:arch026-woocommerce-rest-read-grant`, and, with two independently
created **empty, disposable PostgreSQL 17 databases** with pgvector support:

```bash
export ARCH026_READ_FRESH_DATABASE_URL='postgresql://.../arch026_read_fresh_fixture'
export ARCH026_READ_UPGRADE_DATABASE_URL='postgresql://.../arch026_read_upgrade_fixture'
npm run test:arch026-woocommerce-rest-read-grant:postgres:fresh
npm run test:arch026-woocommerce-rest-read-grant:postgres:upgrade
```

Tests apply SQL migrations directly to isolated fixture databases and do not
alter or mark Prisma migration history for deployed databases. Use the normal
`npm run migrate:deploy` and `npm run status` separately for the selected
non-production deployment database. Never use the production DATABASE_URL for a
rehearsal fixture.
