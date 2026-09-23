-- ARCH-021 CommerceAgent configuration schema. Additive DDL only.
CREATE TYPE "commerce"."CommerceModelProvider" AS ENUM ('OPENAI', 'GROQ');
CREATE TYPE "commerce"."CommerceAgentPromptScope" AS ENUM ('PLATFORM', 'SHOP');
CREATE TYPE "commerce"."CommercePromptRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_MODEL_CATALOGUE_ENTRY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_MODEL_CATALOGUE_ENTRY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ENABLE_MODEL_CATALOGUE_ENTRY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_MODEL_CATALOGUE_ENTRY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_PLATFORM_MODEL_SELECTION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_SHOP_MODEL_SELECTION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CLEAR_SHOP_MODEL_SELECTION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_PROMPT_TEMPLATE_CATEGORY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_PROMPT_TEMPLATE_CATEGORY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ENABLE_PROMPT_TEMPLATE_CATEGORY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_PROMPT_TEMPLATE_CATEGORY';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_PROMPT_TEMPLATE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_PROMPT_TEMPLATE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'ENABLE_PROMPT_TEMPLATE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'DISABLE_PROMPT_TEMPLATE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_PROMPT_TEMPLATE_DRAFT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_PROMPT_TEMPLATE_DRAFT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'PUBLISH_PROMPT_TEMPLATE_REVISION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_AGENT_PROMPT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_AGENT_PROMPT_DRAFT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'UPDATE_AGENT_PROMPT_DRAFT';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'PUBLISH_AGENT_PROMPT_REVISION';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_PLATFORM_PROMPT_POINTER';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_SHOP_PROMPT_POINTER';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'CLEAR_SHOP_PROMPT_POINTER';

CREATE TABLE "commerce"."CommerceModelCatalogueEntry" (
 "id" TEXT NOT NULL, "provider" "commerce"."CommerceModelProvider" NOT NULL,
 "providerModelId" VARCHAR(255) NOT NULL, "displayName" VARCHAR(255) NOT NULL,
 "description" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT true,
 "editVersion" INTEGER NOT NULL DEFAULT 1, "createdByAdminId" TEXT NOT NULL,
 "updatedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceModelCatalogueEntry_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CommerceModelCatalogueEntry_provider_model_id_check" CHECK (length(btrim("providerModelId")) > 0),
 CONSTRAINT "CommerceModelCatalogueEntry_display_name_check" CHECK (length(btrim("displayName")) > 0),
 CONSTRAINT "CommerceModelCatalogueEntry_description_length_check" CHECK (length("description") <= 4096),
 CONSTRAINT "CommerceModelCatalogueEntry_edit_version_check" CHECK ("editVersion" > 0),
 CONSTRAINT "CommerceModelCatalogueEntry_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "CommerceModelCatalogueEntry_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceModelCatalogueEntry_provider_providerModelId_key" ON "commerce"."CommerceModelCatalogueEntry"("provider","providerModelId");
CREATE INDEX "CommerceModelCatalogueEntry_enabled_provider_displayName_id_idx" ON "commerce"."CommerceModelCatalogueEntry"("enabled","provider","displayName","id");

CREATE TABLE "commerce"."CommercePlatformModelSelection" (
 "environment" "commerce"."CommerceEnvironment" NOT NULL, "modelId" TEXT NOT NULL,
 "editVersion" INTEGER NOT NULL DEFAULT 1, "updatedByAdminId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommercePlatformModelSelection_pkey" PRIMARY KEY ("environment"), CONSTRAINT "CommercePlatformModelSelection_edit_version_check" CHECK ("editVersion" > 0),
 CONSTRAINT "CommercePlatformModelSelection_model_fkey" FOREIGN KEY ("modelId") REFERENCES "commerce"."CommerceModelCatalogueEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "CommercePlatformModelSelection_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommercePlatformModelSelection_modelId_idx" ON "commerce"."CommercePlatformModelSelection"("modelId");

CREATE TABLE "commerce"."CommerceShopModelSelection" (
 "environment" "commerce"."CommerceEnvironment" NOT NULL, "shopId" TEXT NOT NULL, "modelId" TEXT NOT NULL,
 "generationId" TEXT NOT NULL, "editVersion" INTEGER NOT NULL DEFAULT 1, "updatedByAdminId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceShopModelSelection_pkey" PRIMARY KEY ("environment","shopId"), CONSTRAINT "CommerceShopModelSelection_edit_version_check" CHECK ("editVersion" > 0),
 CONSTRAINT "CommerceShopModelSelection_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "CommerceShopModelSelection_model_fkey" FOREIGN KEY ("modelId") REFERENCES "commerce"."CommerceModelCatalogueEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "CommerceShopModelSelection_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommerceShopModelSelection_modelId_idx" ON "commerce"."CommerceShopModelSelection"("modelId");
CREATE INDEX "CommerceShopModelSelection_shopId_idx" ON "commerce"."CommerceShopModelSelection"("shopId");

CREATE TABLE "commerce"."CommercePromptTemplateCategory" (
 "id" TEXT NOT NULL, "slug" VARCHAR(128) NOT NULL, "displayName" VARCHAR(255) NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "enabled" BOOLEAN NOT NULL DEFAULT true, "displayOrder" INTEGER NOT NULL DEFAULT 0, "editVersion" INTEGER NOT NULL DEFAULT 1,
 "createdByAdminId" TEXT NOT NULL, "updatedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommercePromptTemplateCategory_pkey" PRIMARY KEY ("id"), CONSTRAINT "CommercePromptTemplateCategory_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9_-]{0,127}$'), CONSTRAINT "CommercePromptTemplateCategory_display_name_check" CHECK (length(btrim("displayName")) > 0), CONSTRAINT "CommercePromptTemplateCategory_description_length_check" CHECK (length("description") <= 4096), CONSTRAINT "CommercePromptTemplateCategory_display_order_check" CHECK ("displayOrder" >= 0), CONSTRAINT "CommercePromptTemplateCategory_edit_version_check" CHECK ("editVersion" > 0),
 CONSTRAINT "CommercePromptTemplateCategory_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePromptTemplateCategory_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommercePromptTemplateCategory_slug_key" ON "commerce"."CommercePromptTemplateCategory"("slug");
CREATE INDEX "CommercePromptTemplateCategory_enabled_displayOrder_displayName_id_idx" ON "commerce"."CommercePromptTemplateCategory"("enabled","displayOrder","displayName","id");

CREATE TABLE "commerce"."CommercePromptTemplate" (
 "id" TEXT NOT NULL, "key" VARCHAR(128) NOT NULL, "categoryId" TEXT NOT NULL, "displayName" VARCHAR(255) NOT NULL, "description" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT true, "editVersion" INTEGER NOT NULL DEFAULT 1, "createdByAdminId" TEXT NOT NULL, "updatedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommercePromptTemplate_pkey" PRIMARY KEY ("id"), CONSTRAINT "CommercePromptTemplate_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,127}$'), CONSTRAINT "CommercePromptTemplate_display_name_check" CHECK (length(btrim("displayName")) > 0), CONSTRAINT "CommercePromptTemplate_description_length_check" CHECK (length("description") <= 4096), CONSTRAINT "CommercePromptTemplate_edit_version_check" CHECK ("editVersion" > 0),
 CONSTRAINT "CommercePromptTemplate_category_fkey" FOREIGN KEY ("categoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePromptTemplate_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePromptTemplate_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommercePromptTemplate_key_key" ON "commerce"."CommercePromptTemplate"("key");
CREATE INDEX "CommercePromptTemplate_categoryId_enabled_displayName_id_idx" ON "commerce"."CommercePromptTemplate"("categoryId","enabled","displayName","id");
CREATE INDEX "CommercePromptTemplate_enabled_displayName_id_idx" ON "commerce"."CommercePromptTemplate"("enabled","displayName","id");

CREATE TABLE "commerce"."CommercePromptTemplateRevision" (
 "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "revisionNumber" INTEGER NOT NULL, "status" "commerce"."CommercePromptRevisionStatus" NOT NULL DEFAULT 'DRAFT', "editVersion" INTEGER NOT NULL DEFAULT 1, "promptText" TEXT NOT NULL, "contentHash" VARCHAR(64), "createdByAdminId" TEXT NOT NULL, "publishedByAdminId" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMPTZ(3),
 CONSTRAINT "CommercePromptTemplateRevision_pkey" PRIMARY KEY ("id"), CONSTRAINT "CommercePromptTemplateRevision_revision_check" CHECK ("revisionNumber" > 0), CONSTRAINT "CommercePromptTemplateRevision_edit_version_check" CHECK ("editVersion" > 0), CONSTRAINT "CommercePromptTemplateRevision_prompt_text_check" CHECK (length("promptText") <= 32000), CONSTRAINT "CommercePromptTemplateRevision_hash_check" CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[0-9a-f]{64}$'), CONSTRAINT "CommercePromptTemplateRevision_publication_shape_check" CHECK (("status"='DRAFT' AND "contentHash" IS NULL AND "publishedByAdminId" IS NULL AND "publishedAt" IS NULL) OR ("status"='PUBLISHED' AND length(btrim("promptText")) > 0 AND "contentHash" IS NOT NULL AND "publishedByAdminId" IS NOT NULL AND "publishedAt" IS NOT NULL)),
 CONSTRAINT "CommercePromptTemplateRevision_template_fkey" FOREIGN KEY ("templateId") REFERENCES "commerce"."CommercePromptTemplate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePromptTemplateRevision_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePromptTemplateRevision_publisher_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommercePromptTemplateRevision_templateId_revisionNumber_key" ON "commerce"."CommercePromptTemplateRevision"("templateId","revisionNumber");
CREATE UNIQUE INDEX "CommercePromptTemplateRevision_id_templateId_key" ON "commerce"."CommercePromptTemplateRevision"("id","templateId");
CREATE INDEX "CommercePromptTemplateRevision_templateId_status_revisionNumber_idx" ON "commerce"."CommercePromptTemplateRevision"("templateId","status","revisionNumber");

CREATE TABLE "commerce"."CommerceAgentPrompt" (
 "id" TEXT NOT NULL, "scope" "commerce"."CommerceAgentPromptScope" NOT NULL, "shopId" TEXT, "createdByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceAgentPrompt_pkey" PRIMARY KEY ("id"), CONSTRAINT "CommerceAgentPrompt_scope_check" CHECK (("scope"='PLATFORM' AND "shopId" IS NULL) OR ("scope"='SHOP' AND "shopId" IS NOT NULL)), CONSTRAINT "CommerceAgentPrompt_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceAgentPrompt_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommerceAgentPrompt_scope_shopId_idx" ON "commerce"."CommerceAgentPrompt"("scope","shopId");
CREATE UNIQUE INDEX "CommerceAgentPrompt_one_platform_idx" ON "commerce"."CommerceAgentPrompt"((1)) WHERE "scope"='PLATFORM';
CREATE UNIQUE INDEX "CommerceAgentPrompt_one_shop_idx" ON "commerce"."CommerceAgentPrompt"("shopId") WHERE "scope"='SHOP';

CREATE TABLE "commerce"."CommerceAgentPromptRevision" (
 "id" TEXT NOT NULL, "promptId" TEXT NOT NULL, "revisionNumber" INTEGER NOT NULL, "status" "commerce"."CommercePromptRevisionStatus" NOT NULL DEFAULT 'DRAFT', "editVersion" INTEGER NOT NULL DEFAULT 1, "promptText" TEXT NOT NULL, "contentHash" VARCHAR(64), "sourceTemplateRevisionId" TEXT, "createdByAdminId" TEXT NOT NULL, "publishedByAdminId" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMPTZ(3),
 CONSTRAINT "CommerceAgentPromptRevision_pkey" PRIMARY KEY ("id"), CONSTRAINT "CommerceAgentPromptRevision_revision_check" CHECK ("revisionNumber" > 0), CONSTRAINT "CommerceAgentPromptRevision_edit_version_check" CHECK ("editVersion" > 0), CONSTRAINT "CommerceAgentPromptRevision_prompt_text_check" CHECK (length("promptText") <= 32000), CONSTRAINT "CommerceAgentPromptRevision_hash_check" CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[0-9a-f]{64}$'), CONSTRAINT "CommerceAgentPromptRevision_publication_shape_check" CHECK (("status"='DRAFT' AND "contentHash" IS NULL AND "publishedByAdminId" IS NULL AND "publishedAt" IS NULL) OR ("status"='PUBLISHED' AND length(btrim("promptText")) > 0 AND "contentHash" IS NOT NULL AND "publishedByAdminId" IS NOT NULL AND "publishedAt" IS NOT NULL)),
 CONSTRAINT "CommerceAgentPromptRevision_prompt_fkey" FOREIGN KEY ("promptId") REFERENCES "commerce"."CommerceAgentPrompt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceAgentPromptRevision_source_fkey" FOREIGN KEY ("sourceTemplateRevisionId") REFERENCES "commerce"."CommercePromptTemplateRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceAgentPromptRevision_creator_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceAgentPromptRevision_publisher_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceAgentPromptRevision_promptId_revisionNumber_key" ON "commerce"."CommerceAgentPromptRevision"("promptId","revisionNumber");
CREATE UNIQUE INDEX "CommerceAgentPromptRevision_id_promptId_key" ON "commerce"."CommerceAgentPromptRevision"("id","promptId");
CREATE INDEX "CommerceAgentPromptRevision_promptId_status_revisionNumber_idx" ON "commerce"."CommerceAgentPromptRevision"("promptId","status","revisionNumber");
CREATE INDEX "CommerceAgentPromptRevision_sourceTemplateRevisionId_idx" ON "commerce"."CommerceAgentPromptRevision"("sourceTemplateRevisionId");

CREATE TABLE "commerce"."CommercePlatformPromptPointer" (
 "environment" "commerce"."CommerceEnvironment" NOT NULL, "promptId" TEXT NOT NULL, "promptRevisionId" TEXT NOT NULL, "editVersion" INTEGER NOT NULL DEFAULT 1, "updatedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommercePlatformPromptPointer_pkey" PRIMARY KEY ("environment"), CONSTRAINT "CommercePlatformPromptPointer_edit_version_check" CHECK ("editVersion" > 0), CONSTRAINT "CommercePlatformPromptPointer_revision_fkey" FOREIGN KEY ("promptRevisionId","promptId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id","promptId") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommercePlatformPromptPointer_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommercePlatformPromptPointer_promptRevisionId_promptId_idx" ON "commerce"."CommercePlatformPromptPointer"("promptRevisionId","promptId");

CREATE TABLE "commerce"."CommerceShopPromptPointer" (
 "environment" "commerce"."CommerceEnvironment" NOT NULL, "shopId" TEXT NOT NULL, "promptId" TEXT NOT NULL, "promptRevisionId" TEXT NOT NULL, "generationId" TEXT NOT NULL, "editVersion" INTEGER NOT NULL DEFAULT 1, "updatedByAdminId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CommerceShopPromptPointer_pkey" PRIMARY KEY ("environment","shopId"), CONSTRAINT "CommerceShopPromptPointer_edit_version_check" CHECK ("editVersion" > 0), CONSTRAINT "CommerceShopPromptPointer_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceShopPromptPointer_revision_fkey" FOREIGN KEY ("promptRevisionId","promptId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id","promptId") ON DELETE RESTRICT ON UPDATE RESTRICT, CONSTRAINT "CommerceShopPromptPointer_updater_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "CommerceShopPromptPointer_promptRevisionId_promptId_idx" ON "commerce"."CommerceShopPromptPointer"("promptRevisionId","promptId");
CREATE INDEX "CommerceShopPromptPointer_shopId_idx" ON "commerce"."CommerceShopPromptPointer"("shopId");

ALTER TABLE "commerce"."CommerceAuditEvent" ADD COLUMN "shopId" TEXT, ADD COLUMN "modelCatalogueEntryId" TEXT, ADD COLUMN "promptTemplateCategoryId" TEXT, ADD COLUMN "promptTemplateId" TEXT, ADD COLUMN "promptTemplateRevisionId" TEXT, ADD COLUMN "agentPromptId" TEXT, ADD COLUMN "agentPromptRevisionId" TEXT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_shop_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_model_fkey" FOREIGN KEY ("modelCatalogueEntryId") REFERENCES "commerce"."CommerceModelCatalogueEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_category_fkey" FOREIGN KEY ("promptTemplateCategoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_template_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "commerce"."CommercePromptTemplate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_template_revision_fkey" FOREIGN KEY ("promptTemplateRevisionId") REFERENCES "commerce"."CommercePromptTemplateRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_agent_prompt_fkey" FOREIGN KEY ("agentPromptId") REFERENCES "commerce"."CommerceAgentPrompt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_agent_prompt_revision_fkey" FOREIGN KEY ("agentPromptRevisionId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CommerceAuditEvent_shopId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("shopId","createdAt","id");
CREATE INDEX "CommerceAuditEvent_modelCatalogueEntryId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("modelCatalogueEntryId","createdAt","id");
CREATE INDEX "CommerceAuditEvent_promptTemplateCategoryId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("promptTemplateCategoryId","createdAt","id");
CREATE INDEX "CommerceAuditEvent_promptTemplateId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("promptTemplateId","createdAt","id");
CREATE INDEX "CommerceAuditEvent_agentPromptId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("agentPromptId","createdAt","id");

ALTER TABLE commerce."CommerceAuditEvent"
DROP CONSTRAINT arch020_audit_targets;
ALTER TABLE commerce."CommerceAuditEvent"
	    ADD CONSTRAINT arch020_audit_targets CHECK (CASE
		    WHEN "action"::text IN ('CREATE_CAPABILITY','UPDATE_CAPABILITY','ENABLE_CAPABILITY','DISABLE_CAPABILITY') THEN "capabilityId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_DRAFT','UPDATE_DRAFT','PUBLISH_REVISION') THEN "capabilityId" IS NOT NULL AND "revisionId" IS NOT NULL
		    WHEN "action"::text='CREATE_RELEASE' THEN "releaseId" IS NOT NULL
		    WHEN "action"::text IN ('ACTIVATE_RELEASE','ROLLBACK_RELEASE') THEN "releaseId" IS NOT NULL AND "environment" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_TOOL','UPDATE_TOOL','ENABLE_TOOL','DISABLE_TOOL') THEN "toolId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_TOOL_DRAFT','UPDATE_TOOL_DRAFT','PUBLISH_TOOL_REVISION') THEN "toolId" IS NOT NULL AND "toolRevisionId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_MODEL_CATALOGUE_ENTRY','UPDATE_MODEL_CATALOGUE_ENTRY','ENABLE_MODEL_CATALOGUE_ENTRY','DISABLE_MODEL_CATALOGUE_ENTRY') THEN "modelCatalogueEntryId" IS NOT NULL
		    WHEN "action"::text IN ('SET_PLATFORM_MODEL_SELECTION') THEN "modelCatalogueEntryId" IS NOT NULL AND "environment" IS NOT NULL
		    WHEN "action"::text IN ('SET_SHOP_MODEL_SELECTION','CLEAR_SHOP_MODEL_SELECTION') THEN "shopId" IS NOT NULL AND "modelCatalogueEntryId" IS NOT NULL AND "environment" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE_CATEGORY','UPDATE_PROMPT_TEMPLATE_CATEGORY','ENABLE_PROMPT_TEMPLATE_CATEGORY','DISABLE_PROMPT_TEMPLATE_CATEGORY') THEN "promptTemplateCategoryId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE','UPDATE_PROMPT_TEMPLATE','ENABLE_PROMPT_TEMPLATE','DISABLE_PROMPT_TEMPLATE') THEN "promptTemplateId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_PROMPT_TEMPLATE_DRAFT','UPDATE_PROMPT_TEMPLATE_DRAFT','PUBLISH_PROMPT_TEMPLATE_REVISION') THEN "promptTemplateId" IS NOT NULL AND "promptTemplateRevisionId" IS NOT NULL
		    WHEN "action"::text IN ('CREATE_AGENT_PROMPT','CREATE_AGENT_PROMPT_DRAFT','CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE','UPDATE_AGENT_PROMPT_DRAFT') THEN "agentPromptId" IS NOT NULL
		    WHEN "action"::text IN ('PUBLISH_AGENT_PROMPT_REVISION') THEN "agentPromptId" IS NOT NULL AND "agentPromptRevisionId" IS NOT NULL
		    WHEN "action"::text IN ('SET_PLATFORM_PROMPT_POINTER') THEN "agentPromptId" IS NOT NULL AND "agentPromptRevisionId" IS NOT NULL AND "environment" IS NOT NULL
		    WHEN "action"::text IN ('SET_SHOP_PROMPT_POINTER','CLEAR_SHOP_PROMPT_POINTER') THEN "shopId" IS NOT NULL AND "agentPromptId" IS NOT NULL AND "agentPromptRevisionId" IS NOT NULL AND "environment" IS NOT NULL
		ELSE false END);

CREATE OR REPLACE FUNCTION commerce.arch021_model_catalogue_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 model catalogue entries cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW."providerModelId" IS DISTINCT FROM OLD."providerModelId") THEN RAISE EXCEPTION 'ARCH021 model catalogue identity immutable'; END IF;
 RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER arch021_model_catalogue_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommerceModelCatalogueEntry" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_model_catalogue_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_shop_model_selection_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW."generationId" IS DISTINCT FROM OLD."generationId" THEN RAISE EXCEPTION 'ARCH021 shop model generation immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER arch021_shop_model_selection_guard BEFORE UPDATE ON commerce."CommerceShopModelSelection" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_shop_model_selection_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_prompt_template_category_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 prompt template categories cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug) THEN RAISE EXCEPTION 'ARCH021 category identity immutable'; END IF;
 RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER arch021_prompt_template_category_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommercePromptTemplateCategory" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_prompt_template_category_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_prompt_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 prompt templates cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.key IS DISTINCT FROM OLD.key) THEN RAISE EXCEPTION 'ARCH021 template identity immutable'; END IF;
 RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER arch021_prompt_template_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommercePromptTemplate" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_prompt_template_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_prompt_template_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 template revisions cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."templateId" IS DISTINCT FROM OLD."templateId" OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber") THEN RAISE EXCEPTION 'ARCH021 template revision identity immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'ARCH021 published template revisions immutable'; END IF;
 RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER arch021_prompt_template_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommercePromptTemplateRevision" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_prompt_template_revision_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_agent_prompt_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 agent prompt lineages immutable'; END IF;
 IF (NEW.scope='PLATFORM' AND NEW."shopId" IS NOT NULL) OR (NEW.scope='SHOP' AND NEW."shopId" IS NULL) THEN RAISE EXCEPTION 'ARCH021 agent prompt scope mismatch'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER arch021_agent_prompt_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommerceAgentPrompt" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_agent_prompt_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_agent_prompt_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE lineage commerce."CommerceAgentPrompt"; source_status commerce."CommercePromptRevisionStatus"; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ARCH021 agent prompt revisions cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW."promptId" IS DISTINCT FROM OLD."promptId" OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber") THEN RAISE EXCEPTION 'ARCH021 agent revision identity immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'ARCH021 published agent revisions immutable'; END IF;
 SELECT * INTO lineage FROM commerce."CommerceAgentPrompt" WHERE id=NEW."promptId";
 IF NEW."sourceTemplateRevisionId" IS NOT NULL THEN SELECT status INTO source_status FROM commerce."CommercePromptTemplateRevision" WHERE id=NEW."sourceTemplateRevisionId"; IF source_status IS DISTINCT FROM 'PUBLISHED'::commerce."CommercePromptRevisionStatus" THEN RAISE EXCEPTION 'ARCH021 source template must be published'; END IF; END IF;
 RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER arch021_agent_prompt_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommerceAgentPromptRevision" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_agent_prompt_revision_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_platform_prompt_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE revision_row record; BEGIN SELECT revision.status,prompt.scope,prompt."shopId" INTO revision_row FROM commerce."CommerceAgentPromptRevision" revision JOIN commerce."CommerceAgentPrompt" prompt ON prompt.id=revision."promptId" WHERE revision.id=NEW."promptRevisionId" AND revision."promptId"=NEW."promptId"; IF revision_row.status IS DISTINCT FROM 'PUBLISHED'::commerce."CommercePromptRevisionStatus" OR revision_row.scope IS DISTINCT FROM 'PLATFORM'::commerce."CommerceAgentPromptScope" THEN RAISE EXCEPTION 'ARCH021 platform pointer requires published platform revision'; END IF; RETURN NEW; END $$;
CREATE TRIGGER arch021_platform_prompt_pointer_guard BEFORE INSERT OR UPDATE ON commerce."CommercePlatformPromptPointer" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_platform_prompt_pointer_guard();

CREATE OR REPLACE FUNCTION commerce.arch021_shop_prompt_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE revision_row record; BEGIN IF TG_OP='UPDATE' AND NEW."generationId" IS DISTINCT FROM OLD."generationId" THEN RAISE EXCEPTION 'ARCH021 shop prompt generation immutable'; END IF; SELECT revision.status,prompt.scope,prompt."shopId" INTO revision_row FROM commerce."CommerceAgentPromptRevision" revision JOIN commerce."CommerceAgentPrompt" prompt ON prompt.id=revision."promptId" WHERE revision.id=NEW."promptRevisionId" AND revision."promptId"=NEW."promptId"; IF revision_row.status IS DISTINCT FROM 'PUBLISHED'::commerce."CommercePromptRevisionStatus" OR revision_row.scope IS DISTINCT FROM 'SHOP'::commerce."CommerceAgentPromptScope" OR revision_row."shopId" IS DISTINCT FROM NEW."shopId" THEN RAISE EXCEPTION 'ARCH021 shop pointer requires published exact-shop revision'; END IF; RETURN NEW; END $$;
CREATE TRIGGER arch021_shop_prompt_pointer_guard BEFORE INSERT OR UPDATE ON commerce."CommerceShopPromptPointer" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_shop_prompt_pointer_guard();

