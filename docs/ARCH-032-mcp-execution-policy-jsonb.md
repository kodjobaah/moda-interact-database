# ARCH-032-DATABASE-001 — MCP execution policy storage contract

The canonical storage is **`billing.PlatformBillingPolicy`**, singleton key
`id = "default"`, not a separate MCP table. This task adds nullable
`mcpExecutionPolicy` JSONB and reuses the existing whole-row `version` token.
The migration **creates the default platform policy singleton on a fresh database**
and backfills its MCP JSONB on upgrade, without changing existing billing values.
The existing row-wide `version` remains the only optimistic-concurrency token;
there is no additional policy table, environment column or version column.

## JSON shape

```json
{
  "schemaVersion": 1,
  "environments": {
    "DEVELOPMENT": {
      "toolDeadlineMs": 10000,
      "providerResponseTimeoutMs": 10000,
      "maxProviderRequests": 12,
      "maxResponseBytes": 262144
    }
  }
}
```

The numeric values shown above are the **seeded defaults**, taken from the
current MCP 10-second tool/provider deadlines, 12-request budget, and 256-KiB
response limit. The same values are seeded for **LOCAL, TEST, DEVELOPMENT,
STAGING and PRODUCTION**. No other implicit fallback is permitted: an operator
may subsequently remove an environment policy, and MCP-015 must fail closed
when it is absent or invalid. The only allowed
environment keys are the current `commerce.CommerceEnvironment` labels:
`LOCAL`, `TEST`, `DEVELOPMENT`, `STAGING`, and `PRODUCTION`. The object can
contain any subset of these keys, including none. An absent entry is
unconfigured and must never inherit another environment's policy.

Consumers (Admin at write time and MCP before provider access) must validate
the **complete** object: exactly `schemaVersion` and `environments` at the
root, `schemaVersion === 1`, an object for `environments`, no unknown keys,
and, for each present entry, exactly the four named fields, each an integer
within the following **initial proposed safety envelope** (all inclusive):

| Field | Range | Reason for upper bound |
| --- | --- | --- |
| `toolDeadlineMs` | 1–120000 | Avoid multi-minute work occupying MCP workers; well below Node timer overflow |
| `providerResponseTimeoutMs` | 1–60000 | Bound each external provider call to at most one minute |
| `maxProviderRequests` | 1–64 | Bound provider-call amplification per tool execution |
| `maxResponseBytes` | 1–1048576 | Bound aggregate serialized tool-result memory to 1 MiB |

These are **validation ceilings**, distinct from the explicitly seeded defaults.
They permit the current 10000 ms / 12 requests / 262144 bytes while allowing reviewed
per-environment settings. ADMIN-001 and MCP-015 must apply these same ceilings
consistently; no policy may execute until MCP-015 performs that validation.

Reject booleans, strings,
floating-point numbers, zeros, negatives, non-finite/overflow values, arrays,
unknown schema versions and unknown fields. Require
`providerResponseTimeoutMs <= toolDeadlineMs`. The numeric ceilings must be
agreed and implemented consistently in ADMIN-001 and MCP-015; the database
column itself does not claim to validate these nested JSON fields. Until those
consumers are deployed, the column is storage only, **not** an enabled MCP
execution policy.

A missing singleton, SQL NULL JSONB, JSON `null`, absent environment, or
invalid/unknown-version JSON represents unavailable/unconfigured policy, never
an implicit runtime default. MCP-015 is responsible for distinguishing missing,
invalid and PostgreSQL unavailable conditions and failing closed before any
provider requests. The migration provisions the singleton on fresh databases and fills the previously absent MCP policy on upgrade. Subsequent operator clears must not be auto-repaired by a running service or repeated seed.

## Whole-row optimistic concurrency

Admin reads the singleton and its existing `version`. To change one environment,
perform **one atomic conditional update** on `id = 'default' AND version = <seen>`.
For example (values represented as bound parameters by the caller):

```sql
UPDATE "billing"."PlatformBillingPolicy"
SET "mcpExecutionPolicy" = jsonb_set(
      COALESCE("mcpExecutionPolicy", '{"schemaVersion":1,"environments":{}}'::jsonb),
      '{environments,DEVELOPMENT}', $1::jsonb, true
    ),
    "version" = "version" + 1,
    "updatedAt" = now()
WHERE "id" = 'default' AND "version" = $2
RETURNING "version";
```

This example is only valid **after validating** the existing JSON, the supplied
entry and its schema. The Admin write path must not repair malformed existing
JSON by overwriting it with a default or silently discard unrelated entries.
For clearing an environment, remove only its JSON key using PostgreSQL `#-`
and increment the same `version`, even if clearing the last environment makes
the whole field SQL NULL. A zero-row UPDATE indicates a version conflict or
missing singleton and must be surfaced, not turned into unconditional upsert.

The `version` column is shared with billing configuration. All Admin billing and
MCP writes must use the same CAS token and increment it, including clear, so
concurrent edits and stale create-clear-replay cannot silently overwrite a newer
state. This repository supplies the schema and PostgreSQL proof of the **CAS
mechanic**, but adapting existing Admin billing mutation paths belongs to
ARCH-032-ADMIN-001; schema alone does not force all callers to use CAS.

No real credentials or per-shop secrets belong in this JSONB column.
