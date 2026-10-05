-- ARCH-029 DATABASE-002: database-backed translation model configuration and
-- durable Store Category translation work.
--
-- Existing support.MerchantMessageTranslation / MerchantTranslationBatch tables
-- are deliberately untouched. Background integration will reuse the proven
-- translation algorithms through software adapters backed by these new commerce
-- tables.

CREATE TYPE "commerce"."CommerceStoreCategoryTranslationRunStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY_TO_PUBLISH',
  'SUCCEEDED',
  'FAILED',
  'STALE'
);

CREATE TYPE "commerce"."CommerceStoreCategoryTranslationEntityKind" AS ENUM (
  'CATEGORY',
  'MAPPING'
);

CREATE TYPE "commerce"."CommerceStoreCategoryTranslationField" AS ENUM (
  'DISPLAY_NAME',
  'DESCRIPTION'
);

CREATE TYPE "commerce"."CommerceStoreCategoryTranslationItemStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'FAILED'
);

CREATE TYPE "commerce"."CommerceStoreCategoryTranslationBatchStatus" AS ENUM (
  'READY',
  'SUBMITTING',
  'SUBMISSION_UNKNOWN',
  'SUBMITTED',
  'PROVIDER_COMPLETED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED'
);

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_TRANSLATION_PROVIDER_CREDENTIAL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REPLACE_TRANSLATION_PROVIDER_CREDENTIAL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REMOVE_TRANSLATION_PROVIDER_CREDENTIAL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_TRANSLATION_MODEL_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_TRANSLATION_MODEL_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ENABLE_TRANSLATION_MODEL_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_TRANSLATION_MODEL_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'REQUEST_PROMPT_TEMPLATE_CATEGORY_TRANSLATION';

CREATE TABLE "commerce"."CommerceTranslationProviderCredential" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyId" VARCHAR(64) NOT NULL,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceTranslationProviderCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceTranslationProviderCredential_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "CommerceTranslationProviderCredential_ciphertext_length_check"
    CHECK (octet_length("ciphertext") BETWEEN 1 AND 8192),
  CONSTRAINT "CommerceTranslationProviderCredential_nonce_length_check"
    CHECK (octet_length("nonce") = 12),
  CONSTRAINT "CommerceTranslationProviderCredential_auth_tag_length_check"
    CHECK (octet_length("authTag") = 16),
  CONSTRAINT "CommerceTranslationProviderCredential_key_id_check"
    CHECK (btrim("keyId") <> ''),
  CONSTRAINT "CommerceTranslationProviderCredential_edit_version_check"
    CHECK ("editVersion" > 0)
);

CREATE UNIQUE INDEX "CommerceTranslationProviderCredential_environment_provider_key"
  ON "commerce"."CommerceTranslationProviderCredential"("environment", "provider");

CREATE INDEX "CommerceTranslationProviderCredential_provider_environment_idx"
  ON "commerce"."CommerceTranslationProviderCredential"("provider", "environment");

ALTER TABLE "commerce"."CommerceTranslationProviderCredential"
  ADD CONSTRAINT "CommerceTranslationProviderCredential_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceTranslationModelConfiguration" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "providerModelId" VARCHAR(255) NOT NULL,
  "displayName" VARCHAR(255) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByAdminId" TEXT NOT NULL,
  "updatedByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceTranslationModelConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceTranslationModelConfiguration_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "CommerceTranslationModelConfiguration_model_check"
    CHECK (btrim("providerModelId") <> ''),
  CONSTRAINT "CommerceTranslationModelConfiguration_display_name_check"
    CHECK (btrim("displayName") <> ''),
  CONSTRAINT "CommerceTranslationModelConfiguration_edit_version_check"
    CHECK ("editVersion" > 0)
);

CREATE UNIQUE INDEX "CommerceTranslationModelConfiguration_environment_provider_model_key"
  ON "commerce"."CommerceTranslationModelConfiguration"("environment", "provider", "providerModelId");

CREATE UNIQUE INDEX "CommerceTranslationModelConfiguration_environment_displayName_key"
  ON "commerce"."CommerceTranslationModelConfiguration"("environment", "displayName");

CREATE INDEX "CommerceTranslationModelConfiguration_environment_enabled_displayName_id_idx"
  ON "commerce"."CommerceTranslationModelConfiguration"("environment", "enabled", "displayName", "id");

ALTER TABLE "commerce"."CommerceTranslationModelConfiguration"
  ADD CONSTRAINT "CommerceTranslationModelConfiguration_credential_fkey"
  FOREIGN KEY ("environment", "provider")
  REFERENCES "commerce"."CommerceTranslationProviderCredential"("environment", "provider")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceTranslationModelConfiguration_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceTranslationModelConfiguration_updatedByAdminId_fkey"
  FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTranslationRun" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "translationModelConfigurationId" TEXT NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "providerModelId" VARCHAR(255) NOT NULL,
  "modelConfigurationVersion" INTEGER NOT NULL,
  "sourceSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceHash" VARCHAR(64) NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "status" "commerce"."CommerceStoreCategoryTranslationRunStatus" NOT NULL DEFAULT 'PENDING',
  "requestedByAdminId" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "readyToPublishAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceStoreCategoryTranslationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStoreCategoryTranslationRun_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationRun_model_check"
    CHECK (btrim("providerModelId") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationRun_model_version_check"
    CHECK ("modelConfigurationVersion" > 0),
  CONSTRAINT "CommerceStoreCategoryTranslationRun_source_schema_version_check"
    CHECK ("sourceSchemaVersion" > 0),
  CONSTRAINT "CommerceStoreCategoryTranslationRun_source_hash_check"
    CHECK ("sourceHash" ~ '^[0-9a-f]{64}$')
);

-- Browser double-click protection is not the correctness boundary. PostgreSQL
-- admits only one active translation/enablement run per Store Category.
CREATE UNIQUE INDEX "CommerceStoreCategoryTranslationRun_one_active_per_category"
  ON "commerce"."CommerceStoreCategoryTranslationRun"("categoryId")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'READY_TO_PUBLISH');

CREATE INDEX "CommerceStoreCategoryTranslationRun_categoryId_status_requestedAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationRun"("categoryId", "status", "requestedAt");

CREATE INDEX "CommerceStoreCategoryTranslationRun_status_requestedAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationRun"("status", "requestedAt");

CREATE INDEX "CommerceStoreCategoryTranslationRun_model_requestedAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationRun"("translationModelConfigurationId", "requestedAt");

ALTER TABLE "commerce"."CommerceStoreCategoryTranslationRun"
  ADD CONSTRAINT "CommerceStoreCategoryTranslationRun_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceStoreCategoryTranslationRun_model_fkey"
  FOREIGN KEY ("translationModelConfigurationId") REFERENCES "commerce"."CommerceTranslationModelConfiguration"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceStoreCategoryTranslationRun_requestedByAdminId_fkey"
  FOREIGN KEY ("requestedByAdminId") REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTranslationBatch" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "model" VARCHAR(255) NOT NULL,
  "status" "commerce"."CommerceStoreCategoryTranslationBatchStatus" NOT NULL DEFAULT 'READY',
  "providerBatchId" TEXT,
  "inputFileId" TEXT,
  "outputFileId" TEXT,
  "errorFileId" TEXT,
  "submissionStartedAt" TIMESTAMPTZ(3),
  "lastSubmitAttemptAt" TIMESTAMPTZ(3),
  "submitAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextSubmitAt" TIMESTAMPTZ(3),
  "submittedAt" TIMESTAMPTZ(3),
  "lastPolledAt" TIMESTAMPTZ(3),
  "nextPollAt" TIMESTAMPTZ(3),
  "pollSequence" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceStoreCategoryTranslationBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStoreCategoryTranslationBatch_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationBatch_model_check"
    CHECK (btrim("model") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationBatch_submit_attempt_check"
    CHECK ("submitAttemptCount" >= 0),
  CONSTRAINT "CommerceStoreCategoryTranslationBatch_poll_sequence_check"
    CHECK ("pollSequence" >= 0)
);

CREATE UNIQUE INDEX "CommerceStoreCategoryTranslationBatch_provider_providerBatchId_key"
  ON "commerce"."CommerceStoreCategoryTranslationBatch"("provider", "providerBatchId");

CREATE INDEX "CommerceStoreCategoryTranslationBatch_runId_status_createdAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationBatch"("runId", "status", "createdAt");

CREATE INDEX "CommerceStoreCategoryTranslationBatch_status_nextSubmitAt_createdAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationBatch"("status", "nextSubmitAt", "createdAt");

CREATE INDEX "CommerceStoreCategoryTranslationBatch_status_nextPollAt_createdAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationBatch"("status", "nextPollAt", "createdAt");

ALTER TABLE "commerce"."CommerceStoreCategoryTranslationBatch"
  ADD CONSTRAINT "CommerceStoreCategoryTranslationBatch_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "commerce"."CommerceStoreCategoryTranslationRun"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTranslationItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceEntityKind" "commerce"."CommerceStoreCategoryTranslationEntityKind" NOT NULL,
  "sourceEntityId" TEXT NOT NULL,
  "sourceField" "commerce"."CommerceStoreCategoryTranslationField" NOT NULL,
  "sourceLanguageTag" VARCHAR(16) NOT NULL,
  "targetLanguageTag" VARCHAR(16) NOT NULL,
  "sourceText" TEXT NOT NULL,
  "translatedText" TEXT,
  "status" "commerce"."CommerceStoreCategoryTranslationItemStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode" VARCHAR(128),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "currentBatchId" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceStoreCategoryTranslationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStoreCategoryTranslationItem_source_language_check"
    CHECK (btrim("sourceLanguageTag") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationItem_target_language_check"
    CHECK (btrim("targetLanguageTag") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationItem_source_text_check"
    CHECK (btrim("sourceText") <> ''),
  CONSTRAINT "CommerceStoreCategoryTranslationItem_retry_count_check"
    CHECK ("retryCount" >= 0),
  CONSTRAINT "CommerceStoreCategoryTranslationItem_entity_field_check"
    CHECK (
      ("sourceEntityKind" = 'CATEGORY' AND "sourceField" IN ('DISPLAY_NAME', 'DESCRIPTION'))
      OR
      ("sourceEntityKind" = 'MAPPING' AND "sourceField" = 'DISPLAY_NAME')
    )
);

CREATE UNIQUE INDEX "CommerceStoreCategoryTranslationItem_run_entity_field_locale_key"
  ON "commerce"."CommerceStoreCategoryTranslationItem"(
    "runId",
    "sourceEntityKind",
    "sourceEntityId",
    "sourceField",
    "targetLanguageTag"
  );

CREATE INDEX "CommerceStoreCategoryTranslationItem_status_batch_retry_createdAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationItem"("status", "currentBatchId", "nextAttemptAt", "createdAt");

CREATE INDEX "CommerceStoreCategoryTranslationItem_runId_targetLanguageTag_idx"
  ON "commerce"."CommerceStoreCategoryTranslationItem"("runId", "targetLanguageTag");

ALTER TABLE "commerce"."CommerceStoreCategoryTranslationItem"
  ADD CONSTRAINT "CommerceStoreCategoryTranslationItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "commerce"."CommerceStoreCategoryTranslationRun"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceStoreCategoryTranslationItem_currentBatchId_fkey"
  FOREIGN KEY ("currentBatchId") REFERENCES "commerce"."CommerceStoreCategoryTranslationBatch"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTranslationBatchItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "translationItemId" TEXT NOT NULL,
  "providerCustomId" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceStoreCategoryTranslationBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceStoreCategoryTranslationBatchItem_providerCustomId_key"
  ON "commerce"."CommerceStoreCategoryTranslationBatchItem"("providerCustomId");

CREATE UNIQUE INDEX "CommerceStoreCategoryTranslationBatchItem_batchId_translationItemId_key"
  ON "commerce"."CommerceStoreCategoryTranslationBatchItem"("batchId", "translationItemId");

CREATE INDEX "CommerceStoreCategoryTranslationBatchItem_translationItemId_createdAt_idx"
  ON "commerce"."CommerceStoreCategoryTranslationBatchItem"("translationItemId", "createdAt");

ALTER TABLE "commerce"."CommerceStoreCategoryTranslationBatchItem"
  ADD CONSTRAINT "CommerceStoreCategoryTranslationBatchItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "commerce"."CommerceStoreCategoryTranslationBatch"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceStoreCategoryTranslationBatchItem_translationItemId_fkey"
  FOREIGN KEY ("translationItemId") REFERENCES "commerce"."CommerceStoreCategoryTranslationItem"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "commerce"."CommerceAuditEvent"
  ADD COLUMN "translationModelConfigurationId" TEXT;

CREATE INDEX "CommerceAuditEvent_translationModelConfigurationId_createdAt_id_idx"
  ON "commerce"."CommerceAuditEvent"("translationModelConfigurationId", "createdAt", "id");

ALTER TABLE "commerce"."CommerceAuditEvent"
  ADD CONSTRAINT "CommerceAuditEvent_translationModelConfigurationId_fkey"
  FOREIGN KEY ("translationModelConfigurationId")
  REFERENCES "commerce"."CommerceTranslationModelConfiguration"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Preserve the Commerce audit target contract while adding translation credential,
-- model-profile and Store Category translation-request targets.
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
    WHEN "action"::text IN ('SET_OPENROUTER_CREDENTIAL','REPLACE_OPENROUTER_CREDENTIAL','REMOVE_OPENROUTER_CREDENTIAL','SET_EMBEDDING_CONFIGURATION','REPLACE_EMBEDDING_CONFIGURATION','REMOVE_EMBEDDING_CONFIGURATION','SET_TRANSLATION_PROVIDER_CREDENTIAL','REPLACE_TRANSLATION_PROVIDER_CREDENTIAL','REMOVE_TRANSLATION_PROVIDER_CREDENTIAL') THEN "environment" IS NOT NULL
    WHEN "action"::text IN ('CREATE_TRANSLATION_MODEL_CONFIGURATION','UPDATE_TRANSLATION_MODEL_CONFIGURATION','ENABLE_TRANSLATION_MODEL_CONFIGURATION','DISABLE_TRANSLATION_MODEL_CONFIGURATION') THEN "translationModelConfigurationId" IS NOT NULL AND "environment" IS NOT NULL
    WHEN "action"::text = 'REQUEST_PROMPT_TEMPLATE_CATEGORY_TRANSLATION' THEN "promptTemplateCategoryId" IS NOT NULL AND "translationModelConfigurationId" IS NOT NULL AND "environment" IS NOT NULL
    ELSE false
  END);
