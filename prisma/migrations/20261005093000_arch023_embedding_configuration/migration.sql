-- ARCH-023 database-backed embedding runtime configuration.
--
-- One encrypted, hot-swappable configuration exists per CommerceEnvironment
-- and embedding purpose. The plaintext provider API credential is never stored.
-- Runtime services resolve this row at invocation time rather than treating
-- EMBEDDING_* process environment variables as authoritative configuration.

CREATE TYPE "commerce"."CommerceEmbeddingPurpose" AS ENUM (
  'MERCHANT_KNOWLEDGE',
  'REFERENCE_TAXONOMY'
);

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_EMBEDDING_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REPLACE_EMBEDDING_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REMOVE_EMBEDDING_CONFIGURATION';

CREATE TABLE "commerce"."CommerceEmbeddingConfiguration" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "purpose" "commerce"."CommerceEmbeddingPurpose" NOT NULL,
  "embeddingProvider" VARCHAR(64) NOT NULL,
  "embeddingModel" VARCHAR(255) NOT NULL,
  "embeddingDimensions" INTEGER NOT NULL,
  "embeddingIndexVersion" VARCHAR(64) NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyId" VARCHAR(64) NOT NULL,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceEmbeddingConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceEmbeddingConfiguration_provider_check"
    CHECK (btrim("embeddingProvider") <> ''),
  CONSTRAINT "CommerceEmbeddingConfiguration_model_check"
    CHECK (btrim("embeddingModel") <> ''),
  CONSTRAINT "CommerceEmbeddingConfiguration_dimensions_check"
    CHECK ("embeddingDimensions" > 0),
  CONSTRAINT "CommerceEmbeddingConfiguration_index_version_check"
    CHECK (btrim("embeddingIndexVersion") <> ''),
  CONSTRAINT "CommerceEmbeddingConfiguration_ciphertext_length_check"
    CHECK (octet_length("ciphertext") BETWEEN 1 AND 8192),
  CONSTRAINT "CommerceEmbeddingConfiguration_nonce_length_check"
    CHECK (octet_length("nonce") = 12),
  CONSTRAINT "CommerceEmbeddingConfiguration_auth_tag_length_check"
    CHECK (octet_length("authTag") = 16),
  CONSTRAINT "CommerceEmbeddingConfiguration_key_id_check"
    CHECK (btrim("keyId") <> ''),
  CONSTRAINT "CommerceEmbeddingConfiguration_edit_version_check"
    CHECK ("editVersion" > 0)
);

CREATE UNIQUE INDEX "CommerceEmbeddingConfiguration_environment_purpose_key"
  ON "commerce"."CommerceEmbeddingConfiguration"("environment", "purpose");

CREATE INDEX "CommerceEmbeddingConfiguration_purpose_environment_idx"
  ON "commerce"."CommerceEmbeddingConfiguration"("purpose", "environment");

ALTER TABLE "commerce"."CommerceEmbeddingConfiguration"
  ADD CONSTRAINT "CommerceEmbeddingConfiguration_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve the existing Commerce audit target contract while admitting the
-- environment-scoped embedding configuration actions. Purpose is recorded in
-- audit metadata because REMOVE deletes the configuration row.
ALTER TABLE "commerce"."CommerceAuditEvent"
  DROP CONSTRAINT "arch020_audit_targets";

ALTER TABLE "commerce"."CommerceAuditEvent"
  ADD CONSTRAINT "arch020_audit_targets" CHECK (CASE
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
    WHEN "action"::text IN ('SET_OPENROUTER_CREDENTIAL','REPLACE_OPENROUTER_CREDENTIAL','REMOVE_OPENROUTER_CREDENTIAL','SET_EMBEDDING_CONFIGURATION','REPLACE_EMBEDDING_CONFIGURATION','REMOVE_EMBEDDING_CONFIGURATION') THEN "environment" IS NOT NULL
    ELSE false
  END);
