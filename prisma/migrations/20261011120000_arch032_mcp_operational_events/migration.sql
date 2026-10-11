-- ARCH-032 MCP: durable operational incident state plus append-only application events.
-- Existing merchant support threads/messages are reused; no separate inbox is created.
CREATE TABLE "support"."McpOperationalIncident" (
  "id" TEXT NOT NULL,
  "incidentKey" VARCHAR(64) NOT NULL,
  "shopId" TEXT NOT NULL,
  "capabilityKey" VARCHAR(128) NOT NULL,
  "reasonCode" VARCHAR(128) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstOccurredAt" TIMESTAMPTZ(3) NOT NULL,
  "lastOccurredAt" TIMESTAMPTZ(3) NOT NULL,
  "lastErrorId" UUID NOT NULL,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "McpOperationalIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpOperationalIncident_status_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL) OR
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL)
  ),
  CONSTRAINT "McpOperationalIncident_occurrences_check" CHECK ("occurrenceCount" > 0)
);
CREATE UNIQUE INDEX "McpOperationalIncident_incidentKey_key"
  ON "support"."McpOperationalIncident" ("incidentKey");
CREATE INDEX "McpOperationalIncident_status_lastOccurredAt_idx"
  ON "support"."McpOperationalIncident" ("status", "lastOccurredAt");
CREATE INDEX "McpOperationalIncident_shopId_status_idx"
  ON "support"."McpOperationalIncident" ("shopId", "status");
ALTER TABLE "support"."McpOperationalIncident"
  ADD CONSTRAINT "McpOperationalIncident_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE TABLE "support"."McpOperationalEvent" (
  "id" UUID NOT NULL,
  "shopId" TEXT NOT NULL,
  "incidentKey" VARCHAR(64) NOT NULL,
  "capabilityKey" VARCHAR(128) NOT NULL,
  "reasonCode" VARCHAR(128) NOT NULL,
  "eventType" VARCHAR(48) NOT NULL,
  "actorAdminId" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpOperationalEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "McpOperationalEvent_type_check" CHECK (
    "eventType" IN ('MCP_TOOL_EXECUTION_BLOCKED', 'MCP_TOOL_EXECUTION_RESOLVED')
  )
);
CREATE INDEX "McpOperationalEvent_incidentKey_occurredAt_idx"
  ON "support"."McpOperationalEvent" ("incidentKey", "occurredAt");
CREATE INDEX "McpOperationalEvent_shopId_occurredAt_idx"
  ON "support"."McpOperationalEvent" ("shopId", "occurredAt");
ALTER TABLE "support"."McpOperationalEvent"
  ADD CONSTRAINT "McpOperationalEvent_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
