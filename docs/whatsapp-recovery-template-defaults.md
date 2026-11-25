# Platform recovery template defaults — database contract

`whatsapp.WhatsAppRecoveryTemplateDefault` is an explicit platform configuration pointer.
Each WABA may have at most one default per recovery purpose and format (`TEXT` or `IMAGE`). The default is for the
whole multilingual definition, not for a shop, language, or historical publication.
Missing rows mean no administrator selection. The migration deliberately inserts no rows,
including when published definitions already exist. It does not touch any prior migration.

The database enforces a primary key, the `(wabaId, purpose, format)` unique identity, six valid
purpose keys, a nonempty whitespace-free WABA identifier, and restrictive definition
and administrator references. Existing authoring/translation/registration/publication
rows are unchanged. `updatedAt` is managed by Prisma on updates, as in the existing
catalogue. Existing merchant assignments are unchanged when a default changes.

As with the original template persistence migration, eligibility is application-owned:
Admin must explicitly select an eligible recovery definition, matching its purpose and
WABA, and validate the complete 20-language reviewed/approved content cohort, provider
identity, category, and drift using the existing approval checks. The default can be
selected with zero shops; publication readiness must not depend on a merchant target.
Onboarding must read each configured WABA/purpose/format pointer and revalidate the same
conditions before writing existing per-shop variants and successful publication targets.
It must not infer a default from publication history, duplicate translated content, or
change existing valid merchant overrides. Publication provenance must identify the
selected definition and registrations without fabricating a source all-shops publication.
The shop's existing default language and customer/conversation language selection remain
unchanged. Background continues to consume shop-assigned approved variants.

The merchant deletion/reset path must preserve this table and its referenced platform
catalogue. No foreign key to `Shop` or publication exists. The regression tests verify
merchant-owned target/variant/shop deletion, not the external Admin reset CLI.

Run both isolated PostgreSQL tests (Docker with `pgvector/pgvector:pg17`):

```sh
npm run test:whatsapp-recovery-defaults:postgres:fresh
npm run test:whatsapp-recovery-defaults:postgres:upgrade
```

Each mode uses an invocation-owned network-isolated container, no published ports and
no `DATABASE_URL`. Upgrade seeds a representative existing published catalogue, Meta
registrations, merchant and publication before applying the migration; the test compares
persisted rows, verifies no implicit selection, and exercises integrity and merchant
independence. The two-locale fixture is a database storage test, not a Meta eligibility test.

Deployment is forward-only. Apply the schema migration before deploying consumers that
read the new table. The original migration required no backfill. The format migration and its consumer rollout
are described below. The database alone does not provision or publish a template.

## Dual-format defaults

Migration `20261125010000_whatsapp_recovery_default_formats` introduces a required
`format` column and replaces the old two-column unique index. There is deliberately
no column default: a new selection must explicitly name `IMAGE` or `TEXT`.
`TEXT` is the non-image family (a TEXT header or no header); `NONE` is not a third
slot. An IMAGE header has an explicit immutable media binding. A text fallback must
also avoid body bindings that require unavailable media. Admin and runtime remain
responsible for these eligibility decisions.

The upgrade classifies each existing pointer using its 20 saved locale projections
and the corresponding WABA registrations. It requires matching definition purpose,
registration identities, header kinds and media roles. No-header and TEXT-header
definitions map to `TEXT`; IMAGE maps to `IMAGE`. The migration stops and rolls back
on missing or inconsistent evidence; it never picks a replacement definition.
It does not re-evaluate live provider approval, so even a subsequently revoked
registration's pointer is preserved and remains subject to normal application gates.
Existing pointer IDs, definition IDs, administrators and timestamps are retained.
Only the new `format` value is written. No merchant, locale, registration,
publication target, or approval row is updated. No new TEXT defaults are fabricated.

The existing variant identity already permits an IMAGE and a TEXT assignment for
the same shop/WABA/purpose/language. No new shop-assignment table or column is needed.
Consumers must treat a TEXT header and no header as the same non-image slot and
avoid ambiguous assignment cohorts. TEXT is the required baseline for readiness;
IMAGE is optional. When both are selected, future onboarding may create 240 variants
across six purposes and 20 languages. Existing merchants are updated only through
explicit publication or the existing authorized provisioning/repair path; the
migration itself does not assign templates.

Admin, Shopify and every other default-table consumer must be updated to the new
Prisma compound key (`wabaId_purpose_format`), including common-layout coordinated
activation, audit/provenance, publication replacement, scenario dashboard and
onboarding idempotency. Publication of one format must not overwrite the other.
Background must continue selecting approved shop variants and verify image-to-text
fallback in integration tests. Do not bypass approval, consent, STOP, billing,
moderation, or final-send checks. No change to Shopify access scopes is needed.

**Deployment gate:** commit and test the database patch locally first. Do not apply
the migration to a live database while old Admin or Shopify default writers/readers
are running; the changed unique key is not backwards compatible. Take a verified
backup and pause relevant writers/consumers; apply the forward migration, deploy
all compatible consumers, and verify existing pointers and merchant assignments
before resuming. Do not roll back to old consumers once both formats are in use.
A failed migration preserves the old schema and data; investigate the reported
pointer and locale rather than manually relabelling it. The original historical
migration tests still intentionally exercise the original two-column schema.

New disposable PostgreSQL tests (no production connection):

```sh
npm run test:whatsapp-recovery-default-formats:postgres:fresh
npm run test:whatsapp-recovery-default-formats:postgres:upgrade
```

The upgrade fixture preserves six existing IMAGE defaults and 120 assigned variants,
exercises existing TEXT and headerless defaults in a second WABA, and verifies atomic
failure on contradictory or missing frozen evidence. Both modes test uniqueness,
foreign keys, independent format replacements, coexistence of 240 variants and
merchant deletion. The fixtures test persistence and classification, not provider
approval or actual WhatsApp sends.
