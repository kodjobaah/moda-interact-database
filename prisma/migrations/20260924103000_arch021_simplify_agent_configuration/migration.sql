-- ARCH-021 collapse Phase-2 configuration persistence and add merchant Studio access.

CREATE TYPE "commerce"."CommerceStudioMerchantRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE "commerce"."CommerceAuditActorType" AS ENUM ('PLATFORM_ADMIN', 'MERCHANT_ACCESS');

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPSERT_AGENT_CONFIGURATION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_AGENT_MODEL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CLEAR_AGENT_MODEL';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_AGENT_PROMPT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CLEAR_AGENT_PROMPT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_PROMPT_TEMPLATE_CONTENT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'GRANT_MERCHANT_STUDIO_ACCESS';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_MERCHANT_STUDIO_ACCESS';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_MERCHANT_STUDIO_ACCESS';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'BIND_MERCHANT_STUDIO_IDENTITY';

CREATE TABLE "commerce"."CommerceAgentConfiguration" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "scope" "commerce"."CommerceAgentPromptScope" NOT NULL,
  "shopId" TEXT,
  "modelId" TEXT,
  "activePromptRevisionId" TEXT,
  "modelEditVersion" INTEGER NOT NULL DEFAULT 1,
  "promptEditVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceAgentConfiguration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceAgentConfiguration_scope_shop_check" CHECK (("scope" = 'PLATFORM' AND "shopId" IS NULL) OR ("scope" = 'SHOP' AND "shopId" IS NOT NULL)),
  CONSTRAINT "CommerceAgentConfiguration_model_fkey" FOREIGN KEY ("modelId") REFERENCES "commerce"."CommerceModelCatalogueEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceAgentConfiguration_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceAgentConfiguration_prompt_revision_fkey" FOREIGN KEY ("activePromptRevisionId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommerceAgentConfiguration_environment_scope_shopId_idx" ON "commerce"."CommerceAgentConfiguration"("environment", "scope", "shopId");
CREATE INDEX "CommerceAgentConfiguration_modelId_idx" ON "commerce"."CommerceAgentConfiguration"("modelId");
CREATE INDEX "CommerceAgentConfiguration_activePromptRevisionId_idx" ON "commerce"."CommerceAgentConfiguration"("activePromptRevisionId");
CREATE UNIQUE INDEX "CommerceAgentConfiguration_one_platform_per_environment"
ON commerce."CommerceAgentConfiguration" ("environment")
WHERE "scope" = 'PLATFORM' AND "shopId" IS NULL;
CREATE UNIQUE INDEX "CommerceAgentConfiguration_one_shop_per_environment"
ON commerce."CommerceAgentConfiguration" ("environment", "shopId")
WHERE "scope" = 'SHOP' AND "shopId" IS NOT NULL;

CREATE TABLE "commerce"."CommerceStudioMerchantAccess" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "provider" VARCHAR(32) NOT NULL DEFAULT 'google',
  "providerSubject" VARCHAR(255),
  "email" VARCHAR(320) NOT NULL,
  "role" "commerce"."CommerceStudioMerchantRole" NOT NULL DEFAULT 'ADMIN',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByPlatformAdminId" TEXT NOT NULL,
  "updatedByPlatformAdminId" TEXT,
  "lastLoginAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceStudioMerchantAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStudioMerchantAccess_email_normalized_check" CHECK ("email" = lower(btrim("email")) AND length(btrim("email")) > 0),
  CONSTRAINT "CommerceStudioMerchantAccess_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceStudioMerchantAccess_creator_fkey" FOREIGN KEY ("createdByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceStudioMerchantAccess_updater_fkey" FOREIGN KEY ("updatedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceStudioMerchantAccess_shopId_email_key" ON "commerce"."CommerceStudioMerchantAccess" ("shopId", "email");
CREATE UNIQUE INDEX "CommerceStudioMerchantAccess_shopId_provider_providerSubject_key" ON "commerce"."CommerceStudioMerchantAccess" ("shopId", "provider", "providerSubject");
CREATE INDEX "CommerceStudioMerchantAccess_email_active_idx" ON "commerce"."CommerceStudioMerchantAccess" ("email", "active");
CREATE INDEX "CommerceStudioMerchantAccess_provider_providerSubject_active_idx" ON "commerce"."CommerceStudioMerchantAccess" ("provider", "providerSubject", "active");
CREATE INDEX "CommerceStudioMerchantAccess_shopId_active_role_idx" ON "commerce"."CommerceStudioMerchantAccess" ("shopId", "active", "role");

ALTER TABLE "commerce"."CommercePromptTemplate" ADD COLUMN "promptText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "commerce"."CommerceAgentPromptRevision" ADD COLUMN "sourceTemplateId" TEXT;
ALTER TABLE "commerce"."CommerceAgentPromptRevision" ADD CONSTRAINT "CommerceAgentPromptRevision_source_template_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "commerce"."CommercePromptTemplate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CommerceAgentPromptRevision_sourceTemplateId_idx" ON "commerce"."CommerceAgentPromptRevision"("sourceTemplateId");

ALTER TABLE "commerce"."CommerceAuditEvent"
  ADD COLUMN "actorType" "commerce"."CommerceAuditActorType" NOT NULL DEFAULT 'PLATFORM_ADMIN',
  ADD COLUMN "actorMerchantAccessId" TEXT,
  ADD COLUMN "operationId" VARCHAR(128),
  ADD COLUMN "agentConfigurationId" TEXT,
  ADD COLUMN "merchantAccessId" TEXT;
ALTER TABLE "commerce"."CommerceAuditEvent" ALTER COLUMN "actorAdminId" DROP NOT NULL;

ALTER TABLE "commerce"."CommerceAgentPromptRevision" DISABLE TRIGGER "arch021_agent_prompt_revision_guard";
UPDATE "commerce"."CommercePromptTemplate" AS template
SET "promptText" = COALESCE((
  SELECT revision."promptText"
  FROM "commerce"."CommercePromptTemplateRevision" AS revision
  WHERE revision."templateId" = template."id" AND revision."status" = 'PUBLISHED'
  ORDER BY revision."revisionNumber" DESC
  LIMIT 1
), (
  SELECT revision."promptText"
  FROM "commerce"."CommercePromptTemplateRevision" AS revision
  WHERE revision."templateId" = template."id"
  ORDER BY revision."revisionNumber" DESC
  LIMIT 1
), '');

UPDATE "commerce"."CommerceAgentPromptRevision" AS revision
SET "sourceTemplateId" = source."templateId"
FROM "commerce"."CommercePromptTemplateRevision" AS source
WHERE revision."sourceTemplateRevisionId" = source."id";
ALTER TABLE "commerce"."CommerceAgentPromptRevision" ENABLE TRIGGER "arch021_agent_prompt_revision_guard";

INSERT INTO "commerce"."CommerceAgentConfiguration" ("id", "environment", "scope", "shopId", "modelId", "modelEditVersion", "createdAt", "updatedAt")
SELECT 'arch021-platform-' || lower(selection."environment"::text), selection."environment", 'PLATFORM', NULL,
       selection."modelId", selection."editVersion", selection."createdAt", selection."updatedAt"
FROM "commerce"."CommercePlatformModelSelection" AS selection
ON CONFLICT DO NOTHING;
INSERT INTO "commerce"."CommerceAgentConfiguration" ("id", "environment", "scope", "modelId", "promptEditVersion", "createdAt", "updatedAt")
SELECT 'arch021-platform-' || lower(pointer."environment"::text), pointer."environment", 'PLATFORM', NULL,
       pointer."editVersion", pointer."createdAt", pointer."updatedAt"
FROM "commerce"."CommercePlatformPromptPointer" AS pointer
ON CONFLICT DO NOTHING;
UPDATE "commerce"."CommerceAgentConfiguration" AS configuration
SET "activePromptRevisionId" = pointer."promptRevisionId",
    "promptEditVersion" = pointer."editVersion",
    "createdAt" = LEAST(configuration."createdAt", pointer."createdAt"),
    "updatedAt" = GREATEST(configuration."updatedAt", pointer."updatedAt")
FROM "commerce"."CommercePlatformPromptPointer" AS pointer
WHERE configuration."environment" = pointer."environment" AND configuration."scope" = 'PLATFORM';

INSERT INTO "commerce"."CommerceAgentConfiguration" ("id", "environment", "scope", "shopId", "modelId", "modelEditVersion", "promptEditVersion", "createdAt", "updatedAt")
SELECT 'arch021-shop-' || lower(COALESCE(model."environment", prompt."environment")::text) || '-' || COALESCE(model."shopId", prompt."shopId"),
       COALESCE(model."environment", prompt."environment"), 'SHOP', COALESCE(model."shopId", prompt."shopId"),
       model."modelId", COALESCE(model."editVersion", 1), COALESCE(prompt."editVersion", 1),
       LEAST(COALESCE(model."createdAt", prompt."createdAt"), COALESCE(prompt."createdAt", model."createdAt")),
       GREATEST(COALESCE(model."updatedAt", prompt."updatedAt"), COALESCE(prompt."updatedAt", model."updatedAt"))
FROM "commerce"."CommerceShopModelSelection" AS model
FULL OUTER JOIN "commerce"."CommerceShopPromptPointer" AS prompt
  ON model."environment" = prompt."environment" AND model."shopId" = prompt."shopId"
ON CONFLICT DO NOTHING;
UPDATE "commerce"."CommerceAgentConfiguration" AS configuration
SET "activePromptRevisionId" = prompt."promptRevisionId",
    "promptEditVersion" = prompt."editVersion",
    "createdAt" = LEAST(configuration."createdAt", prompt."createdAt"),
    "updatedAt" = GREATEST(configuration."updatedAt", prompt."updatedAt")
FROM "commerce"."CommerceShopPromptPointer" AS prompt
WHERE configuration."environment" = prompt."environment" AND configuration."scope" = 'SHOP' AND configuration."shopId" = prompt."shopId";

ALTER TABLE "commerce"."CommerceAuditEvent" DISABLE TRIGGER "arch020_audit_immutable";
UPDATE "commerce"."CommerceAuditEvent"
SET "actorType" = 'PLATFORM_ADMIN'
WHERE "actorType" IS NULL;
UPDATE "commerce"."CommerceAuditEvent"
SET "operationId" = "id"
WHERE "operationId" IS NULL AND "action"::text IN (
  'CREATE_MODEL_CATALOGUE_ENTRY', 'UPDATE_MODEL_CATALOGUE_ENTRY', 'ENABLE_MODEL_CATALOGUE_ENTRY', 'DISABLE_MODEL_CATALOGUE_ENTRY',
  'SET_PLATFORM_MODEL_SELECTION', 'SET_SHOP_MODEL_SELECTION', 'CLEAR_SHOP_MODEL_SELECTION',
  'CREATE_PROMPT_TEMPLATE_CATEGORY', 'UPDATE_PROMPT_TEMPLATE_CATEGORY', 'ENABLE_PROMPT_TEMPLATE_CATEGORY', 'DISABLE_PROMPT_TEMPLATE_CATEGORY',
  'CREATE_PROMPT_TEMPLATE', 'UPDATE_PROMPT_TEMPLATE', 'ENABLE_PROMPT_TEMPLATE', 'DISABLE_PROMPT_TEMPLATE',
  'CREATE_PROMPT_TEMPLATE_DRAFT', 'UPDATE_PROMPT_TEMPLATE_DRAFT', 'PUBLISH_PROMPT_TEMPLATE_REVISION',
  'CREATE_AGENT_PROMPT', 'CREATE_AGENT_PROMPT_DRAFT', 'CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE', 'UPDATE_AGENT_PROMPT_DRAFT',
  'PUBLISH_AGENT_PROMPT_REVISION', 'SET_PLATFORM_PROMPT_POINTER', 'SET_SHOP_PROMPT_POINTER', 'CLEAR_SHOP_PROMPT_POINTER'
);
ALTER TABLE "commerce"."CommerceAuditEvent" ENABLE TRIGGER "arch020_audit_immutable";

ALTER TABLE "commerce"."CommerceAuditEvent" DROP CONSTRAINT "CommerceAuditEvent_template_revision_fkey";
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_actor_merchant_fkey" FOREIGN KEY ("actorMerchantAccessId") REFERENCES "commerce"."CommerceStudioMerchantAccess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_configuration_fkey" FOREIGN KEY ("agentConfigurationId") REFERENCES "commerce"."CommerceAgentConfiguration"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_merchant_access_fkey" FOREIGN KEY ("merchantAccessId") REFERENCES "commerce"."CommerceStudioMerchantAccess"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "CommerceAuditEvent_operation_id_unique" ON commerce."CommerceAuditEvent" ("operationId") WHERE "operationId" IS NOT NULL;
CREATE INDEX "CommerceAuditEvent_actorMerchantAccessId_createdAt_id_idx" ON commerce."CommerceAuditEvent" ("actorMerchantAccessId", "createdAt", "id");
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_actor_check" CHECK (("actorType" = 'PLATFORM_ADMIN' AND "actorAdminId" IS NOT NULL AND "actorMerchantAccessId" IS NULL) OR ("actorType" = 'MERCHANT_ACCESS' AND "actorAdminId" IS NULL AND "actorMerchantAccessId" IS NOT NULL));

ALTER TABLE commerce."CommerceAuditEvent" DROP CONSTRAINT arch020_audit_targets;
ALTER TABLE commerce."CommerceAuditEvent" ADD CONSTRAINT arch020_audit_targets CHECK (CASE
  WHEN "action"::text IN ('CREATE_CAPABILITY','UPDATE_CAPABILITY','ENABLE_CAPABILITY','DISABLE_CAPABILITY') THEN "capabilityId" IS NOT NULL
  WHEN "action"::text IN ('CREATE_DRAFT','UPDATE_DRAFT','PUBLISH_REVISION') THEN "capabilityId" IS NOT NULL AND "revisionId" IS NOT NULL
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
  ELSE false END);

ALTER TABLE "commerce"."CommerceAgentPromptRevision" DROP CONSTRAINT "CommerceAgentPromptRevision_source_fkey";
ALTER TABLE "commerce"."CommerceAgentPromptRevision" DROP CONSTRAINT "CommerceAgentPromptRevision_creator_fkey";
ALTER TABLE "commerce"."CommerceAgentPromptRevision" DROP CONSTRAINT "CommerceAgentPromptRevision_publisher_fkey";
ALTER TABLE "commerce"."CommerceAgentPromptRevision" DROP COLUMN "sourceTemplateRevisionId", DROP COLUMN "createdByAdminId", DROP COLUMN "publishedByAdminId";
ALTER TABLE "commerce"."CommerceAgentPrompt" DROP CONSTRAINT "CommerceAgentPrompt_creator_fkey";
ALTER TABLE "commerce"."CommerceAgentPrompt" DROP COLUMN "createdByAdminId";
CREATE OR REPLACE FUNCTION commerce.arch021_agent_prompt_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ARCH021 agent prompt revisions cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."promptId" IS DISTINCT FROM OLD."promptId" OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber") THEN RAISE EXCEPTION 'ARCH021 agent revision identity immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'PUBLISHED' THEN RAISE EXCEPTION 'ARCH021 published agent revisions immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP INDEX IF EXISTS "CommerceAgentPromptRevision_sourceTemplateRevisionId_idx";
DROP TABLE "commerce"."CommercePlatformModelSelection";
DROP TABLE "commerce"."CommerceShopModelSelection";
DROP TABLE "commerce"."CommercePlatformPromptPointer";
DROP TABLE "commerce"."CommerceShopPromptPointer";
DROP TABLE "commerce"."CommercePromptTemplateRevision";

CREATE OR REPLACE FUNCTION commerce.arch021_agent_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_row record;
BEGIN
  IF NEW."activePromptRevisionId" IS NULL THEN RETURN NEW; END IF;
  SELECT revision."status", prompt."scope", prompt."shopId"
  INTO revision_row
  FROM commerce."CommerceAgentPromptRevision" AS revision
  JOIN commerce."CommerceAgentPrompt" AS prompt ON prompt."id" = revision."promptId"
  WHERE revision."id" = NEW."activePromptRevisionId";
  IF revision_row."status" IS DISTINCT FROM 'PUBLISHED'::commerce."CommercePromptRevisionStatus" THEN RAISE EXCEPTION 'ARCH021 configuration requires published prompt revision'; END IF;
  IF NEW."scope" = 'PLATFORM'::commerce."CommerceAgentPromptScope" AND (revision_row."scope" IS DISTINCT FROM 'PLATFORM'::commerce."CommerceAgentPromptScope" OR revision_row."shopId" IS NOT NULL) THEN RAISE EXCEPTION 'ARCH021 platform configuration requires published platform prompt'; END IF;
  IF NEW."scope" = 'SHOP'::commerce."CommerceAgentPromptScope" AND (revision_row."scope" IS DISTINCT FROM 'SHOP'::commerce."CommerceAgentPromptScope" OR revision_row."shopId" IS DISTINCT FROM NEW."shopId") THEN RAISE EXCEPTION 'ARCH021 shop configuration requires published exact-shop prompt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommerceAgentConfiguration_guard_trigger" BEFORE INSERT OR UPDATE ON commerce."CommerceAgentConfiguration" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_agent_configuration_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_merchant_access_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."providerSubject" IS NOT NULL AND length(btrim(NEW."providerSubject")) = 0 THEN RAISE EXCEPTION 'ARCH021 provider subject must be non-empty'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."providerSubject" IS NOT NULL AND (NEW."providerSubject" IS NULL OR NEW."providerSubject" IS DISTINCT FROM OLD."providerSubject") THEN RAISE EXCEPTION 'ARCH021 merchant provider subject is immutable once bound'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommerceStudioMerchantAccess_identity_guard_trigger" BEFORE INSERT OR UPDATE ON commerce."CommerceStudioMerchantAccess" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_merchant_access_identity_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_agent_prompt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ARCH021 agent prompt lineages immutable'; END IF;
  IF (NEW."scope" = 'PLATFORM' AND NEW."shopId" IS NOT NULL) OR (NEW."scope" = 'SHOP' AND NEW."shopId" IS NULL) THEN RAISE EXCEPTION 'ARCH021 agent prompt scope mismatch'; END IF;
  RETURN NEW;
END $$;

ALTER TABLE "commerce"."CommerceAgentPromptRevision" ENABLE ALWAYS TRIGGER "arch021_agent_prompt_revision_guard";
