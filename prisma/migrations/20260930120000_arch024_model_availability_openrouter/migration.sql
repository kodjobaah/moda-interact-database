-- ARCH-024 pre-production breaking model-availability and OpenRouter schema.

CREATE TYPE "commerce"."CommerceModelAvailabilityScope" AS ENUM ('PLATFORM', 'SHOP');

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_MODEL_AVAILABILITY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_MODEL_AVAILABILITY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ENABLE_MODEL_AVAILABILITY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_MODEL_AVAILABILITY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_OPENROUTER_CREDENTIAL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REPLACE_OPENROUTER_CREDENTIAL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REMOVE_OPENROUTER_CREDENTIAL';

CREATE TABLE "commerce"."CommerceModelAvailability" (
  "id" TEXT NOT NULL,
  "scope" "commerce"."CommerceModelAvailabilityScope" NOT NULL,
  "shopId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceModelAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceModelAvailability_scope_shop_check" CHECK (("scope" = 'PLATFORM' AND "shopId" IS NULL) OR ("scope" = 'SHOP' AND "shopId" IS NOT NULL)),
  CONSTRAINT "CommerceModelAvailability_edit_version_check" CHECK ("editVersion" > 0),
  CONSTRAINT "CommerceModelAvailability_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceModelAvailability_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceModelAvailability_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceModelAvailability_shopId_key" ON "commerce"."CommerceModelAvailability"("shopId");
CREATE UNIQUE INDEX "CommerceModelAvailability_one_platform" ON "commerce"."CommerceModelAvailability" ((1)) WHERE "scope" = 'PLATFORM' AND "shopId" IS NULL;
CREATE INDEX "CommerceModelAvailability_scope_enabled_id_idx" ON "commerce"."CommerceModelAvailability"("scope", "enabled", "id");

INSERT INTO "commerce"."CommerceModelAvailability" (
  "id", "scope", "shopId", "enabled", "editVersion", "createdByAdminId", "updatedByAdminId"
) VALUES (
  'arch024-platform-model-availability', 'PLATFORM', NULL, true, 1, NULL, NULL
) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "commerce"."CommerceModelCatalogueEntry"
  DROP CONSTRAINT "CommerceModelCatalogueEntry_provider_model_id_check";
DROP INDEX "commerce"."CommerceModelCatalogueEntry_provider_providerModelId_key";
DROP INDEX "commerce"."CommerceModelCatalogueEntry_enabled_provider_displayName_id_idx";

ALTER TABLE "commerce"."CommerceModelCatalogueEntry"
  ALTER COLUMN "provider" TYPE VARCHAR(64) USING lower("provider"::text),
  ADD COLUMN "availabilityId" TEXT NOT NULL DEFAULT 'arch024-platform-model-availability',
  ADD COLUMN "configurationSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb;
DROP TYPE "commerce"."CommerceModelProvider";
ALTER TABLE "commerce"."CommerceModelCatalogueEntry"
  ALTER COLUMN "availabilityId" DROP DEFAULT;
ALTER TABLE "commerce"."CommerceModelCatalogueEntry"
  ADD CONSTRAINT "CommerceModelCatalogueEntry_provider_check" CHECK ("provider" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  ADD CONSTRAINT "CommerceModelCatalogueEntry_provider_model_id_check" CHECK (length(btrim("providerModelId")) > 0),
  ADD CONSTRAINT "CommerceModelCatalogueEntry_configuration_schema_version_check" CHECK ("configurationSchemaVersion" > 0),
  ADD CONSTRAINT "CommerceModelCatalogueEntry_configuration_object_check" CHECK (jsonb_typeof("configuration") = 'object'),
  ADD CONSTRAINT "CommerceModelCatalogueEntry_availabilityId_fkey" FOREIGN KEY ("availabilityId") REFERENCES "commerce"."CommerceModelAvailability"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "CommerceModelCatalogueEntry_availabilityId_provider_providerModelId_key"
  ON "commerce"."CommerceModelCatalogueEntry"("availabilityId", "provider", "providerModelId");
CREATE INDEX "CommerceModelCatalogueEntry_availabilityId_enabled_displayName_id_idx"
  ON "commerce"."CommerceModelCatalogueEntry"("availabilityId", "enabled", "displayName", "id");
CREATE INDEX "CommerceModelCatalogueEntry_provider_providerModelId_idx"
  ON "commerce"."CommerceModelCatalogueEntry"("provider", "providerModelId");

CREATE FUNCTION commerce.arch024_model_availability_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ARCH024 model availability rows cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW."id", NEW."scope", NEW."shopId") IS DISTINCT FROM ROW(OLD."id", OLD."scope", OLD."shopId") THEN
    RAISE EXCEPTION 'ARCH024 model availability identity immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch024_model_availability_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "commerce"."CommerceModelAvailability"
  FOR EACH ROW EXECUTE FUNCTION commerce.arch024_model_availability_guard();

CREATE FUNCTION commerce.arch024_model_catalogue_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ARCH024 model catalogue entries cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW."id", NEW."provider", NEW."providerModelId") IS DISTINCT FROM ROW(OLD."id", OLD."provider", OLD."providerModelId") THEN
    RAISE EXCEPTION 'ARCH024 model catalogue identity immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch024_model_catalogue_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "commerce"."CommerceModelCatalogueEntry"
  FOR EACH ROW EXECUTE FUNCTION commerce.arch024_model_catalogue_guard();
DROP TRIGGER "arch021_model_catalogue_guard" ON "commerce"."CommerceModelCatalogueEntry";
DROP FUNCTION commerce.arch021_model_catalogue_guard();

ALTER TABLE "billing"."MerchantPricingPlan"
  ADD COLUMN "commerceModelId" TEXT,
  ADD CONSTRAINT "MerchantPricingPlan_commerceModelId_fkey" FOREIGN KEY ("commerceModelId") REFERENCES "commerce"."CommerceModelCatalogueEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "MerchantPricingPlan_commerceModelId_idx" ON "billing"."MerchantPricingPlan"("commerceModelId");

CREATE TABLE "commerce"."CommerceOpenRouterCredential" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyId" VARCHAR(64) NOT NULL,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOpenRouterCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOpenRouterCredential_nonce_length_check" CHECK (octet_length("nonce") = 12),
  CONSTRAINT "CommerceOpenRouterCredential_auth_tag_length_check" CHECK (octet_length("authTag") = 16),
  CONSTRAINT "CommerceOpenRouterCredential_ciphertext_length_check" CHECK (octet_length("ciphertext") BETWEEN 1 AND 8192),
  CONSTRAINT "CommerceOpenRouterCredential_key_id_check" CHECK (length(btrim("keyId")) > 0),
  CONSTRAINT "CommerceOpenRouterCredential_edit_version_check" CHECK ("editVersion" > 0),
  CONSTRAINT "CommerceOpenRouterCredential_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceOpenRouterCredential_environment_key" ON "commerce"."CommerceOpenRouterCredential"("environment");

ALTER TABLE "commerce"."CommerceAuditEvent"
  ADD COLUMN "modelAvailabilityId" TEXT,
  ADD CONSTRAINT "CommerceAuditEvent_modelAvailabilityId_fkey" FOREIGN KEY ("modelAvailabilityId") REFERENCES "commerce"."CommerceModelAvailability"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CommerceAuditEvent_modelAvailabilityId_createdAt_id_idx"
  ON "commerce"."CommerceAuditEvent"("modelAvailabilityId", "createdAt", "id");

ALTER TABLE "commerce"."CommerceAuditEvent" DROP CONSTRAINT "arch020_audit_targets";
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "arch020_audit_targets" CHECK (CASE
  WHEN "action"::text IN ('CREATE_CAPABILITY','UPDATE_CAPABILITY','ENABLE_CAPABILITY','DISABLE_CAPABILITY') THEN "capabilityId" IS NOT NULL
  WHEN "action"::text = 'UPDATE_FEATURE_BEHAVIOUR' THEN "featureId" IS NOT NULL
  WHEN "action"::text = 'CREATE_RELEASE' THEN "releaseId" IS NOT NULL
  WHEN "action"::text IN ('ACTIVATE_RELEASE','ROLLBACK_RELEASE') THEN "releaseId" IS NOT NULL AND "environment" IS NOT NULL
  WHEN "action"::text IN ('CREATE_TOOL','UPDATE_TOOL','ENABLE_TOOL','DISABLE_TOOL') THEN "toolId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_TOOL_DRAFT','UPDATE_TOOL_DRAFT','PUBLISH_TOOL_REVISION') THEN "toolId" IS NOT NULL AND "toolRevisionId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_MODEL_CATALOGUE_ENTRY','UPDATE_MODEL_CATALOGUE_ENTRY','ENABLE_MODEL_CATALOGUE_ENTRY','DISABLE_MODEL_CATALOGUE_ENTRY') THEN "modelCatalogueEntryId" IS NOT NULL
  WHEN "action"::text = 'SET_PLATFORM_MODEL_SELECTION' THEN "modelCatalogueEntryId" IS NOT NULL AND "environment" IS NOT NULL
  WHEN "action"::text IN ('SET_SHOP_MODEL_SELECTION','CLEAR_SHOP_MODEL_SELECTION') THEN "shopId" IS NOT NULL AND "modelCatalogueEntryId" IS NOT NULL AND "environment" IS NOT NULL
  WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE_CATEGORY','UPDATE_PROMPT_TEMPLATE_CATEGORY','ENABLE_PROMPT_TEMPLATE_CATEGORY','DISABLE_PROMPT_TEMPLATE_CATEGORY') THEN "promptTemplateCategoryId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE','UPDATE_PROMPT_TEMPLATE','ENABLE_PROMPT_TEMPLATE','DISABLE_PROMPT_TEMPLATE','UPDATE_PROMPT_TEMPLATE_CONTENT') THEN "promptTemplateId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE_DRAFT','UPDATE_PROMPT_TEMPLATE_DRAFT','PUBLISH_PROMPT_TEMPLATE_REVISION') THEN "promptTemplateId" IS NOT NULL AND "promptTemplateRevisionId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_AGENT_PROMPT','CREATE_AGENT_PROMPT_DRAFT','CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE','UPDATE_AGENT_PROMPT_DRAFT') THEN "agentPromptId" IS NOT NULL
  WHEN "action"::text = 'PUBLISH_AGENT_PROMPT_REVISION' THEN "agentPromptId" IS NOT NULL AND "agentPromptRevisionId" IS NOT NULL
  WHEN "action"::text IN ('SET_PLATFORM_PROMPT_POINTER','SET_SHOP_PROMPT_POINTER','CLEAR_SHOP_PROMPT_POINTER') THEN "agentPromptId" IS NOT NULL AND "agentPromptRevisionId" IS NOT NULL AND "environment" IS NOT NULL
  WHEN "action"::text IN ('UPSERT_AGENT_CONFIGURATION','SET_AGENT_MODEL','CLEAR_AGENT_MODEL','SET_AGENT_PROMPT','CLEAR_AGENT_PROMPT') THEN "agentConfigurationId" IS NOT NULL AND "environment" IS NOT NULL
  WHEN "action"::text IN ('GRANT_MERCHANT_STUDIO_ACCESS','UPDATE_MERCHANT_STUDIO_ACCESS','DISABLE_MERCHANT_STUDIO_ACCESS','BIND_MERCHANT_STUDIO_IDENTITY') THEN "merchantAccessId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_MODEL_AVAILABILITY','UPDATE_MODEL_AVAILABILITY','ENABLE_MODEL_AVAILABILITY','DISABLE_MODEL_AVAILABILITY') THEN "modelAvailabilityId" IS NOT NULL
  WHEN "action"::text = 'ASSIGN_MODEL_CATALOGUE_ENTRY_AVAILABILITY' THEN "modelCatalogueEntryId" IS NOT NULL AND "modelAvailabilityId" IS NOT NULL
  WHEN "action"::text IN ('SET_OPENROUTER_CREDENTIAL','REPLACE_OPENROUTER_CREDENTIAL','REMOVE_OPENROUTER_CREDENTIAL') THEN "environment" IS NOT NULL
  ELSE false END);