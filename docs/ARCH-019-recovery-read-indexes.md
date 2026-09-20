# ARCH-019 recovery read indexes

Adds four non-unique B-tree indexes without changing fields, rows, constraints,
existing indexes or runtime business behaviour.

| Index columns | Query supported |
|---|---|
| CheckoutRecovery(shopId, detectedAt, id) | Tenant/date cohort, newest-first keyset pages |
| CheckoutRecovery(shopId, status, detectedAt, id) | Single-status tenant/date pages |
| CheckoutRecovery(shopId, customerId, detectedAt, id) | Same-tenant customer recovery pages |
| ConversationMessage(conversationId, createdAt, id) | Chronological/latest transcript windows with stable ties |

Equality prefixes allow reverse B-tree scans for DESC/DESC. Multi-status IN
filters may use the general tenant/date index or another planner-selected plan;
the status index does not guarantee sort elimination across several statuses.
These indexes add storage and write amplification. They do not index arbitrary
substring search or make full-cohort aggregates constant-cost.

## Validation

Fast local checks:

```bash
npm run test:arch019-recovery-indexes
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/moda_interact npm run prisma:validate
git diff --check
```

The connection string here is only a local validation placeholder; Prisma validate
does not apply migrations. No environment secrets are needed for the static test.

Developer-owned populated rehearsal (requires Docker):

```bash
bash scripts/rehearse-arch019-recovery-indexes.sh
```

Run from the dedicated implementation worktree. The script creates a run-scoped
PostgreSQL 16 container with no host port or bind mount, applies all earlier
migration SQL, inserts two shops with 20,000 recoveries and 201,980 messages
(including tied timestamps and long transcripts), captures before plans, applies
the new migration on populated tables, verifies row counts/content fingerprints
and preservation of old indexes, and captures after plans using the default
planner. It removes only its own successfully created container on exit. Logs
remain at the printed temporary evidence directory. Supply full.log, command,
exit code and tested commit for review. This is a SQL migration rehearsal, not
a Prisma migration-history/deploy-engine test. No measured performance claim is
made until the developer supplies this evidence.

No live/shared database URL is consumed. The local Docker daemon must be intended
for disposable test work; the script does not stop existing containers, inspect
host ports, reuse a developer database or force planner index selection.

## Migration authoring and deployment

Migration: `20260920120000_arch019_merchant_recovery_read_indexes`.
SQL is additive and is checked against the offline Prisma schema diff. A local
`prisma migrate dev` run is deferred with the developer-owned database validation;
no default development database is migrated or reset during agent execution.

Use the repository's `npm run migrate:deploy` through the normal developer-owned
deployment workflow before the app release. First rehearse against a representative
populated local copy; this synthetic fixture does not measure production lock time.
These are ordinary CREATE INDEX statements, not CONCURRENTLY: reads can continue,
writes on the affected table wait while its index builds. A transaction wrapping
the whole migration can retain locks through all four builds. Allow disk/headroom,
schedule an appropriate low-write window and set deployment lock/statement timeouts
according to the actual environment. If that write-blocking window is unacceptable,
return to the architect for a separately reviewed concurrent build strategy rather
than silently changing the approved migration in a deployed environment.

Index names intentionally match Prisma defaults. No IF NOT EXISTS hides a conflicting
definition. Migration failure requires normal migration diagnosis/resolution before
retry; never rewrite previously deployed history. Existing applications remain
compatible throughout. No worker/provider/queue changes or data backfill are needed.

## Rollback and consumption

Preferred rollback: deploy the prior app version and leave these harmless additive
indexes in place. If removal is specifically approved, use a new database-owned
migration dropping only these four schema-qualified indexes after reviewing active
consumers; ordinary DROP INDEX also takes locks. Do not roll back by dropping tables,
resetting migration history or editing the applied migration file.

Downstream app tasks consume the architect-accepted published database task commit
recorded in the Completion Report, then update their nested database Gitlink
deliberately in their own task worktree. A pushed commit is not architect acceptance.
Top-level workspace Gitlink integration remains developer-owned after main merge.

ERD entities/fields/relationships are unchanged; the current PlantUML generator does
not depict secondary composite indexes, so no diagram change is needed.
