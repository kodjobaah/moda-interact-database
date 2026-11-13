# Meta template sample operation state

`whatsapp.MetaTemplateAppOperationState` is a dedicated durable throttle and
lease carrier. Its composite identity is `(environment, appId)`, using the
existing `commerce.CommerceEnvironment` and a numeric app ID of 1–32 digits.
Meta's application quota spans WABAs and shops, so this is deliberately not a
tenant- or WABA-scoped row. It stores no credentials, image bytes, upload handles,
customer data or provider responses, and has no foreign-key cascade.

## Consumer contract

| Field | Storage |
| --- | --- |
| environment, appId | Composite primary key |
| cooldownUntil | Nullable timestamptz(3) |
| consecutiveThrottleCount | Integer, default 0, 0–31 inclusive; writer saturates |
| lastThrottleAt | Nullable timestamptz(3) |
| leaseOwnerToken | Nullable varchar(128), nonempty when owned |
| leaseGeneration | Nonnegative bigint, default 0, monotonic |
| leaseAcquiredAt, leaseUntil | Nullable timestamptz(3), set with owner as one tuple |
| updatedAt | timestamptz(3), Prisma updated-at/default now |

Background owns the policy: one lease covers one bounded sample operation,
120 seconds; the first evidenced application throttle waits 15 minutes, doubles
to a six-hour cap, and subsequent replicas/cycles defer during the same durable
cooldown. Database storage does not make a provider request, cache a sample,
reset registration state or authorize a template-create retry.

A new lease owner/acquisition must increment the generation. A live lease cannot
be replaced by another acquisition before expiry. Release clears the complete
nullable tuple while retaining the generation. Renewals keep owner, generation
and acquisition time. A future cooldown cannot be shortened or cleared by a
completion, and an existing last-throttle timestamp cannot be erased/backdated.
Rows are retained rather than deleted to prevent fencing/cooldown reset.

Every completion/throttle/release must still compare-and-set on **environment,
app ID, owner token, generation and unexpired lease** in the same short
transaction. SQL cannot infer the caller's previously observed token; the
consumer must supply those predicates. An expired owner must not clear a new
owner's lease even if it finishes late. Reclaim increments generation, preventing
ABA when a token is reused. The consumer must preserve an existing longer
cooldown when recording a new one. No network call belongs inside a transaction.

## Query paths and volume

The primary key is the only index: acquire, observe, throttle and fenced complete
all address one configured app in one environment. There is no global scheduler
scan, per-message row or event-hot-path write. Cardinality grows by configured
application/environment, not by the expected 20,000 Shopify events per minute.
Cooldown causes read/defer, not an upload per locale or an uncontrolled connection
fanout. Short row-CAS transactions serialize the inherently shared app quota;
provider upload is outside the transaction. No retention/cleanup index is needed.

The [focused ERD](generated/arch075-meta-app-operation-state.puml) documents the
standalone model; it intentionally adds no tenant relation or scheduler enum.

## Rollout

Apply this additive migration before deploying Background007. Old versions do not
query the new table and remain compatible. No existing row/table/migration is
rewritten and no backfill is required. Rollback means stopping the new producer
before rolling back consumers while retaining the table and its outcome state;
there is no destructive down migration. Root owns hosted migration/deployment.
