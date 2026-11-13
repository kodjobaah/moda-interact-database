# Ordered recovery delivery persistence

`ConversationMessage` remains the single logical billing, conversation-history and
HUMAN-command anchor. This migration does not modify existing root columns,
statuses, constraints, provider IDs or historical rows. Old writers need no
backfill and continue to create roots without child parts.

## Physical part contract

`whatsapp.ConversationDeliveryPart` references the logical root by `messageId`.
`ordinal` is a small integer from 0 through 2, unique within the root. This bounds
physical fanout and storage to three parts; the Shared plan and Background freeze
transaction own contiguous ordering and role composition.

The immutable preparation is `id`, `messageId`, `ordinal`, `role`, `payload`,
`payloadDigest`, `sourceIdentity`, `deadlineAt`, `providerAccountId`,
`providerPhoneNumberId` and `createdAt`. `payload` is an object bounded to 64 KiB;
`sourceIdentity` is an application-owned authority object bounded to 16 KiB; the
digest is a 64-character lower-case hexadecimal SHA-256. Database code does not
reimplement the Shared media validator or Background authorization policy.

Roles are `HEADER`, `PRODUCT`, `ANSWER`. States are `PREPARED`, `ADMITTED`,
`ACKNOWLEDGED`, `DELIVERED`, `READ`, `FAILED`, `UNKNOWN`, `CANCELLED`. Background owns
the complete state machine and original authority checks. Database anti-reset
and evidence guards prohibit reopening a part as unattempted, regressing a read
or delivered result, changing an assigned provider identity/permit or overwriting
existing outcome timestamps. An `UNKNOWN` attempt cannot discard its permit.

`providerDispatchKey` and `providerDispatchAdmittedAt` are set together once.
`providerMessageId` and `acknowledgedAt` are also set together once, and require an
existing dispatch permit. Provider/dispatch IDs are independently unique across
parts. A `READ` result may be persisted before a delivered callback: there is no
incorrect arrival-time ordering constraint. An existing timestamp is preserved
rather than overwritten by a duplicate or older event.

The root remains pending until the owning engine can truthfully aggregate its
parts. This schema does not turn an accepted header into a successful logical
reply or create additional billing usage. No provider call or state transition
service is installed by a migration.

## Early status receipts

`whatsapp.ConversationDeliveryStatusReceipt` stores only normalized sender IDs,
provider message ID, `SENT`/`DELIVERED`/`READ`/`FAILED`, provider timestamp, receipt
time and an optional bounded failure code. It stores no raw webhook or customer
JSON. Its unique identity is the account, sender phone, provider message, status
and provider timestamp tuple.

The optional `partId` may be assigned once after ACK persistence. A database guard
requires that both sender IDs and the provider message ID match the exact part.
A status from another sender therefore cannot attach merely because it supplies
a matching global message ID. The received fact is immutable; only its first
legitimate attachment is allowed. Unknown receipts are retained by Background
for at most seven days with bounded cleanup pages.

## Access paths, concurrency and retention

- Root plus ordinal uniqueness supports freeze/idempotency checks and ordered
  reads, with a maximum of three rows per logical reply.
- Unique part dispatch key and provider message ID support atomic dispatch CAS
  and callback/quoted-reply lookup.
- `(state, deadlineAt)` supports bounded repair/deadline scans. Callback work uses
  exact root/part identities rather than a global conversation scan.
- The sender-prefixed receipt unique index also supports sender/message ACK
  correlation. `partId` supports attached receipt lookup and cascading deletion.
- The partial `(receivedAt, id) WHERE partId IS NULL` index supports only bounded
  unmatched-retention cleanup pages.

Foreign keys cascade from root to parts to attached receipts; unrelated unmatched
receipts remain available for bounded retention. Transactions never call a
provider and need not wait for delivery webhooks. A dispatch compare-and-set on
an unattempted part can have only one winner under concurrency.

The task-scoped [ERD](generated/arch075-delivery-parts.png) shows the new models
and their existing logical root. The main PlantUML source includes the same new
blocks without reconciling unrelated historical generator drift.

## Deployment compatibility

Apply the additive migration before deploying a consumer that queries these
models. Existing application versions remain compatible because no existing
object or required root field changes. Enabling new manifests requires the
coordinated Shared/Background rollout. Disabling new generation and preserving
all existing part outcomes is required before rolling back to old consumers;
this migration has no destructive down migration.

The PostgreSQL tests cover fresh and populated upgrades, original HUMAN command
triggers and concurrent permit acquisition. A separate invocation-owned fixture
runs the real `prisma migrate deploy` CLI with a synthetic historical audit whose
migration file is absent, then applies this pending migration and reruns as a
no-op. This is not permission to rewrite or fabricate hosted migration history.
