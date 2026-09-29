-- ARCH-021 replaces the pre-production ARCH-020 capability/release composition.
-- Existing composition is deliberately recreated; Tool history and unrelated
-- billing, agent-configuration, connection, shop and conversation data survive.

ALTER TABLE commerce."CommerceAuditEvent" DROP CONSTRAINT arch020_audit_targets;
DROP TRIGGER arch020_audit_immutable ON commerce."CommerceAuditEvent";
DELETE FROM commerce."CommerceAuditEvent"
WHERE "action"::text IN (
  'CREATE_CAPABILITY', 'UPDATE_CAPABILITY', 'CREATE_DRAFT', 'UPDATE_DRAFT',
  'PUBLISH_REVISION', 'CREATE_RELEASE', 'ACTIVATE_RELEASE', 'ROLLBACK_RELEASE',
  'ENABLE_CAPABILITY', 'DISABLE_CAPABILITY'
);

DELETE FROM commerce."CommerceConversationGrant";
DROP TRIGGER arch020_grant_insert ON commerce."CommerceConversationGrant";
DROP FUNCTION commerce.arch020_grant();
ALTER TABLE commerce."CommerceConversationGrant" DROP CONSTRAINT arch020_grant_bounds;
ALTER TABLE commerce."CommerceConversationGrant" ADD CONSTRAINT arch021_grant_bounds CHECK (
  "initialInboundVersion" > 0
  AND "runnerVersion" ~ '[^[:space:]]'
  AND ("expiresAt" IS NULL OR "expiresAt" > "createdAt")
  AND commerce.arch020_strings("selectedCapabilityKeys", 0, 32)
  AND octet_length("selectedCapabilityKeys"::text) <= 8192
  AND commerce.arch020_grant_tools("grantedTools")
);
DELETE FROM commerce."CommerceReleasePointer";
DROP TRIGGER arch020_member_insert ON commerce."CommerceReleaseCapability";
DROP TRIGGER arch020_member_immutable ON commerce."CommerceReleaseCapability";
DELETE FROM commerce."CommerceReleaseCapability";
DELETE FROM commerce."CommerceRelease";

ALTER TABLE commerce."CommerceAuditEvent"
  DROP CONSTRAINT "CommerceAuditEvent_revisionId_fkey",
  DROP COLUMN "revisionId";
DROP TRIGGER arch020_audit_insert ON commerce."CommerceAuditEvent";
DROP FUNCTION commerce.arch020_audit();
ALTER TABLE commerce."CommerceReleaseCapability"
  DROP CONSTRAINT "CommerceReleaseCapability_capabilityRevisionId_capabilityI_fkey",
  DROP COLUMN "capabilityRevisionId";
DROP TABLE commerce."CommerceCapabilityRevision";
DELETE FROM commerce."CommerceCapability";

DROP TRIGGER arch020_capability_identity ON commerce."CommerceCapability";
DROP TRIGGER arch020_tool_identity ON commerce."CommerceTool";
DROP FUNCTION commerce.arch020_member();

ALTER TYPE commerce."CommerceCapabilityRevisionStatus" RENAME TO "CommerceToolRevisionStatus";

DROP INDEX commerce."CommerceCapability_one_base_idx";
ALTER TABLE commerce."CommerceCapability"
  DROP CONSTRAINT arch020_capability_selection,
  DROP COLUMN "selectionBinding",
  ALTER COLUMN "featureId" SET NOT NULL,
  ADD COLUMN "toolId" TEXT NOT NULL;
DROP TYPE commerce."CommerceCapabilitySelectionBinding";
CREATE UNIQUE INDEX "CommerceCapability_id_featureId_toolId_key"
  ON commerce."CommerceCapability"("id", "featureId", "toolId");
CREATE INDEX "CommerceCapability_toolId_idx" ON commerce."CommerceCapability"("toolId");
ALTER TABLE commerce."CommerceCapability"
  ADD CONSTRAINT "CommerceCapability_toolId_fkey"
    FOREIGN KEY ("toolId") REFERENCES commerce."CommerceTool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE commerce."CommerceReleaseCapability"
  ADD COLUMN "featureId" TEXT NOT NULL,
  ADD COLUMN "toolId" TEXT NOT NULL,
  ADD COLUMN "toolRevisionId" TEXT NOT NULL;

CREATE TABLE commerce."CommerceFeatureConfiguration" (
  "featureId" TEXT NOT NULL,
  "behaviourPrompt" TEXT NOT NULL DEFAULT '',
  "editVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceFeatureConfiguration_pkey" PRIMARY KEY ("featureId"),
  CONSTRAINT "CommerceFeatureConfiguration_featureId_fkey"
    FOREIGN KEY ("featureId") REFERENCES billing."Feature"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceFeatureConfiguration_editVersion_check" CHECK ("editVersion" >= 0)
);

CREATE TABLE commerce."CommerceReleaseFeature" (
  "releaseId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "behaviourPrompt" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceReleaseFeature_pkey" PRIMARY KEY ("releaseId", "featureId"),
  CONSTRAINT "CommerceReleaseFeature_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES commerce."CommerceRelease"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceReleaseFeature_featureId_fkey"
    FOREIGN KEY ("featureId") REFERENCES billing."Feature"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "CommerceReleaseFeature_featureId_releaseId_idx"
  ON commerce."CommerceReleaseFeature"("featureId", "releaseId");
CREATE INDEX "CommerceReleaseCapability_toolRevisionId_toolId_idx"
  ON commerce."CommerceReleaseCapability"("toolRevisionId", "toolId");
CREATE INDEX "CommerceReleaseCapability_featureId_releaseId_idx"
  ON commerce."CommerceReleaseCapability"("featureId", "releaseId");

ALTER TABLE commerce."CommerceReleaseCapability"
  ADD CONSTRAINT "CommerceReleaseCapability_capabilityId_featureId_toolId_fkey"
    FOREIGN KEY ("capabilityId", "featureId", "toolId")
    REFERENCES commerce."CommerceCapability"("id", "featureId", "toolId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceReleaseCapability_releaseId_featureId_fkey"
    FOREIGN KEY ("releaseId", "featureId")
    REFERENCES commerce."CommerceReleaseFeature"("releaseId", "featureId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CommerceReleaseCapability_toolRevisionId_toolId_fkey"
    FOREIGN KEY ("toolRevisionId", "toolId")
    REFERENCES commerce."CommerceToolRevision"("id", "toolId") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE commerce."CommerceAuditEvent"
  ADD COLUMN "featureId" TEXT,
  ADD CONSTRAINT "CommerceAuditEvent_featureId_fkey"
    FOREIGN KEY ("featureId") REFERENCES billing."Feature"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CommerceAuditEvent_featureId_createdAt_id_idx"
  ON commerce."CommerceAuditEvent"("featureId", "createdAt", "id");

CREATE TYPE commerce."CommerceAuditAction_next" AS ENUM (
  'CREATE_CAPABILITY', 'UPDATE_CAPABILITY', 'CREATE_RELEASE', 'ACTIVATE_RELEASE',
  'ROLLBACK_RELEASE', 'ENABLE_CAPABILITY', 'DISABLE_CAPABILITY', 'UPDATE_FEATURE_BEHAVIOUR',
  'CREATE_TOOL', 'UPDATE_TOOL', 'CREATE_TOOL_DRAFT', 'UPDATE_TOOL_DRAFT',
  'PUBLISH_TOOL_REVISION', 'ENABLE_TOOL', 'DISABLE_TOOL',
  'CREATE_MODEL_CATALOGUE_ENTRY', 'UPDATE_MODEL_CATALOGUE_ENTRY',
  'ENABLE_MODEL_CATALOGUE_ENTRY', 'DISABLE_MODEL_CATALOGUE_ENTRY',
  'SET_PLATFORM_MODEL_SELECTION', 'SET_SHOP_MODEL_SELECTION', 'CLEAR_SHOP_MODEL_SELECTION',
  'CREATE_PROMPT_TEMPLATE_CATEGORY', 'UPDATE_PROMPT_TEMPLATE_CATEGORY',
  'ENABLE_PROMPT_TEMPLATE_CATEGORY', 'DISABLE_PROMPT_TEMPLATE_CATEGORY',
  'CREATE_PROMPT_TEMPLATE', 'UPDATE_PROMPT_TEMPLATE', 'ENABLE_PROMPT_TEMPLATE',
  'DISABLE_PROMPT_TEMPLATE', 'CREATE_PROMPT_TEMPLATE_DRAFT',
  'UPDATE_PROMPT_TEMPLATE_DRAFT', 'PUBLISH_PROMPT_TEMPLATE_REVISION',
  'CREATE_AGENT_PROMPT', 'CREATE_AGENT_PROMPT_DRAFT',
  'CREATE_AGENT_PROMPT_DRAFT_FROM_TEMPLATE', 'UPDATE_AGENT_PROMPT_DRAFT',
  'PUBLISH_AGENT_PROMPT_REVISION', 'SET_PLATFORM_PROMPT_POINTER',
  'SET_SHOP_PROMPT_POINTER', 'CLEAR_SHOP_PROMPT_POINTER',
  'UPSERT_AGENT_CONFIGURATION', 'SET_AGENT_MODEL', 'CLEAR_AGENT_MODEL',
  'SET_AGENT_PROMPT', 'CLEAR_AGENT_PROMPT', 'UPDATE_PROMPT_TEMPLATE_CONTENT',
  'GRANT_MERCHANT_STUDIO_ACCESS', 'UPDATE_MERCHANT_STUDIO_ACCESS',
  'DISABLE_MERCHANT_STUDIO_ACCESS', 'BIND_MERCHANT_STUDIO_IDENTITY'
);
ALTER TABLE commerce."CommerceAuditEvent"
  ALTER COLUMN "action" TYPE commerce."CommerceAuditAction_next"
  USING ("action"::text::commerce."CommerceAuditAction_next");
DROP TYPE commerce."CommerceAuditAction";
ALTER TYPE commerce."CommerceAuditAction_next" RENAME TO "CommerceAuditAction";

ALTER TABLE commerce."CommerceAuditEvent" ADD CONSTRAINT arch020_audit_targets CHECK (CASE
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
  ELSE false END);

CREATE FUNCTION commerce.arch021_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."toolRevisionId" IS NOT NULL AND NEW."toolId" IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM commerce."CommerceToolRevision" WHERE id=NEW."toolRevisionId" AND "toolId"=NEW."toolId") THEN
    RAISE EXCEPTION 'ARCH021 audit Tool mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch021_audit_insert BEFORE INSERT ON commerce."CommerceAuditEvent" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_audit_insert();

CREATE OR REPLACE FUNCTION commerce.arch020_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_TABLE_NAME = 'CommerceTool' THEN
    IF NEW."name" IS DISTINCT FROM OLD."name" THEN RAISE EXCEPTION 'ARCH020 tool name immutable' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW."key", NEW."featureId", NEW."toolId") IS DISTINCT FROM ROW(OLD."key", OLD."featureId", OLD."toolId") THEN
    RAISE EXCEPTION 'ARCH021 capability identity immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_tool_identity BEFORE UPDATE ON commerce."CommerceTool" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_identity();
CREATE TRIGGER arch021_capability_identity BEFORE UPDATE ON commerce."CommerceCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_identity();

CREATE OR REPLACE FUNCTION commerce.arch020_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_name text;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'ARCH020 published Tool revision immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF NEW."editVersion"::bigint <> OLD."editVersion"::bigint+1 OR
      ROW(NEW.id, NEW."createdByAdminId", NEW."revisionNumber", NEW."createdAt") IS DISTINCT FROM ROW(OLD.id, OLD."createdByAdminId", OLD."revisionNumber", OLD."createdAt") THEN
      RAISE EXCEPTION 'ARCH020 Tool revision identity or editVersion' USING ERRCODE='23514';
    END IF;
    IF NEW."toolId" IS DISTINCT FROM OLD."toolId" THEN RAISE EXCEPTION 'ARCH020 tool identity' USING ERRCODE='23514'; END IF;
  END IF;
  SELECT name INTO owner_name FROM commerce."CommerceTool" WHERE id=NEW."toolId" FOR SHARE;
  IF NEW.definition->>'name' IS DISTINCT FROM owner_name OR NEW.definition->>'definitionVersion' IS DISTINCT FROM NEW."definitionVersion" THEN
    RAISE EXCEPTION 'ARCH020 definition identity mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP FUNCTION commerce.arch020_bindings(jsonb);

CREATE FUNCTION commerce.arch021_feature_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  PERFORM 1 FROM billing."Feature" WHERE id=NEW."featureId" FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW."editVersion" <> 0 THEN RAISE EXCEPTION 'ARCH021 feature configuration must start at version zero' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW."featureId" IS DISTINCT FROM OLD."featureId" OR NEW."editVersion"::bigint <> OLD."editVersion"::bigint+1 THEN
      RAISE EXCEPTION 'ARCH021 feature configuration identity or editVersion' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch021_feature_configuration_guard BEFORE INSERT OR UPDATE ON commerce."CommerceFeatureConfiguration" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_feature_configuration_guard();
CREATE FUNCTION commerce.arch021_feature_configuration_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ARCH021 feature configuration cannot be deleted' USING ERRCODE='23514'; END $$;
CREATE TRIGGER arch021_feature_configuration_no_delete BEFORE DELETE ON commerce."CommerceFeatureConfiguration" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_feature_configuration_no_delete();

CREATE FUNCTION commerce.arch021_release_feature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_prompt text;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  PERFORM 1 FROM billing."Feature" WHERE id=NEW."featureId" FOR SHARE;
  SELECT "behaviourPrompt" INTO current_prompt FROM commerce."CommerceFeatureConfiguration" WHERE "featureId"=NEW."featureId";
  IF NOT FOUND THEN current_prompt := ''; END IF;
  IF NEW."behaviourPrompt" IS DISTINCT FROM current_prompt THEN RAISE EXCEPTION 'ARCH021 release Feature snapshot must match current behaviour prompt' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch021_release_feature_guard BEFORE INSERT ON commerce."CommerceReleaseFeature" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_release_feature_guard();
CREATE TRIGGER arch021_release_feature_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceReleaseFeature" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();

CREATE FUNCTION commerce.arch021_release_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_status commerce."CommerceToolRevisionStatus";
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  PERFORM 1 FROM commerce."CommerceRelease" WHERE id=NEW."releaseId" FOR UPDATE;
  SELECT status INTO revision_status FROM commerce."CommerceToolRevision"
    WHERE id=NEW."toolRevisionId" AND "toolId"=NEW."toolId" FOR SHARE;
  IF NOT FOUND OR revision_status <> 'PUBLISHED' THEN RAISE EXCEPTION 'ARCH021 release member requires matching published Tool revision' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM commerce."CommerceReleaseCapability" member
    WHERE member."releaseId"=NEW."releaseId" AND member."toolId"=NEW."toolId"
      AND member."toolRevisionId"<>NEW."toolRevisionId") THEN
    RAISE EXCEPTION 'ARCH021 reused Tool must use one release revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch021_release_member_guard BEFORE INSERT ON commerce."CommerceReleaseCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_release_member_guard();
CREATE TRIGGER arch021_release_member_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceReleaseCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();

CREATE FUNCTION commerce.arch021_conversation_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conv whatsapp."Conversation"%ROWTYPE; owner_shop text; expected jsonb; actual jsonb;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  SELECT * INTO conv FROM whatsapp."Conversation" WHERE id=NEW."conversationId" FOR UPDATE;
  IF NOT FOUND OR conv."checkoutRecoveryId" IS NULL OR conv."checkoutRecoveryId" IN ('standalone','product-only','unknown-shop') THEN
    RAISE EXCEPTION 'ARCH021 recovery conversation required' USING ERRCODE='23514';
  END IF;
  SELECT "shopId" INTO owner_shop FROM commerce."CheckoutRecovery" WHERE id=conv."checkoutRecoveryId" FOR UPDATE;
  IF NOT FOUND OR owner_shop IS DISTINCT FROM NEW."shopId" OR
    (conv."shopId" IS NOT NULL AND conv."shopId" IS DISTINCT FROM owner_shop) OR
    NEW."initialInboundVersion" > conv."inboundVersion" THEN
    RAISE EXCEPTION 'ARCH021 grant owner or inbound version mismatch' USING ERRCODE='23514';
  END IF;
  IF commerce.arch020_strings(NEW."selectedCapabilityKeys", 0, 32) IS DISTINCT FROM true OR
    octet_length(NEW."selectedCapabilityKeys"::text) > 8192 OR
    commerce.arch020_grant_tools(NEW."grantedTools") IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ARCH021 grant shape' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(NEW."selectedCapabilityKeys") selected(key)
    WHERE NOT EXISTS (
      SELECT 1 FROM commerce."CommerceReleaseCapability" member
      JOIN commerce."CommerceCapability" capability ON capability.id=member."capabilityId"
      WHERE member."releaseId"=NEW."releaseId" AND capability.key=selected.key
    )
  ) THEN
    RAISE EXCEPTION 'ARCH021 selected key outside release' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'toolId' COLLATE "C"), '[]'::jsonb)
  INTO expected
  FROM (
    SELECT jsonb_build_object(
      'toolId', tool.id,
      'toolRevisionId', tool_revision.id,
      'toolName', tool.name,
      'definitionVersion', tool_revision."definitionVersion",
      'capabilityKeys', jsonb_agg(capability.key ORDER BY capability.key COLLATE "C")
    ) AS entry
    FROM commerce."CommerceReleaseCapability" member
    JOIN commerce."CommerceCapability" capability ON capability.id=member."capabilityId"
    JOIN commerce."CommerceTool" tool ON tool.id=member."toolId"
    JOIN commerce."CommerceToolRevision" tool_revision
      ON tool_revision.id=member."toolRevisionId" AND tool_revision."toolId"=member."toolId"
      AND tool_revision.status='PUBLISHED'
    WHERE member."releaseId"=NEW."releaseId"
      AND NEW."selectedCapabilityKeys" ? capability.key
    GROUP BY tool.id, tool_revision.id, tool.name, tool_revision."definitionVersion"
  ) entries;
  SELECT COALESCE(jsonb_agg(granted ORDER BY granted->>'toolId' COLLATE "C"), '[]'::jsonb)
  INTO actual
  FROM jsonb_array_elements(NEW."grantedTools") granted;
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'ARCH021 grant must equal direct release Tool authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch021_conversation_grant_guard BEFORE INSERT ON commerce."CommerceConversationGrant" FOR EACH ROW EXECUTE FUNCTION commerce.arch021_conversation_grant_guard();

CREATE TRIGGER arch021_audit_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceAuditEvent" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();