# ARCH-032: MCP operational events

The `support.McpOperationalEvent` table is an append-only application-event record
for MCP tool failures requiring support. Its `id` is the originating MCP error
occurrence UUID, not a deterministic incident identifier.

`support.McpOperationalIncident` is the durable OPEN/RESOLVED projection keyed by
a SHA-256 digest of `(shopId, capabilityKey, reasonCode)`. Repeated failures have
separate App Events but share an incident and one support `SYSTEM` message (unique
`MerchantSupportMessage.sourceKey`). All failure writes happen in one transaction.

A verified administrator can mark an incident resolved from the existing Admin
Support dashboard, which inserts `MCP_TOOL_EXECUTION_RESOLVED`. New failures reopen
that incident. Recovery is **not** inferred from an unrelated successful tool call.

No provider tokens, encrypted credential bytes, tool arguments or provider error
bodies may be written to the event or message rows. Support messages use safe
predefined text by exact stable MCP error code.
