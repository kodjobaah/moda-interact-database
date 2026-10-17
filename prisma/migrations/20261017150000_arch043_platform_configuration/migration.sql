-- ARCH-043-DATABASE-001. Additive, no seed and no modifications to domain-owned
-- configuration. All input validation, actor authorisation, unseal key management
-- and CAS+audit orchestration are responsibilities of the approved writers.
CREATE TABLE "public"."PlatformConfiguration" (
    "id" TEXT NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" VARCHAR(191),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformConfiguration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformConfiguration_environment_nonblank" CHECK (btrim("environment") <> ''),
    CONSTRAINT "PlatformConfiguration_key_nonblank" CHECK (btrim("key") <> ''),
    CONSTRAINT "PlatformConfiguration_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "PlatformConfiguration_value_object" CHECK (jsonb_typeof("value") = 'object'),
    CONSTRAINT "PlatformConfiguration_sealed_secret_only" CHECK (
      "key" NOT IN (
        'commerce.connectionKeys', 'auth.admin', 'auth.commerce',
        'shopify.oauth', 'messaging.meta'
      ) OR COALESCE((
        -- A secret may be revoked without resetting its monotonically increasing revision.
        "value" = '{"kind":"disabled","schemaVersion":1}'::jsonb
        OR (
          "value"->>'kind' = 'sealed'
          AND "value"->>'schemaVersion' = '1'
          AND jsonb_typeof("value"->'schemaVersion') = 'number'
          AND "value"->>'algorithm' = 'AES-256-GCM'
          AND jsonb_typeof("value"->'wrappingKeyId') = 'string'
          AND btrim("value"->>'wrappingKeyId') <> ''
          AND jsonb_typeof("value"->'nonce') = 'string'
          AND btrim("value"->>'nonce') <> ''
          AND jsonb_typeof("value"->'ciphertext') = 'string'
          AND btrim("value"->>'ciphertext') <> ''
          AND jsonb_typeof("value"->'authTag') = 'string'
          AND btrim("value"->>'authTag') <> ''
          AND "value" - 'kind' - 'schemaVersion' - 'algorithm'
            - 'wrappingKeyId' - 'nonce' - 'ciphertext' - 'authTag' = '{}'::jsonb
        )
      ), FALSE)
    )
);

CREATE UNIQUE INDEX "PlatformConfiguration_environment_key_key"
  ON "public"."PlatformConfiguration"("environment", "key");
CREATE INDEX "PlatformConfiguration_environment_updatedAt_idx"
  ON "public"."PlatformConfiguration"("environment", "updatedAt");

CREATE TABLE "public"."PlatformConfigurationAudit" (
    "id" TEXT NOT NULL,
    "environment" VARCHAR(32) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "resultingVersion" INTEGER NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB NOT NULL,
    "actorId" VARCHAR(191) NOT NULL,
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformConfigurationAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformConfigurationAudit_environment_nonblank" CHECK (btrim("environment") <> ''),
    CONSTRAINT "PlatformConfigurationAudit_key_nonblank" CHECK (btrim("key") <> ''),
    CONSTRAINT "PlatformConfigurationAudit_actor_nonblank" CHECK (btrim("actorId") <> ''),
    CONSTRAINT "PlatformConfigurationAudit_expected_nonnegative" CHECK ("expectedVersion" >= 0),
    CONSTRAINT "PlatformConfigurationAudit_revision_step" CHECK ("resultingVersion" = "expectedVersion" + 1),
    CONSTRAINT "PlatformConfigurationAudit_after_object" CHECK (jsonb_typeof("afterValue") = 'object'),
    CONSTRAINT "PlatformConfigurationAudit_before_object" CHECK (
      "beforeValue" IS NULL OR jsonb_typeof("beforeValue") = 'object'
    ),
    CONSTRAINT "PlatformConfigurationAudit_secret_redacted" CHECK (
      "key" NOT IN (
        'commerce.connectionKeys', 'auth.admin', 'auth.commerce',
        'shopify.oauth', 'messaging.meta'
      ) OR COALESCE((
        -- Closed shape: no plaintext, nonce, ciphertext, tags or arbitrary metadata.
        "afterValue" ? 'redacted'
        AND "afterValue"->'redacted' = 'true'::jsonb
        AND "afterValue" ? 'configured'
        AND "afterValue"->'configured' IN ('true'::jsonb, 'false'::jsonb)
        AND "afterValue" - 'redacted' - 'configured' = '{}'::jsonb
        AND (
          "beforeValue" IS NULL OR (
            "beforeValue" ? 'redacted'
            AND "beforeValue"->'redacted' = 'true'::jsonb
            AND "beforeValue" ? 'configured'
            AND "beforeValue"->'configured' IN ('true'::jsonb, 'false'::jsonb)
            AND "beforeValue" - 'redacted' - 'configured' = '{}'::jsonb
          )
        )
      ), FALSE)
    )
);

CREATE UNIQUE INDEX "PlatformConfigurationAudit_environment_key_resultingVersion_key"
  ON "public"."PlatformConfigurationAudit"("environment", "key", "resultingVersion");
CREATE INDEX "PlatformConfigurationAudit_environment_key_createdAt_idx"
  ON "public"."PlatformConfigurationAudit"("environment", "key", "createdAt");
CREATE INDEX "PlatformConfigurationAudit_actorId_createdAt_idx"
  ON "public"."PlatformConfigurationAudit"("actorId", "createdAt");

-- An audit record is historical evidence. Protect it from normal SQL UPDATE,
-- DELETE and TRUNCATE, including direct Prisma/SQL bypasses. Owner/superuser
-- DDL can still deliberately disable a trigger and is out of the app-role model.
CREATE FUNCTION "public"."prevent_platform_configuration_audit_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $audit$
BEGIN
  RAISE EXCEPTION 'PlatformConfigurationAudit is append-only' USING ERRCODE = '55000';
END;
$audit$;

CREATE TRIGGER "PlatformConfigurationAudit_no_update_delete"
  BEFORE UPDATE OR DELETE ON "public"."PlatformConfigurationAudit"
  FOR EACH ROW EXECUTE FUNCTION "public"."prevent_platform_configuration_audit_mutation"();

CREATE TRIGGER "PlatformConfigurationAudit_no_truncate"
  BEFORE TRUNCATE ON "public"."PlatformConfigurationAudit"
  FOR EACH STATEMENT EXECUTE FUNCTION "public"."prevent_platform_configuration_audit_mutation"();
