-- ARCH-038 DATABASE-001: One environment/context/scope policy table.
-- No model catalogue or merchant-facing policy changes.
CREATE TYPE "commerce"."CommerceModelPolicyContext" AS ENUM ('LIVE', 'PREVIEW');
CREATE TYPE "commerce"."CommerceModelPolicyScope" AS ENUM ('PLATFORM', 'PRICE_PLAN', 'SHOP');

ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_LIVE_PLATFORM_BUDGET';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_LIVE_PLAN_BUDGET_OVERRIDE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_LIVE_SHOP_BUDGET_OVERRIDE';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_PREVIEW_PLATFORM_BUDGET';
ALTER TYPE "commerce"."CommerceAuditAction" ADD VALUE 'SET_PREVIEW_SHOP_BUDGET_OVERRIDE';

-- Strict v1 budget checks. JSON numeric tokens must be integral, positive, and
-- within the JavaScript safe-integer domain. No product-specific upper bounds.
-- Future versions require an explicit migration of this function and consumers.
CREATE FUNCTION "commerce".arch038_valid_model_budget(
  payload jsonb, schema_version integer, policy_scope "commerce"."CommerceModelPolicyScope"
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field record; numeric_text text; key_count integer;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR schema_version <> 1 THEN
    RETURN false;
  END IF;
  SELECT count(*) INTO key_count FROM jsonb_object_keys(payload);
  IF (policy_scope = 'PLATFORM' AND
      (NOT payload ? 'deadlineMs' OR NOT payload ? 'outputTokens' OR key_count <> 2))
     OR (policy_scope <> 'PLATFORM' AND payload = '{}'::jsonb) THEN
    RETURN false;
  END IF;
  FOR field IN SELECT key, value FROM jsonb_each(payload) LOOP
    IF field.key NOT IN ('deadlineMs', 'outputTokens') OR jsonb_typeof(field.value) <> 'number' THEN
      RETURN false;
    END IF;
    numeric_text := field.value::text;
    -- Bound the length before casting to numeric, and reject floats/exponents.
    IF length(numeric_text) > 16 OR numeric_text !~ '^[1-9][0-9]*$' THEN
      RETURN false;
    END IF;
    IF numeric_text::numeric > 9007199254740991 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE "commerce"."CommerceModelPolicy" (
  "id" TEXT NOT NULL,
  "environment" "commerce"."CommerceEnvironment" NOT NULL,
  "context" "commerce"."CommerceModelPolicyContext" NOT NULL,
  "scope" "commerce"."CommerceModelPolicyScope" NOT NULL,
  "merchantPricingPlanId" TEXT,
  "shopId" TEXT,
  "budget" JSONB NOT NULL,
  "budgetSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "editVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceModelPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceModelPolicy_owner_check" CHECK (
    ("scope" = 'PLATFORM' AND "shopId" IS NULL AND "merchantPricingPlanId" IS NULL) OR
    ("context" = 'LIVE' AND "scope" = 'PRICE_PLAN' AND "shopId" IS NULL AND "merchantPricingPlanId" IS NOT NULL) OR
    ("scope" = 'SHOP' AND "shopId" IS NOT NULL AND "merchantPricingPlanId" IS NULL)
  ),
  CONSTRAINT "CommerceModelPolicy_budget_check" CHECK (
    "commerce".arch038_valid_model_budget("budget", "budgetSchemaVersion", "scope")
  ),
  CONSTRAINT "CommerceModelPolicy_edit_version_check" CHECK ("editVersion" > 0),
  CONSTRAINT "CommerceModelPolicy_merchantPricingPlanId_fkey" FOREIGN KEY ("merchantPricingPlanId")
    REFERENCES "billing"."MerchantPricingPlan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceModelPolicy_shopId_fkey" FOREIGN KEY ("shopId")
    REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceModelPolicy_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId")
    REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceModelPolicy_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId")
    REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "CommerceModelPolicy_platform_unique"
  ON "commerce"."CommerceModelPolicy"("environment", "context") WHERE "scope" = 'PLATFORM';
CREATE UNIQUE INDEX "CommerceModelPolicy_plan_unique"
  ON "commerce"."CommerceModelPolicy"("environment", "context", "merchantPricingPlanId") WHERE "scope" = 'PRICE_PLAN';
CREATE UNIQUE INDEX "CommerceModelPolicy_shop_unique"
  ON "commerce"."CommerceModelPolicy"("environment", "context", "shopId") WHERE "scope" = 'SHOP';
CREATE INDEX "CommerceModelPolicy_environment_context_scope_idx"
  ON "commerce"."CommerceModelPolicy"("environment", "context", "scope");
CREATE INDEX "CommerceModelPolicy_merchantPricingPlanId_idx"
  ON "commerce"."CommerceModelPolicy"("merchantPricingPlanId");
CREATE INDEX "CommerceModelPolicy_shopId_idx"
  ON "commerce"."CommerceModelPolicy"("shopId");

-- Identity is immutable. Updates use editVersion CAS (increment exactly once)
-- with an authorised Admin writer. Required Platform defaults cannot be deleted.
-- Scope overrides may be deleted; immutable audit events retain their ID.
CREATE FUNCTION "commerce".arch038_model_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."scope" = 'PLATFORM' THEN
      RAISE EXCEPTION 'ARCH038 Platform policy cannot be deleted' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."id",NEW."environment",NEW."context",NEW."scope",NEW."merchantPricingPlanId",NEW."shopId",NEW."createdAt",NEW."createdByAdminId")
       IS DISTINCT FROM
       ROW(OLD."id",OLD."environment",OLD."context",OLD."scope",OLD."merchantPricingPlanId",OLD."shopId",OLD."createdAt",OLD."createdByAdminId") THEN
      RAISE EXCEPTION 'ARCH038 policy identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW."editVersion" <> OLD."editVersion" + 1 OR NEW."updatedByAdminId" IS NULL THEN
      RAISE EXCEPTION 'ARCH038 policy update requires version increment and Admin' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."scope" <> 'PLATFORM' AND NEW."updatedByAdminId" IS NULL THEN
    RAISE EXCEPTION 'ARCH038 override creation requires Admin' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch038_model_policy_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "commerce"."CommerceModelPolicy"
  FOR EACH ROW EXECUTE FUNCTION "commerce".arch038_model_policy_guard();

-- Guarantee each context/environment has a migration-created Platform default.
INSERT INTO "commerce"."CommerceModelPolicy"
  ("id", "environment", "context", "scope", "budget", "budgetSchemaVersion", "editVersion")
SELECT 'arch038-' || lower(e::text) || '-' || lower(c::text) || '-platform',
       e, c, 'PLATFORM', '{"deadlineMs":60000,"outputTokens":800}'::jsonb, 1, 1
FROM unnest(enum_range(NULL::"commerce"."CommerceEnvironment")) e
CROSS JOIN unnest(enum_range(NULL::"commerce"."CommerceModelPolicyContext")) c;

-- Audit history has a stable modelPolicyId column without a FK so that
-- deletion of a sparse override does not rewrite immutable audit events.
ALTER TABLE "commerce"."CommerceAuditEvent" ADD COLUMN "modelPolicyId" TEXT;
CREATE INDEX "CommerceAuditEvent_modelPolicyId_createdAt_id_idx"
  ON "commerce"."CommerceAuditEvent"("modelPolicyId", "createdAt", "id");

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
    ELSE false
  END);
