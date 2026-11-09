# Frozen conversation delivery plans (ARCH-068)

`ConversationMessage.outboundPresentation` is optional JSONB with no default,
backfill, index or separate table. Existing records and writers that omit it
retain SQL NULL and their legacy delivery behavior. The migration changes only
this column; existing message content, TEXT classification, provider receipt,
media/transcription fields and relationships are unchanged.

Deploy `20261109210000_arch068_conversation_delivery_plan` before deploying
Background readers/writers that reference the field. Generate consuming Prisma
clients from this schema. This database task does not activate a wrapper or
change application send behavior. On application rollback, retain the additive
column and stored plans; dropping it would destroy frozen retry information.

The application owns validation using the published
`ConversationDeliveryPlanSchema`, requiring plan.body to equal message content,
and tenant/product receipt verification at final admission. Database JSONB
storage is not an authorization receipt. TEXT and IMAGE are structured plans;
legacy NULL is never inferred from message text or upgraded on retry. IMAGE
messages retain ordinary content/contentType TEXT; an R2 URL must not be stored
in providerMediaId. The existing providerMessageId remains the single receipt.
No credentials, recipients or merchant source URLs belong in the plan.

No new query/index is needed: the column is fetched with the existing locked
message by ID. There is one nullable column addition, no row rewriting backfill,
extra per-event lookup, index growth or cleanup process. PostgreSQL still takes
its normal ALTER TABLE lock, so deployment timing remains an operator concern.

## Local validation

- `npm run prisma:validate`
- `npm run prisma:generate`
- `npm run test:arch068-conversation-delivery-plan`
- `npm run test:arch068-conversation-delivery-plan:postgres`
- `npm run lint`

The PostgreSQL test uses one invocation-labelled, network-isolated local
pgvector17 container and removes only its own container in finally. It applies
historical migrations to fresh and upgrade databases, proves old rows unchanged
apart from the nullable column, and roundtrips representative TEXT/IMAGE JSON.
It also proves old-writer omission, no default, and unchanged content/receipt/
media fields. It neither connects to the developer database nor validates
Shared delivery-plan semantics or Background admission.
