-- ARCH-032-DATABASE-001: reuse the billing singleton for MCP policy.
-- A fresh `prisma migrate reset` or `prisma migrate deploy` must provision all
-- platform-policy defaults, including every supported MCP environment.
-- Existing billing edits are never overwritten; a previously absent MCP column
-- is backfilled once on upgrade, advancing the existing row-wide CAS version.
ALTER TABLE "billing"."PlatformBillingPolicy"
  ADD COLUMN "mcpExecutionPolicy" JSONB;

DO $migration$
DECLARE
  mcp_defaults JSONB := $policy$
{
    "schemaVersion": 1,
    "environments": {
        "LOCAL": {
            "toolDeadlineMs": 10000,
            "providerResponseTimeoutMs": 10000,
            "maxProviderRequests": 12,
            "maxResponseBytes": 262144
        },
        "TEST": {
            "toolDeadlineMs": 10000,
            "providerResponseTimeoutMs": 10000,
            "maxProviderRequests": 12,
            "maxResponseBytes": 262144
        },
        "DEVELOPMENT": {
            "toolDeadlineMs": 10000,
            "providerResponseTimeoutMs": 10000,
            "maxProviderRequests": 12,
            "maxResponseBytes": 262144
        },
        "STAGING": {
            "toolDeadlineMs": 10000,
            "providerResponseTimeoutMs": 10000,
            "maxProviderRequests": 12,
            "maxResponseBytes": 262144
        },
        "PRODUCTION": {
            "toolDeadlineMs": 10000,
            "providerResponseTimeoutMs": 10000,
            "maxProviderRequests": 12,
            "maxResponseBytes": 262144
        }
    }
}
$policy$::jsonb;
BEGIN
  INSERT INTO "billing"."PlatformBillingPolicy" (
    "id", "globalPauseNewRecoveries", "globalPauseAutomatedWhatsapp",
    "lifetimeFreeRecoveryAllowance", "minimumUpgradePremiumBps",
    "absoluteOutboundHardLimit", "defaultWarningPercent",
    "defaultOutboundSoftLimit", "defaultOutboundHardLimit",
    "terminalMessageReservedSlots", "whatsappRecipientSuppressionDays",
    "mcpExecutionPolicy", "version", "createdAt", "updatedAt"
  ) VALUES (
    'default', false, false,
    5, 2000,
    2000, 80,
    1000, 2000,
    1, 7,
    mcp_defaults, 0, now(), now()
  )
  ON CONFLICT ("id") DO NOTHING;

  -- For databases upgrading from an older schema, provision only the previously
  -- nonexistent MCP policy. Do not change other billing fields or a non-null
  -- configured policy. Bump version so previously captured forms cannot replay.
  UPDATE "billing"."PlatformBillingPolicy"
  SET "mcpExecutionPolicy" = mcp_defaults,
      "version" = "version" + 1,
      "updatedAt" = now()
  WHERE "id" = 'default' AND "mcpExecutionPolicy" IS NULL;
END
$migration$;
