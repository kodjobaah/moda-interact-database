-- ARCH-047-DATABASE-001: additive technical persistence for Moda-authored WhatsApp templates.
-- Authorisation, immutable-content policy, language completeness, Meta approval,
-- sender/WABA matching and publication decisions are application-owned, not SQL gates.
-- Apply after 20261023173000_arch047_whatsapp_template_audit_actions.
-- PostgreSQL enum values cannot be removed in an ordinary down migration; rollback
-- therefore means reverting consumers, not dropping durable provider/audit history.
BEGIN;

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'CREATE_WHATSAPP_TEMPLATE_DEFINITION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'CLONE_WHATSAPP_TEMPLATE_DEFINITION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'REQUEST_WHATSAPP_TEMPLATE_TRANSLATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'REVIEW_WHATSAPP_TEMPLATE_LOCALE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'REQUEST_WHATSAPP_TEMPLATE_META_SUBMISSION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'PUBLISH_WHATSAPP_TEMPLATE_DEFINITION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'ASSIGN_WHATSAPP_TEMPLATE_DEFINITION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'RETIRE_WHATSAPP_TEMPLATE_DEFINITION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'ACTIVATE_WHATSAPP_CONVERSATION_WRAPPER';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE IF NOT EXISTS 'DEACTIVATE_WHATSAPP_CONVERSATION_WRAPPER';

CREATE TABLE "whatsapp"."WhatsAppTemplateDefinition" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateDefinition_pkey" PRIMARY KEY ("id"),
    "kind" VARCHAR(40) NOT NULL,
    "purpose" VARCHAR(96),
    "offerType" VARCHAR(32),
    "audience" VARCHAR(24),
    "providerTemplateName" VARCHAR(255),
    "category" VARCHAR(32),
    "sourceLanguageTag" VARCHAR(16) NOT NULL,
    "astSchemaVersion" INTEGER NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "retiredAt" TIMESTAMPTZ(3),
    "createdByAdminId" TEXT NOT NULL,
    "clonedFromDefinitionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateLocale" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateLocale_pkey" PRIMARY KEY ("id"),
    "definitionId" TEXT NOT NULL,
    "languageTag" VARCHAR(16) NOT NULL,
    "providerLanguageCode" VARCHAR(16),
    "localeAst" JSONB,
    "contentHash" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateTranslationRun" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateTranslationRun_pkey" PRIMARY KEY ("id"),
    "definitionId" TEXT NOT NULL,
    "translationModelConfigurationId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerModelId" VARCHAR(255) NOT NULL,
    "modelConfigurationVersion" INTEGER NOT NULL,
    "sourceSchemaVersion" INTEGER NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "requestedByAdminId" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateTranslationItem" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateTranslationItem_pkey" PRIMARY KEY ("id"),
    "runId" TEXT NOT NULL,
    "targetLanguageTag" VARCHAR(16) NOT NULL,
    "translatedAst" JSONB,
    "outputContentHash" VARCHAR(64),
    "resultLocaleId" TEXT,
    "status" VARCHAR(32) NOT NULL,
    "failureCode" VARCHAR(128),
    "retryCount" INTEGER DEFAULT 0 NOT NULL,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "currentBatchId" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateTranslationBatch" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateTranslationBatch_pkey" PRIMARY KEY ("id"),
    "runId" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "providerBatchId" TEXT,
    "inputFileId" TEXT,
    "outputFileId" TEXT,
    "errorFileId" TEXT,
    "submissionStartedAt" TIMESTAMPTZ(3),
    "lastSubmitAttemptAt" TIMESTAMPTZ(3),
    "submitAttemptCount" INTEGER DEFAULT 0 NOT NULL,
    "nextSubmitAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "lastPolledAt" TIMESTAMPTZ(3),
    "nextPollAt" TIMESTAMPTZ(3),
    "pollSequence" INTEGER DEFAULT 0 NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateTranslationBatchItem" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateTranslationBatchItem_pkey" PRIMARY KEY ("id"),
    "batchId" TEXT NOT NULL,
    "translationItemId" TEXT NOT NULL,
    "providerCustomId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateMetaRegistration" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateMetaRegistration_pkey" PRIMARY KEY ("id"),
    "localeId" TEXT NOT NULL,
    "wabaId" VARCHAR(191) NOT NULL,
    "providerTemplateName" VARCHAR(255) NOT NULL,
    "providerLanguageCode" VARCHAR(16) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "componentsSnapshot" JSONB NOT NULL,
    "parameterBindingsSnapshot" JSONB NOT NULL,
    "submittedContentHash" VARCHAR(64) NOT NULL,
    "providerTemplateId" VARCHAR(191),
    "submissionState" VARCHAR(32) NOT NULL,
    "providerStatus" VARCHAR(32),
    "failureCode" VARCHAR(128),
    "lastSubmittedAt" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "lastReconciledAt" TIMESTAMPTZ(3),
    "lastObservedContentHash" VARCHAR(64),
    "lastObservedCategory" VARCHAR(32),
    "driftDetectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplateMetaEvent" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplateMetaEvent_pkey" PRIMARY KEY ("id"),
    "eventIdentity" VARCHAR(191) NOT NULL,
    "registrationId" TEXT,
    "source" VARCHAR(32) NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32),
    "attemptNumber" INTEGER,
    "wabaId" VARCHAR(191) NOT NULL,
    "providerTemplateId" VARCHAR(191),
    "providerTemplateName" VARCHAR(255),
    "providerLanguageCode" VARCHAR(16),
    "requestDigest" VARCHAR(64),
    "providerRequestId" VARCHAR(191),
    "httpStatus" INTEGER,
    "providerStatus" VARCHAR(32),
    "failureCode" VARCHAR(128),
    "reasonCode" VARCHAR(128),
    "evidence" JSONB,
    "receivedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "processedAt" TIMESTAMPTZ(3)
);

CREATE TABLE "whatsapp"."WhatsAppTemplatePublicationOperation" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplatePublicationOperation_pkey" PRIMARY KEY ("id"),
    "definitionId" TEXT NOT NULL,
    "requestedByAdminId" TEXT NOT NULL,
    "operationKey" VARCHAR(128) NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "totalTargets" INTEGER,
    "succeededTargets" INTEGER DEFAULT 0 NOT NULL,
    "failedTargets" INTEGER DEFAULT 0 NOT NULL,
    "nextPageCursor" TEXT,
    "failureCode" VARCHAR(128),
    "requestedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" (
    "id" TEXT NOT NULL,
    CONSTRAINT "WhatsAppTemplatePublicationTarget_pkey" PRIMARY KEY ("id"),
    "operationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "languageTag" VARCHAR(16) NOT NULL,
    "metaRegistrationId" TEXT NOT NULL,
    "previousVariantId" TEXT,
    "newVariantId" TEXT,
    "status" VARCHAR(32) NOT NULL,
    "failureCode" VARCHAR(128),
    "retryCount" INTEGER DEFAULT 0 NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "whatsapp"."WhatsAppConversationWrapperActiveSlot" (
    "audience" VARCHAR(24) NOT NULL,
    CONSTRAINT "WhatsAppConversationWrapperActiveSlot_pkey" PRIMARY KEY ("audience"),
    "definitionId" TEXT NOT NULL,
    "editVersion" INTEGER DEFAULT 0 NOT NULL,
    "updatedByAdminId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE "whatsapp"."WhatsAppTemplateVariant" ADD COLUMN "metaRegistrationId" TEXT;

ALTER TABLE "whatsapp"."WhatsAppTemplateDefinition" ADD CONSTRAINT "WhatsAppTemplateDefinition_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateDefinition" ADD CONSTRAINT "WhatsAppTemplateDefinition_clonedFromDefinitionId_fkey" FOREIGN KEY ("clonedFromDefinitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateLocale" ADD CONSTRAINT "WhatsAppTemplateLocale_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateLocale" ADD CONSTRAINT "WhatsAppTemplateLocale_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationRun" ADD CONSTRAINT "WhatsAppTemplateTranslationRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationRun" ADD CONSTRAINT "WhatsAppTemplateTranslationRun_translationModelConfigurati_fkey" FOREIGN KEY ("translationModelConfigurationId") REFERENCES "commerce"."CommerceTranslationModelConfiguration"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationRun" ADD CONSTRAINT "WhatsAppTemplateTranslationRun_requestedByAdminId_fkey" FOREIGN KEY ("requestedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationItem" ADD CONSTRAINT "WhatsAppTemplateTranslationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "whatsapp"."WhatsAppTemplateTranslationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationItem" ADD CONSTRAINT "WhatsAppTemplateTranslationItem_resultLocaleId_fkey" FOREIGN KEY ("resultLocaleId") REFERENCES "whatsapp"."WhatsAppTemplateLocale"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationItem" ADD CONSTRAINT "WhatsAppTemplateTranslationItem_currentBatchId_fkey" FOREIGN KEY ("currentBatchId") REFERENCES "whatsapp"."WhatsAppTemplateTranslationBatch"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationBatch" ADD CONSTRAINT "WhatsAppTemplateTranslationBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "whatsapp"."WhatsAppTemplateTranslationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationBatchItem" ADD CONSTRAINT "WhatsAppTemplateTranslationBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "whatsapp"."WhatsAppTemplateTranslationBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateTranslationBatchItem" ADD CONSTRAINT "WhatsAppTemplateTranslationBatchItem_translationItemId_fkey" FOREIGN KEY ("translationItemId") REFERENCES "whatsapp"."WhatsAppTemplateTranslationItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateMetaRegistration" ADD CONSTRAINT "WhatsAppTemplateMetaRegistration_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "whatsapp"."WhatsAppTemplateLocale"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateMetaEvent" ADD CONSTRAINT "WhatsAppTemplateMetaEvent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "whatsapp"."WhatsAppTemplateMetaRegistration"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationOperation" ADD CONSTRAINT "WhatsAppTemplatePublicationOperation_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationOperation" ADD CONSTRAINT "WhatsAppTemplatePublicationOperation_requestedByAdminId_fkey" FOREIGN KEY ("requestedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" ADD CONSTRAINT "WhatsAppTemplatePublicationTarget_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "whatsapp"."WhatsAppTemplatePublicationOperation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" ADD CONSTRAINT "WhatsAppTemplatePublicationTarget_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" ADD CONSTRAINT "WhatsAppTemplatePublicationTarget_metaRegistrationId_fkey" FOREIGN KEY ("metaRegistrationId") REFERENCES "whatsapp"."WhatsAppTemplateMetaRegistration"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" ADD CONSTRAINT "WhatsAppTemplatePublicationTarget_previousVariantId_fkey" FOREIGN KEY ("previousVariantId") REFERENCES "whatsapp"."WhatsAppTemplateVariant"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplatePublicationTarget" ADD CONSTRAINT "WhatsAppTemplatePublicationTarget_newVariantId_fkey" FOREIGN KEY ("newVariantId") REFERENCES "whatsapp"."WhatsAppTemplateVariant"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppConversationWrapperActiveSlot" ADD CONSTRAINT "WhatsAppConversationWrapperActiveSlot_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppConversationWrapperActiveSlot" ADD CONSTRAINT "WhatsAppConversationWrapperActiveSlot_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppTemplateVariant" ADD CONSTRAINT "WhatsAppTemplateVariant_metaRegistrationId_fkey" FOREIGN KEY ("metaRegistrationId") REFERENCES "whatsapp"."WhatsAppTemplateMetaRegistration"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "WhatsAppTemplateDefinition_kind_purpose_createdAt_idx" ON "whatsapp"."WhatsAppTemplateDefinition"("kind", "purpose", "createdAt");
CREATE INDEX "WhatsAppTemplateDefinition_status_publishedAt_idx" ON "whatsapp"."WhatsAppTemplateDefinition"("status", "publishedAt");
CREATE INDEX "WhatsAppTemplateDefinition_createdByAdminId_createdAt_idx" ON "whatsapp"."WhatsAppTemplateDefinition"("createdByAdminId", "createdAt");
CREATE INDEX "WhatsAppTemplateDefinition_clonedFromDefinitionId_idx" ON "whatsapp"."WhatsAppTemplateDefinition"("clonedFromDefinitionId");
CREATE UNIQUE INDEX "WhatsAppTemplateLocale_definitionId_languageTag_key" ON "whatsapp"."WhatsAppTemplateLocale"("definitionId", "languageTag");
CREATE INDEX "WhatsAppTemplateLocale_status_updatedAt_idx" ON "whatsapp"."WhatsAppTemplateLocale"("status", "updatedAt");
CREATE INDEX "WhatsAppTemplateLocale_reviewedByAdminId_reviewedAt_idx" ON "whatsapp"."WhatsAppTemplateLocale"("reviewedByAdminId", "reviewedAt");
CREATE INDEX "WhatsAppTemplateTranslationRun_definitionId_status_requeste_idx" ON "whatsapp"."WhatsAppTemplateTranslationRun"("definitionId", "status", "requestedAt");
CREATE INDEX "WhatsAppTemplateTranslationRun_status_requestedAt_idx" ON "whatsapp"."WhatsAppTemplateTranslationRun"("status", "requestedAt");
CREATE INDEX "WhatsAppTemplateTranslationRun_translationModelConfiguratio_idx" ON "whatsapp"."WhatsAppTemplateTranslationRun"("translationModelConfigurationId", "requestedAt");
CREATE UNIQUE INDEX "WhatsAppTemplateTranslationItem_runId_targetLanguageTag_key" ON "whatsapp"."WhatsAppTemplateTranslationItem"("runId", "targetLanguageTag");
CREATE INDEX "WhatsAppTemplateTranslationItem_status_currentBatchId_nextA_idx" ON "whatsapp"."WhatsAppTemplateTranslationItem"("status", "currentBatchId", "nextAttemptAt", "createdAt");
CREATE INDEX "WhatsAppTemplateTranslationItem_resultLocaleId_idx" ON "whatsapp"."WhatsAppTemplateTranslationItem"("resultLocaleId");
CREATE UNIQUE INDEX "WhatsAppTemplateTranslationBatch_provider_providerBatchId_key" ON "whatsapp"."WhatsAppTemplateTranslationBatch"("provider", "providerBatchId");
CREATE INDEX "WhatsAppTemplateTranslationBatch_runId_status_createdAt_idx" ON "whatsapp"."WhatsAppTemplateTranslationBatch"("runId", "status", "createdAt");
CREATE INDEX "WhatsAppTemplateTranslationBatch_status_nextSubmitAt_create_idx" ON "whatsapp"."WhatsAppTemplateTranslationBatch"("status", "nextSubmitAt", "createdAt");
CREATE INDEX "WhatsAppTemplateTranslationBatch_status_nextPollAt_createdA_idx" ON "whatsapp"."WhatsAppTemplateTranslationBatch"("status", "nextPollAt", "createdAt");
CREATE UNIQUE INDEX "WhatsAppTemplateTranslationBatchItem_providerCustomId_key" ON "whatsapp"."WhatsAppTemplateTranslationBatchItem"("providerCustomId");
CREATE UNIQUE INDEX "WhatsAppTemplateTranslationBatchItem_batchId_translationIte_key" ON "whatsapp"."WhatsAppTemplateTranslationBatchItem"("batchId", "translationItemId");
CREATE INDEX "WhatsAppTemplateTranslationBatchItem_translationItemId_crea_idx" ON "whatsapp"."WhatsAppTemplateTranslationBatchItem"("translationItemId", "createdAt");
CREATE UNIQUE INDEX "WhatsAppTemplateMetaRegistration_wabaId_providerTemplateNam_key" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("wabaId", "providerTemplateName", "providerLanguageCode");
CREATE UNIQUE INDEX "WhatsAppTemplateMetaRegistration_wabaId_providerTemplateId_key" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("wabaId", "providerTemplateId");
CREATE INDEX "WhatsAppTemplateMetaRegistration_localeId_createdAt_idx" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("localeId", "createdAt");
CREATE INDEX "WhatsAppTemplateMetaRegistration_submissionState_nextRetryA_idx" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("submissionState", "nextRetryAt", "createdAt");
CREATE INDEX "WhatsAppTemplateMetaRegistration_providerStatus_updatedAt_idx" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("providerStatus", "updatedAt");
CREATE INDEX "WhatsAppTemplateMetaRegistration_driftDetectedAt_idx" ON "whatsapp"."WhatsAppTemplateMetaRegistration"("driftDetectedAt");
CREATE UNIQUE INDEX "WhatsAppTemplateMetaEvent_eventIdentity_key" ON "whatsapp"."WhatsAppTemplateMetaEvent"("eventIdentity");
CREATE INDEX "WhatsAppTemplateMetaEvent_registrationId_receivedAt_idx" ON "whatsapp"."WhatsAppTemplateMetaEvent"("registrationId", "receivedAt");
CREATE INDEX "WhatsAppTemplateMetaEvent_wabaId_providerTemplateName_provi_idx" ON "whatsapp"."WhatsAppTemplateMetaEvent"("wabaId", "providerTemplateName", "providerLanguageCode", "receivedAt");
CREATE INDEX "WhatsAppTemplateMetaEvent_processedAt_receivedAt_idx" ON "whatsapp"."WhatsAppTemplateMetaEvent"("processedAt", "receivedAt");
CREATE UNIQUE INDEX "WhatsAppTemplatePublicationOperation_operationKey_key" ON "whatsapp"."WhatsAppTemplatePublicationOperation"("operationKey");
CREATE INDEX "WhatsAppTemplatePublicationOperation_definitionId_status_cr_idx" ON "whatsapp"."WhatsAppTemplatePublicationOperation"("definitionId", "status", "createdAt");
CREATE INDEX "WhatsAppTemplatePublicationOperation_status_updatedAt_idx" ON "whatsapp"."WhatsAppTemplatePublicationOperation"("status", "updatedAt");
CREATE UNIQUE INDEX "WhatsAppTemplatePublicationTarget_operationId_shopId_langua_key" ON "whatsapp"."WhatsAppTemplatePublicationTarget"("operationId", "shopId", "languageTag");
CREATE INDEX "WhatsAppTemplatePublicationTarget_metaRegistrationId_idx" ON "whatsapp"."WhatsAppTemplatePublicationTarget"("metaRegistrationId");
CREATE INDEX "WhatsAppTemplatePublicationTarget_shopId_status_createdAt_idx" ON "whatsapp"."WhatsAppTemplatePublicationTarget"("shopId", "status", "createdAt");
CREATE INDEX "WhatsAppTemplatePublicationTarget_status_updatedAt_idx" ON "whatsapp"."WhatsAppTemplatePublicationTarget"("status", "updatedAt");
CREATE INDEX "WhatsAppConversationWrapperActiveSlot_definitionId_idx" ON "whatsapp"."WhatsAppConversationWrapperActiveSlot"("definitionId");
CREATE INDEX "WhatsAppTemplateVariant_metaRegistrationId_idx" ON "whatsapp"."WhatsAppTemplateVariant"("metaRegistrationId");

-- Extend only the existing exhaustive audit target allowlist for new labels;
-- do not alter the six variant-action requirements or any historical CASE branch.
ALTER TABLE "commerce"."CommerceAuditEvent" DROP CONSTRAINT "arch020_audit_targets";
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
    WHEN "action"::text IN ('SET_LIVE_PLATFORM_BUDGET','SET_LIVE_PLAN_BUDGET_OVERRIDE','SET_LIVE_SHOP_BUDGET_OVERRIDE','SET_PREVIEW_PLATFORM_BUDGET','SET_PREVIEW_SHOP_BUDGET_OVERRIDE')
      THEN "modelPolicyId" IS NOT NULL AND "environment" IS NOT NULL
        AND "actorType"::text = 'PLATFORM_ADMIN' AND "actorAdminId" IS NOT NULL
        AND "metadata" ? 'previousBudget' AND "metadata" ? 'nextBudget'
        AND "metadata" ? 'previousEditVersion' AND "metadata" ? 'nextEditVersion'
        AND "metadata" ? 'context' AND "metadata" ? 'scope'
    WHEN "action"::text IN ('CREATE_WHATSAPP_TEMPLATE_VARIANT','UPDATE_WHATSAPP_TEMPLATE_VARIANT',
      'ENABLE_WHATSAPP_TEMPLATE_VARIANT','DISABLE_WHATSAPP_TEMPLATE_VARIANT',
      'BULK_ASSIGN_WHATSAPP_TEMPLATE_VARIANT','BULK_UPDATE_WHATSAPP_TEMPLATE_VARIANT')
      THEN "shopId" IS NOT NULL AND "actorType"::text = 'PLATFORM_ADMIN'
        AND "actorAdminId" IS NOT NULL AND "operationId" IS NOT NULL
        AND btrim("operationId") <> ''
    WHEN "action"::text IN ('CREATE_WHATSAPP_TEMPLATE_DEFINITION','CLONE_WHATSAPP_TEMPLATE_DEFINITION',
      'REQUEST_WHATSAPP_TEMPLATE_TRANSLATION','REVIEW_WHATSAPP_TEMPLATE_LOCALE',
      'REQUEST_WHATSAPP_TEMPLATE_META_SUBMISSION','PUBLISH_WHATSAPP_TEMPLATE_DEFINITION',
      'ASSIGN_WHATSAPP_TEMPLATE_DEFINITION','RETIRE_WHATSAPP_TEMPLATE_DEFINITION',
      'ACTIVATE_WHATSAPP_CONVERSATION_WRAPPER','DEACTIVATE_WHATSAPP_CONVERSATION_WRAPPER')
      THEN true
    ELSE false
  END);

COMMIT;
