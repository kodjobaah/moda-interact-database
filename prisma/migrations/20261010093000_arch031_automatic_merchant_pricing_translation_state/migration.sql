-- ARCH-031 DATABASE-001: durable automatic Merchant Pricing translation state.
--
-- Merchant Pricing translations are staged separately from final pricing-plan
-- rows so the existing ARCH-014 exact-20-locale constraints remain the
-- publication boundary. The configured automatic translation model is also
-- persisted here rather than hard-coded in Admin/Background runtime code.

ALTER TABLE "commerce"."CommerceTranslationModelConfiguration"
  ADD COLUMN "automaticDefault" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "commerce"."CommerceTranslationModelConfiguration"
  ADD CONSTRAINT "TranslationModel_auto_default_enabled_check"
  CHECK (NOT "automaticDefault" OR "enabled");

CREATE UNIQUE INDEX "CommerceTranslationModelConfiguration_one_automatic_default"
  ON "commerce"."CommerceTranslationModelConfiguration"("environment", "provider")
  WHERE "automaticDefault" = true;

CREATE TYPE "billing"."MerchantPricingTranslationRunStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY_TO_APPLY',
  'APPLIED',
  'FAILED',
  'STALE'
);

CREATE TYPE "billing"."MerchantPricingTranslationEntityKind" AS ENUM (
  'PLAN',
  'HIGHLIGHT'
);

CREATE TYPE "billing"."MerchantPricingTranslationField" AS ENUM (
  'TITLE',
  'DESCRIPTION'
);

CREATE TYPE "billing"."MerchantPricingTranslationItemStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'FAILED'
);

CREATE TYPE "billing"."MerchantPricingTranslationBatchStatus" AS ENUM (
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

CREATE TABLE "billing"."MerchantPricingTranslationRun" (
  "id" TEXT NOT NULL,
  "shopifyPlanHandle" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "translationModelConfigurationId" TEXT NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "providerModelId" VARCHAR(255) NOT NULL,
  "modelConfigurationVersion" INTEGER NOT NULL,
  "sourceSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceHash" VARCHAR(64) NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "status" "billing"."MerchantPricingTranslationRunStatus" NOT NULL DEFAULT 'PENDING',
  "requestedByAdminId" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "readyToApplyAt" TIMESTAMPTZ(3),
  "appliedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "appliedMerchantPricingPlanId" TEXT,
  "failureCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MerchantPricingTranslationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantPricingTranslationRun_handle_check"
    CHECK (btrim("shopifyPlanHandle") <> ''),
  CONSTRAINT "MerchantPricingTranslationRun_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "MerchantPricingTranslationRun_model_check"
    CHECK (btrim("providerModelId") <> ''),
  CONSTRAINT "MerchantPricingTranslationRun_model_version_check"
    CHECK ("modelConfigurationVersion" > 0),
  CONSTRAINT "MerchantPricingTranslationRun_source_schema_check"
    CHECK ("sourceSchemaVersion" > 0),
  CONSTRAINT "MerchantPricingTranslationRun_source_hash_check"
    CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MerchantPricingTranslationRun_source_snapshot_check"
    CHECK (jsonb_typeof("sourceSnapshot") = 'object'),
  CONSTRAINT "MerchantPricingTranslationRun_applied_plan_check"
    CHECK ("appliedMerchantPricingPlanId" IS NULL OR btrim("appliedMerchantPricingPlanId") <> '')
);

-- Reopening a completed/failed/stale source is allowed, but browser double-clicks
-- and concurrent Admin requests must converge on one active run for the exact
-- handle + canonical source snapshot.
CREATE UNIQUE INDEX "MerchantPricingTranslationRun_active_handle_source_key"
  ON "billing"."MerchantPricingTranslationRun"("shopifyPlanHandle", "sourceHash")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'READY_TO_APPLY');

CREATE INDEX "MerchantPricingTranslationRun_handle_status_requested_idx"
  ON "billing"."MerchantPricingTranslationRun"("shopifyPlanHandle", "status", "requestedAt");

CREATE INDEX "MerchantPricingTranslationRun_status_requested_idx"
  ON "billing"."MerchantPricingTranslationRun"("status", "requestedAt");

CREATE INDEX "MerchantPricingTranslationRun_model_requested_idx"
  ON "billing"."MerchantPricingTranslationRun"("translationModelConfigurationId", "requestedAt");

ALTER TABLE "billing"."MerchantPricingTranslationRun"
  ADD CONSTRAINT "MerchantPricingTranslationRun_model_fkey"
  FOREIGN KEY ("translationModelConfigurationId")
  REFERENCES "commerce"."CommerceTranslationModelConfiguration"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "MerchantPricingTranslationRun_requester_fkey"
  FOREIGN KEY ("requestedByAdminId")
  REFERENCES "public"."PlatformAdmin"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "billing"."MerchantPricingTranslationBatch" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "model" VARCHAR(255) NOT NULL,
  "status" "billing"."MerchantPricingTranslationBatchStatus" NOT NULL DEFAULT 'READY',
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

  CONSTRAINT "MerchantPricingTranslationBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantPricingTranslationBatch_provider_check"
    CHECK (btrim("provider") <> ''),
  CONSTRAINT "MerchantPricingTranslationBatch_model_check"
    CHECK (btrim("model") <> ''),
  CONSTRAINT "MerchantPricingTranslationBatch_submit_count_check"
    CHECK ("submitAttemptCount" >= 0),
  CONSTRAINT "MerchantPricingTranslationBatch_poll_sequence_check"
    CHECK ("pollSequence" >= 0)
);

CREATE UNIQUE INDEX "MerchantPricingTranslationBatch_provider_batch_key"
  ON "billing"."MerchantPricingTranslationBatch"("provider", "providerBatchId");

CREATE INDEX "MerchantPricingTranslationBatch_run_status_created_idx"
  ON "billing"."MerchantPricingTranslationBatch"("runId", "status", "createdAt");

CREATE INDEX "MerchantPricingTranslationBatch_submit_due_idx"
  ON "billing"."MerchantPricingTranslationBatch"("status", "nextSubmitAt", "createdAt");

CREATE INDEX "MerchantPricingTranslationBatch_poll_due_idx"
  ON "billing"."MerchantPricingTranslationBatch"("status", "nextPollAt", "createdAt");

ALTER TABLE "billing"."MerchantPricingTranslationBatch"
  ADD CONSTRAINT "MerchantPricingTranslationBatch_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "billing"."MerchantPricingTranslationRun"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE TABLE "billing"."MerchantPricingTranslationItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceEntityKind" "billing"."MerchantPricingTranslationEntityKind" NOT NULL,
  "sourceContentKey" UUID,
  "sourceField" "billing"."MerchantPricingTranslationField" NOT NULL,
  "sourceLanguageTag" VARCHAR(16) NOT NULL,
  "targetLanguageTag" VARCHAR(16) NOT NULL,
  "sourceText" TEXT NOT NULL,
  "translatedText" TEXT,
  "status" "billing"."MerchantPricingTranslationItemStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode" VARCHAR(128),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "currentBatchId" TEXT,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MerchantPricingTranslationItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantPricingTranslationItem_source_language_check"
    CHECK (btrim("sourceLanguageTag") <> ''),
  CONSTRAINT "MerchantPricingTranslationItem_target_language_check"
    CHECK (btrim("targetLanguageTag") <> ''),
  CONSTRAINT "MerchantPricingTranslationItem_source_text_check"
    CHECK (btrim("sourceText") <> ''),
  CONSTRAINT "MerchantPricingTranslationItem_retry_count_check"
    CHECK ("retryCount" >= 0),
  CONSTRAINT "MerchantPricingTranslationItem_entity_field_check"
    CHECK (
      ("sourceEntityKind" = 'PLAN' AND "sourceContentKey" IS NULL AND "sourceField" = 'DESCRIPTION')
      OR
      ("sourceEntityKind" = 'HIGHLIGHT' AND "sourceContentKey" IS NOT NULL AND "sourceField" IN ('TITLE', 'DESCRIPTION'))
    ),
  CONSTRAINT "MerchantPricingTranslationItem_available_text_check"
    CHECK ("status" <> 'AVAILABLE' OR ("translatedText" IS NOT NULL AND btrim("translatedText") <> ''))
);

-- NULL sourceContentKey is intentional for the single plan-level description,
-- so PLAN and HIGHLIGHT identities use separate partial uniqueness constraints.
CREATE UNIQUE INDEX "MerchantPricingTranslationItem_plan_field_locale_key"
  ON "billing"."MerchantPricingTranslationItem"("runId", "sourceField", "targetLanguageTag")
  WHERE "sourceEntityKind" = 'PLAN';

CREATE UNIQUE INDEX "MerchantPricingTranslationItem_highlight_field_locale_key"
  ON "billing"."MerchantPricingTranslationItem"("runId", "sourceContentKey", "sourceField", "targetLanguageTag")
  WHERE "sourceEntityKind" = 'HIGHLIGHT';

CREATE INDEX "MerchantPricingTranslationItem_status_batch_retry_idx"
  ON "billing"."MerchantPricingTranslationItem"("status", "currentBatchId", "nextAttemptAt", "createdAt");

CREATE INDEX "MerchantPricingTranslationItem_run_locale_idx"
  ON "billing"."MerchantPricingTranslationItem"("runId", "targetLanguageTag");

ALTER TABLE "billing"."MerchantPricingTranslationItem"
  ADD CONSTRAINT "MerchantPricingTranslationItem_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "billing"."MerchantPricingTranslationRun"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "MerchantPricingTranslationItem_current_batch_fkey"
  FOREIGN KEY ("currentBatchId") REFERENCES "billing"."MerchantPricingTranslationBatch"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;

CREATE TABLE "billing"."MerchantPricingTranslationBatchItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "translationItemId" TEXT NOT NULL,
  "providerCustomId" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MerchantPricingTranslationBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantPricingTranslationBatchItem_custom_id_key"
  ON "billing"."MerchantPricingTranslationBatchItem"("providerCustomId");

CREATE UNIQUE INDEX "MerchantPricingTranslationBatchItem_batch_item_key"
  ON "billing"."MerchantPricingTranslationBatchItem"("batchId", "translationItemId");

CREATE INDEX "MerchantPricingTranslationBatchItem_item_created_idx"
  ON "billing"."MerchantPricingTranslationBatchItem"("translationItemId", "createdAt");

ALTER TABLE "billing"."MerchantPricingTranslationBatchItem"
  ADD CONSTRAINT "MerchantPricingTranslationBatchItem_batch_fkey"
  FOREIGN KEY ("batchId") REFERENCES "billing"."MerchantPricingTranslationBatch"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "MerchantPricingTranslationBatchItem_item_fkey"
  FOREIGN KEY ("translationItemId") REFERENCES "billing"."MerchantPricingTranslationItem"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
