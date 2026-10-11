-- ARCH-033 generic internal incidents. Keep legacy MCP tables and all their rows intact.
-- Legacy MCP reads remain available until ARCH-033-MCP-001 adopts this canonical model.
CREATE TABLE "support"."OperationalIncident" (
 "id" TEXT NOT NULL,
 "incidentKey" VARCHAR(64) NOT NULL,
 "sourceService" VARCHAR(64) NOT NULL,
 "environment" VARCHAR(32) NOT NULL,
 "category" VARCHAR(64) NOT NULL,
 "reasonCode" VARCHAR(128) NOT NULL,
 "resourceKey" VARCHAR(128) NOT NULL,
 "shopId" TEXT,
 "severity" VARCHAR(16) NOT NULL,
 "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
 "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
 "firstOccurredAt" TIMESTAMPTZ(3) NOT NULL,
 "lastOccurredAt" TIMESTAMPTZ(3) NOT NULL,
 "lastCorrelationId" VARCHAR(128) NOT NULL,
 "ownerPlatformAdminId" TEXT,
 "assignedAt" TIMESTAMPTZ(3),
 "resolvedAt" TIMESTAMPTZ(3),
 "resolvedByPlatformAdminId" TEXT,
 "resolutionNote" VARCHAR(1000),
 "revision" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "OperationalIncident_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OperationalIncident_status_check" CHECK (
   ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByPlatformAdminId" IS NULL AND "resolutionNote" IS NULL)
   OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedByPlatformAdminId" IS NOT NULL AND "resolutionNote" IS NOT NULL AND length(btrim("resolutionNote")) > 0)),
 CONSTRAINT "OperationalIncident_assignment_check" CHECK (
   ("ownerPlatformAdminId" IS NULL AND "assignedAt" IS NULL)
   OR ("ownerPlatformAdminId" IS NOT NULL AND "assignedAt" IS NOT NULL)),
 CONSTRAINT "OperationalIncident_occurrence_check" CHECK ("occurrenceCount" > 0),
 CONSTRAINT "OperationalIncident_revision_check" CHECK ("revision" >= 0),
 CONSTRAINT "OperationalIncident_time_check" CHECK ("lastOccurredAt" >= "firstOccurredAt"),
 CONSTRAINT "OperationalIncident_severity_check" CHECK ("severity" IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 CONSTRAINT "OperationalIncident_environment_check" CHECK ("environment" IN ('local','development','test','staging','production'))
);
CREATE UNIQUE INDEX "OperationalIncident_incidentKey_key" ON "support"."OperationalIncident"("incidentKey");
CREATE INDEX "OperationalIncident_environment_status_lastOccurredAt_idx" ON "support"."OperationalIncident"("environment","status","lastOccurredAt");
CREATE INDEX "OperationalIncident_sourceService_status_lastOccurredAt_idx" ON "support"."OperationalIncident"("sourceService","status","lastOccurredAt");
CREATE INDEX "OperationalIncident_ownerPlatformAdminId_status_idx" ON "support"."OperationalIncident"("ownerPlatformAdminId","status");
CREATE INDEX "OperationalIncident_shopId_status_idx" ON "support"."OperationalIncident"("shopId","status");
ALTER TABLE "support"."OperationalIncident" ADD CONSTRAINT "OperationalIncident_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "support"."OperationalIncident" ADD CONSTRAINT "OperationalIncident_ownerPlatformAdminId_fkey" FOREIGN KEY ("ownerPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support"."OperationalIncident" ADD CONSTRAINT "OperationalIncident_resolvedByPlatformAdminId_fkey" FOREIGN KEY ("resolvedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "support"."OperationalIncidentEvent" (
 "id" UUID NOT NULL,
 "incidentId" TEXT NOT NULL,
 "eventType" VARCHAR(32) NOT NULL,
 "actorPlatformAdminId" TEXT,
 "correlationId" VARCHAR(128),
 "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OperationalIncidentEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OperationalIncidentEvent_type_check" CHECK ("eventType" IN ('OCCURRED','CLAIMED','RELEASED','REASSIGNED','RESOLVED','REOPENED')),
 CONSTRAINT "OperationalIncidentEvent_actor_check" CHECK (("eventType" IN ('OCCURRED','REOPENED')) OR "actorPlatformAdminId" IS NOT NULL)
);
CREATE INDEX "OperationalIncidentEvent_incidentId_occurredAt_idx" ON "support"."OperationalIncidentEvent"("incidentId","occurredAt");
CREATE INDEX "OperationalIncidentEvent_actorPlatformAdminId_occurredAt_idx" ON "support"."OperationalIncidentEvent"("actorPlatformAdminId","occurredAt");
ALTER TABLE "support"."OperationalIncidentEvent" ADD CONSTRAINT "OperationalIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "support"."OperationalIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "support"."OperationalIncidentEvent" ADD CONSTRAINT "OperationalIncidentEvent_actorPlatformAdminId_fkey" FOREIGN KEY ("actorPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Append-only event writes: reject UPDATE/DELETE; FK cascades still perform referential cleanup.
CREATE FUNCTION "support"."reject_operational_incident_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'operational incident history is append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OperationalIncidentEvent_immutable" BEFORE UPDATE OR DELETE ON "support"."OperationalIncidentEvent"
FOR EACH ROW EXECUTE FUNCTION "support"."reject_operational_incident_event_mutation"();
