# Platform recovery template defaults — database contract

`whatsapp.WhatsAppRecoveryTemplateDefault` is an explicit platform configuration pointer.
Each WABA may have at most one default per recovery purpose. The default is for the
whole multilingual definition, not for a shop, language, or historical publication.
Missing rows mean no administrator selection. The migration deliberately inserts no rows,
including when published definitions already exist. It does not touch any prior migration.

The database enforces a primary key, the `(wabaId, purpose)` unique identity, six valid
purpose keys, a nonempty whitespace-free WABA identifier, and restrictive definition
and administrator references. Existing authoring/translation/registration/publication
rows are unchanged. `updatedAt` is managed by Prisma on updates, as in the existing
catalogue. Existing merchant assignments are unchanged when a default changes.

As with the original template persistence migration, eligibility is application-owned:
Admin must explicitly select an eligible recovery definition, matching its purpose and
WABA, and validate the complete 20-language reviewed/approved content cohort, provider
identity, category, and drift using the existing approval checks. The default can be
selected with zero shops; publication readiness must not depend on a merchant target.
Onboarding must read the configured WABA/purpose pointer and revalidate the same
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
read the new table. No production backfill or existing assignment update is required.
If the application rollout is reverted, leave this additive table intact. The migration
alone does not change onboarding behaviour; Admin and Shopify consumer changes follow.
