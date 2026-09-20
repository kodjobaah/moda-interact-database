-- CreateEnum
CREATE TYPE "commerce"."CommerceCapabilitySelectionBinding" AS ENUM ('BASE', 'FEATURE', 'RECOVERY_POLICY');

-- CreateEnum
CREATE TYPE "commerce"."CommerceCapabilityRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "commerce"."CommerceEnvironment" AS ENUM ('LOCAL', 'TEST', 'DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "commerce"."CommerceAuditAction" AS ENUM ('CREATE_CAPABILITY', 'UPDATE_CAPABILITY', 'CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH_REVISION', 'CREATE_RELEASE', 'ACTIVATE_RELEASE', 'ROLLBACK_RELEASE', 'ENABLE_CAPABILITY', 'DISABLE_CAPABILITY', 'CREATE_TOOL', 'UPDATE_TOOL', 'CREATE_TOOL_DRAFT', 'UPDATE_TOOL_DRAFT', 'PUBLISH_TOOL_REVISION', 'ENABLE_TOOL', 'DISABLE_TOOL');

-- CreateTable
CREATE TABLE "commerce"."CommerceCapability" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "selectionBinding" "commerce"."CommerceCapabilitySelectionBinding" NOT NULL,
    "featureId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceCapabilityRevision" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "commerce"."CommerceCapabilityRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "contractVersion" VARCHAR(64) NOT NULL,
    "editVersion" INTEGER NOT NULL DEFAULT 0,
    "contentHash" VARCHAR(64),
    "createdByAdminId" TEXT NOT NULL,
    "publishedByAdminId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "promptTemplate" TEXT NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "toolBindings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "CommerceCapabilityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceRelease" (
    "id" TEXT NOT NULL,
    "releaseNumber" SERIAL NOT NULL,
    "description" TEXT,
    "runnerCompatibility" VARCHAR(128) NOT NULL,
    "contractVersion" VARCHAR(64) NOT NULL,
    "responseContract" JSONB NOT NULL,
    "responseContractHash" VARCHAR(64) NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceReleaseCapability" (
    "releaseId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "capabilityRevisionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CommerceReleaseCapability_pkey" PRIMARY KEY ("releaseId","capabilityId")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceReleasePointer" (
    "environment" "commerce"."CommerceEnvironment" NOT NULL,
    "releaseId" TEXT NOT NULL,
    "editVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedByAdminId" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceReleasePointer_pkey" PRIMARY KEY ("environment")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceAuditEvent" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "action" "commerce"."CommerceAuditAction" NOT NULL,
    "capabilityId" TEXT,
    "revisionId" TEXT,
    "releaseId" TEXT,
    "toolId" TEXT,
    "toolRevisionId" TEXT,
    "environment" "commerce"."CommerceEnvironment",
    "reason" VARCHAR(1000) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceConversationGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "initialInboundVersion" INTEGER NOT NULL,
    "releaseId" TEXT NOT NULL,
    "selectedCapabilityKeys" JSONB NOT NULL,
    "grantedTools" JSONB NOT NULL,
    "runnerVersion" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "CommerceConversationGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceTool" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceTool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."CommerceToolRevision" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "commerce"."CommerceCapabilityRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "contractVersion" VARCHAR(64) NOT NULL,
    "editVersion" INTEGER NOT NULL DEFAULT 0,
    "contentHash" VARCHAR(64),
    "createdByAdminId" TEXT NOT NULL,
    "publishedByAdminId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "definitionVersion" VARCHAR(64) NOT NULL,
    "definition" JSONB NOT NULL,

    CONSTRAINT "CommerceToolRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCapability_key_key" ON "commerce"."CommerceCapability"("key");

-- CreateIndex
CREATE INDEX "CommerceCapability_featureId_idx" ON "commerce"."CommerceCapability"("featureId");

-- CreateIndex
CREATE INDEX "CommerceCapabilityRevision_capabilityId_status_revisionNumb_idx" ON "commerce"."CommerceCapabilityRevision"("capabilityId", "status", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCapabilityRevision_capabilityId_revisionNumber_key" ON "commerce"."CommerceCapabilityRevision"("capabilityId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCapabilityRevision_id_capabilityId_key" ON "commerce"."CommerceCapabilityRevision"("id", "capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceRelease_releaseNumber_key" ON "commerce"."CommerceRelease"("releaseNumber");

-- CreateIndex
CREATE INDEX "CommerceRelease_createdAt_id_idx" ON "commerce"."CommerceRelease"("createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceReleaseCapability_capabilityRevisionId_capabilityId_idx" ON "commerce"."CommerceReleaseCapability"("capabilityRevisionId", "capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceReleaseCapability_releaseId_position_key" ON "commerce"."CommerceReleaseCapability"("releaseId", "position");

-- CreateIndex
CREATE INDEX "CommerceReleasePointer_releaseId_idx" ON "commerce"."CommerceReleasePointer"("releaseId");

-- CreateIndex
CREATE INDEX "CommerceAuditEvent_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceAuditEvent_capabilityId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("capabilityId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceAuditEvent_releaseId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("releaseId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceAuditEvent_actorAdminId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("actorAdminId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceAuditEvent_toolId_createdAt_id_idx" ON "commerce"."CommerceAuditEvent"("toolId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceConversationGrant_conversationId_key" ON "commerce"."CommerceConversationGrant"("conversationId");

-- CreateIndex
CREATE INDEX "CommerceConversationGrant_shopId_createdAt_id_idx" ON "commerce"."CommerceConversationGrant"("shopId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceConversationGrant_releaseId_idx" ON "commerce"."CommerceConversationGrant"("releaseId");

-- CreateIndex
CREATE INDEX "CommerceConversationGrant_expiresAt_idx" ON "commerce"."CommerceConversationGrant"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceTool_name_key" ON "commerce"."CommerceTool"("name");

-- CreateIndex
CREATE INDEX "CommerceTool_createdAt_id_idx" ON "commerce"."CommerceTool"("createdAt", "id");

-- CreateIndex
CREATE INDEX "CommerceToolRevision_toolId_status_revisionNumber_idx" ON "commerce"."CommerceToolRevision"("toolId", "status", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceToolRevision_toolId_revisionNumber_key" ON "commerce"."CommerceToolRevision"("toolId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceToolRevision_toolId_definitionVersion_key" ON "commerce"."CommerceToolRevision"("toolId", "definitionVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceToolRevision_id_toolId_key" ON "commerce"."CommerceToolRevision"("id", "toolId");

-- AddForeignKey
ALTER TABLE "commerce"."CommerceCapability" ADD CONSTRAINT "CommerceCapability_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "billing"."Feature"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceCapabilityRevision" ADD CONSTRAINT "CommerceCapabilityRevision_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "commerce"."CommerceCapability"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceCapabilityRevision" ADD CONSTRAINT "CommerceCapabilityRevision_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceCapabilityRevision" ADD CONSTRAINT "CommerceCapabilityRevision_publishedByAdminId_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceRelease" ADD CONSTRAINT "CommerceRelease_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceReleaseCapability" ADD CONSTRAINT "CommerceReleaseCapability_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "commerce"."CommerceRelease"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceReleaseCapability" ADD CONSTRAINT "CommerceReleaseCapability_capabilityRevisionId_capabilityI_fkey" FOREIGN KEY ("capabilityRevisionId", "capabilityId") REFERENCES "commerce"."CommerceCapabilityRevision"("id", "capabilityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceReleasePointer" ADD CONSTRAINT "CommerceReleasePointer_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "commerce"."CommerceRelease"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceReleasePointer" ADD CONSTRAINT "CommerceReleasePointer_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "commerce"."CommerceCapability"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "commerce"."CommerceCapabilityRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "commerce"."CommerceRelease"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "commerce"."CommerceTool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceAuditEvent" ADD CONSTRAINT "CommerceAuditEvent_toolRevisionId_fkey" FOREIGN KEY ("toolRevisionId") REFERENCES "commerce"."CommerceToolRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceConversationGrant" ADD CONSTRAINT "CommerceConversationGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceConversationGrant" ADD CONSTRAINT "CommerceConversationGrant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceConversationGrant" ADD CONSTRAINT "CommerceConversationGrant_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "commerce"."CommerceRelease"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceToolRevision" ADD CONSTRAINT "CommerceToolRevision_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "commerce"."CommerceTool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceToolRevision" ADD CONSTRAINT "CommerceToolRevision_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "commerce"."CommerceToolRevision" ADD CONSTRAINT "CommerceToolRevision_publishedByAdminId_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ARCH-020 structural and durable integrity guards. Services own semantic
-- GraphQL/SemVer/hash validation, authorization, CAS predicates and atomic
-- initial release assembly. SQL deliberately does not forbid later member INSERT.
CREATE FUNCTION commerce.arch020_object(v jsonb, keys text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN RETURN false; END IF;
  RETURN (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(v) k)
    = (SELECT array_agg(k ORDER BY k COLLATE "C") FROM unnest(keys) k);
END $$;
CREATE FUNCTION commerce.arch020_string(v jsonb, maxlen int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(v) = 'string' AND length(v #>> '{}') BETWEEN 1 AND maxlen, false)
$$;
CREATE FUNCTION commerce.arch020_strings(v jsonb, minlen int, maxlen int, sorted boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb; prior text; seen text[] := '{}'; value text;
BEGIN
  IF jsonb_typeof(v) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(v) NOT BETWEEN minlen AND maxlen THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF NOT commerce.arch020_string(item,128) THEN RETURN false; END IF;
    value := item #>> '{}';
    IF value = ANY(seen) OR (sorted AND prior COLLATE "C" >= value COLLATE "C") THEN RETURN false; END IF;
    seen := array_append(seen,value); prior := value;
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION commerce.arch020_bindings(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb; seen text[] := '{}';
BEGIN
  IF jsonb_typeof(v) <> 'array' OR octet_length(v::text)>16384 THEN RETURN false; END IF;
  IF jsonb_array_length(v)>32 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF NOT commerce.arch020_object(item,ARRAY['toolId','toolRevisionId']) OR
       NOT commerce.arch020_string(item->'toolId',128) OR NOT commerce.arch020_string(item->'toolRevisionId',128)
       OR item->>'toolId'=ANY(seen) THEN RETURN false; END IF;
    seen:=array_append(seen,item->>'toolId');
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION commerce.arch020_grant_tools(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb; ids text[] := '{}'; names text[] := '{}';
BEGIN
  IF jsonb_typeof(v)<>'array' OR octet_length(v::text)>65536 THEN RETURN false; END IF;
  IF jsonb_array_length(v)>32 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF NOT commerce.arch020_object(item,ARRAY['toolId','toolRevisionId','toolName','definitionVersion','capabilityKeys']) OR
      NOT commerce.arch020_string(item->'toolId',128) OR NOT commerce.arch020_string(item->'toolRevisionId',128) OR
      NOT commerce.arch020_string(item->'toolName',128) OR NOT commerce.arch020_string(item->'definitionVersion',64) OR
      commerce.arch020_strings(item->'capabilityKeys',1,32,true) IS DISTINCT FROM true OR
      item->>'toolId'=ANY(ids) OR item->>'toolName'=ANY(names) THEN RETURN false; END IF;
    ids:=array_append(ids,item->>'toolId'); names:=array_append(names,item->>'toolName');
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION commerce.arch020_definition(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT COALESCE(commerce.arch020_object(v,ARRAY['name','definitionVersion','description','inputSchema','execution','responseTemplate'])
    AND octet_length(v::text)<=65536
    AND commerce.arch020_string(v->'name',128) AND v->>'name' ~ '^[a-z][a-z0-9_]{0,127}$'
    AND commerce.arch020_string(v->'definitionVersion',64)
    AND v->>'definitionVersion' ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    AND jsonb_typeof(v->'description')='string' AND v->>'description' ~ '[^[:space:]]'
    AND jsonb_typeof(v->'inputSchema')='object' AND jsonb_typeof(v->'execution')='object'
    AND jsonb_typeof(v->'responseTemplate')='object',false)
$$;

-- C16 structural validation only. Shared/Commerce own supported-schema
-- semantics, RFC 8785 canonicalization and hash/content equality.
CREATE FUNCTION commerce.arch020_response_contract(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT COALESCE(commerce.arch020_object(v,ARRAY['version','instructions','detailsSchema'])
    AND v->>'version'='response.v1'
    AND commerce.arch020_string(v->'instructions',8000)
    AND jsonb_typeof(v->'detailsSchema')='object',false)
$$;

ALTER TABLE commerce."CommerceCapability"
  ADD CONSTRAINT arch020_capability_bounds CHECK ("key" ~ '^[a-z][a-z0-9_]{0,127}$' AND "displayName" ~ '[^[:space:]]' AND ("description" IS NULL OR length("description")<=4000)),
  ADD CONSTRAINT arch020_capability_selection CHECK (("selectionBinding"='FEATURE')=("featureId" IS NOT NULL)
    AND (("selectionBinding"='BASE')=("key"='conversation_core'))
    AND ("selectionBinding"<>'RECOVERY_POLICY' OR "key"='discount_assistance'));
CREATE UNIQUE INDEX "CommerceCapability_one_base_idx" ON commerce."CommerceCapability" ("selectionBinding") WHERE "selectionBinding"='BASE';
ALTER TABLE commerce."CommerceTool"
  ADD CONSTRAINT arch020_tool_bounds CHECK ("name" ~ '^[a-z][a-z0-9_]{0,127}$' AND "displayName" ~ '[^[:space:]]' AND ("description" IS NULL OR length("description")<=4000));
ALTER TABLE commerce."CommerceCapabilityRevision"
  ADD CONSTRAINT arch020_capability_revision_bounds CHECK ("revisionNumber">0 AND "editVersion">=0 AND "contractVersion" ~ '[^[:space:]]'
    AND length("promptTemplate") BETWEEN 1 AND 32000 AND "promptTemplate" ~ '[^[:space:]]'
    AND jsonb_typeof("configuration")='object' AND octet_length("configuration"::text)<=16384
    AND commerce.arch020_bindings("toolBindings")),
  ADD CONSTRAINT arch020_capability_publication CHECK (
    ("status"='DRAFT' AND "publishedByAdminId" IS NULL AND "publishedAt" IS NULL AND "contentHash" IS NULL) OR
    ("status"='PUBLISHED' AND "publishedByAdminId" IS NOT NULL AND "publishedAt" IS NOT NULL AND "contentHash" IS NOT NULL
      AND "contentHash" ~ '^[0-9a-f]{64}$' AND "publishedAt">="createdAt"));
ALTER TABLE commerce."CommerceToolRevision"
  ADD CONSTRAINT arch020_tool_revision_bounds CHECK ("revisionNumber">0 AND "editVersion">=0 AND "contractVersion" ~ '[^[:space:]]'
    AND "definitionVersion" ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND commerce.arch020_definition("definition")),
  ADD CONSTRAINT arch020_tool_publication CHECK (
    ("status"='DRAFT' AND "publishedByAdminId" IS NULL AND "publishedAt" IS NULL AND "contentHash" IS NULL) OR
    ("status"='PUBLISHED' AND "publishedByAdminId" IS NOT NULL AND "publishedAt" IS NOT NULL AND "contentHash" IS NOT NULL
      AND "contentHash" ~ '^[0-9a-f]{64}$' AND "publishedAt">="createdAt"));
ALTER TABLE commerce."CommerceRelease"
  ADD CONSTRAINT arch020_release_response_contract CHECK (commerce.arch020_response_contract("responseContract")),
  ADD CONSTRAINT arch020_release_response_hash CHECK ("responseContractHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT arch020_release_bounds CHECK ("releaseNumber">0 AND ("description" IS NULL OR length("description")<=4000)
    AND "runnerCompatibility" ~ '[^[:space:]]' AND "contractVersion" ~ '[^[:space:]]');
ALTER TABLE commerce."CommerceReleaseCapability" ADD CONSTRAINT arch020_member_position CHECK ("position">=0);
ALTER TABLE commerce."CommerceReleasePointer" ADD CONSTRAINT arch020_pointer_version CHECK ("editVersion">=0);
ALTER TABLE commerce."CommerceAuditEvent"
  ADD CONSTRAINT arch020_audit_bounds CHECK ("reason" ~ '[^[:space:]]' AND jsonb_typeof("metadata")='object' AND octet_length("metadata"::text)<=8192),
  ADD CONSTRAINT arch020_audit_targets CHECK (CASE
    WHEN "action" IN ('CREATE_CAPABILITY','UPDATE_CAPABILITY','ENABLE_CAPABILITY','DISABLE_CAPABILITY') THEN "capabilityId" IS NOT NULL
    WHEN "action" IN ('CREATE_DRAFT','UPDATE_DRAFT','PUBLISH_REVISION') THEN "capabilityId" IS NOT NULL AND "revisionId" IS NOT NULL
    WHEN "action"='CREATE_RELEASE' THEN "releaseId" IS NOT NULL
    WHEN "action" IN ('ACTIVATE_RELEASE','ROLLBACK_RELEASE') THEN "releaseId" IS NOT NULL AND "environment" IS NOT NULL
    WHEN "action" IN ('CREATE_TOOL','UPDATE_TOOL','ENABLE_TOOL','DISABLE_TOOL') THEN "toolId" IS NOT NULL
    WHEN "action" IN ('CREATE_TOOL_DRAFT','UPDATE_TOOL_DRAFT','PUBLISH_TOOL_REVISION') THEN "toolId" IS NOT NULL AND "toolRevisionId" IS NOT NULL
    ELSE false END);
ALTER TABLE commerce."CommerceConversationGrant"
  ADD CONSTRAINT arch020_grant_bounds CHECK ("initialInboundVersion">0 AND "runnerVersion" ~ '[^[:space:]]'
    AND ("expiresAt" IS NULL OR "expiresAt">"createdAt")
    AND commerce.arch020_strings("selectedCapabilityKeys",1,32) AND octet_length("selectedCapabilityKeys"::text)<=8192
    AND commerce.arch020_grant_tools("grantedTools"));

CREATE FUNCTION commerce.arch020_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ARCH020 immutable %',TG_TABLE_NAME USING ERRCODE='23514'; END $$;
CREATE TRIGGER arch020_release_immutable BEFORE UPDATE ON commerce."CommerceRelease" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();
CREATE TRIGGER arch020_member_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceReleaseCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();
CREATE TRIGGER arch020_audit_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceAuditEvent" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();
CREATE TRIGGER arch020_grant_immutable BEFORE UPDATE ON commerce."CommerceConversationGrant" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();

-- Repeatable Read can retain a pre-lock snapshot without SSI's conflict check.
-- READ COMMITTED refreshes SPI reads; SERIALIZABLE aborts inconsistent races.
-- Reject this unsupported isolation instead of silently weakening invariants.
CREATE FUNCTION commerce.arch020_current_snapshot() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation')='repeatable read' THEN
    RAISE EXCEPTION 'ARCH020 relational guards require READ COMMITTED or SERIALIZABLE' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION commerce.arch020_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_TABLE_NAME='CommerceTool' THEN
    IF NEW."name" IS DISTINCT FROM OLD."name" THEN RAISE EXCEPTION 'ARCH020 tool name immutable' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW."key",NEW."selectionBinding",NEW."featureId") IS DISTINCT FROM ROW(OLD."key",OLD."selectionBinding",OLD."featureId")
      AND EXISTS(SELECT 1 FROM commerce."CommerceCapabilityRevision" WHERE "capabilityId"=OLD.id) THEN
      RAISE EXCEPTION 'ARCH020 capability selection immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_capability_identity BEFORE UPDATE ON commerce."CommerceCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_identity();
CREATE TRIGGER arch020_tool_identity BEFORE UPDATE ON commerce."CommerceTool" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_identity();

CREATE FUNCTION commerce.arch020_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding jsonb; owner_name text;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.status='PUBLISHED' THEN RAISE EXCEPTION 'ARCH020 published revision immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF NEW."editVersion"::bigint <> OLD."editVersion"::bigint+1 OR
      ROW(NEW.id,NEW."createdByAdminId",NEW."revisionNumber",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."createdByAdminId",OLD."revisionNumber",OLD."createdAt") THEN
      RAISE EXCEPTION 'ARCH020 revision identity or editVersion' USING ERRCODE='23514'; END IF;
    IF TG_TABLE_NAME='CommerceToolRevision' THEN
      IF NEW."toolId" IS DISTINCT FROM OLD."toolId" THEN RAISE EXCEPTION 'ARCH020 tool identity' USING ERRCODE='23514'; END IF;
    ELSE
      IF NEW."capabilityId" IS DISTINCT FROM OLD."capabilityId" THEN RAISE EXCEPTION 'ARCH020 capability identity' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='CommerceToolRevision' THEN
    SELECT name INTO owner_name FROM commerce."CommerceTool" WHERE id=NEW."toolId" FOR SHARE;
    IF NEW.definition->>'name' IS DISTINCT FROM owner_name OR NEW.definition->>'definitionVersion' IS DISTINCT FROM NEW."definitionVersion" THEN
      RAISE EXCEPTION 'ARCH020 definition identity mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    -- Serializes the first revision with capability selection identity changes.
    PERFORM 1 FROM commerce."CommerceCapability" WHERE id=NEW."capabilityId" FOR SHARE;
    IF commerce.arch020_bindings(NEW."toolBindings") IS DISTINCT FROM true THEN RAISE EXCEPTION 'ARCH020 malformed bindings' USING ERRCODE='23514'; END IF;
    FOR binding IN SELECT * FROM jsonb_array_elements(NEW."toolBindings") LOOP
      PERFORM 1 FROM commerce."CommerceToolRevision" WHERE id=binding->>'toolRevisionId' AND "toolId"=binding->>'toolId' AND status='PUBLISHED' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'ARCH020 binding requires matching published tool' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_capability_revision BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommerceCapabilityRevision" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_revision();
CREATE TRIGGER arch020_tool_revision BEFORE INSERT OR UPDATE OR DELETE ON commerce."CommerceToolRevision" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_revision();

CREATE FUNCTION commerce.arch020_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bindings jsonb;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  -- Serialize simultaneous membership inserts so conflicting revisions cannot race.
  PERFORM 1 FROM commerce."CommerceRelease" WHERE id=NEW."releaseId" FOR UPDATE;
  SELECT "toolBindings" INTO bindings FROM commerce."CommerceCapabilityRevision"
    WHERE id=NEW."capabilityRevisionId" AND "capabilityId"=NEW."capabilityId" AND status='PUBLISHED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ARCH020 member requires matching published capability' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM commerce."CommerceReleaseCapability" m
    JOIN commerce."CommerceCapabilityRevision" r ON r.id=m."capabilityRevisionId"
    CROSS JOIN LATERAL jsonb_array_elements(r."toolBindings") old_binding
    CROSS JOIN LATERAL jsonb_array_elements(bindings) new_binding
    WHERE m."releaseId"=NEW."releaseId" AND old_binding->>'toolId'=new_binding->>'toolId'
      AND old_binding->>'toolRevisionId'<>new_binding->>'toolRevisionId') THEN
    RAISE EXCEPTION 'ARCH020 conflicting release tool revisions' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_member_insert BEFORE INSERT ON commerce."CommerceReleaseCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_member();
CREATE FUNCTION commerce.arch020_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.environment IS DISTINCT FROM OLD.environment OR NEW."editVersion"::bigint<>OLD."editVersion"::bigint+1) THEN
    RAISE EXCEPTION 'ARCH020 pointer identity or editVersion' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM commerce."CommerceReleaseCapability" WHERE "releaseId"=NEW."releaseId") THEN
    RAISE EXCEPTION 'ARCH020 empty release' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_pointer BEFORE INSERT OR UPDATE ON commerce."CommerceReleasePointer" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_pointer();
CREATE FUNCTION commerce.arch020_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revisionId" IS NOT NULL AND NEW."capabilityId" IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM commerce."CommerceCapabilityRevision" WHERE id=NEW."revisionId" AND "capabilityId"=NEW."capabilityId") THEN
    RAISE EXCEPTION 'ARCH020 audit capability mismatch' USING ERRCODE='23514'; END IF;
  IF NEW."toolRevisionId" IS NOT NULL AND NEW."toolId" IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM commerce."CommerceToolRevision" WHERE id=NEW."toolRevisionId" AND "toolId"=NEW."toolId") THEN
    RAISE EXCEPTION 'ARCH020 audit tool mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_audit_insert BEFORE INSERT ON commerce."CommerceAuditEvent" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_audit();

CREATE FUNCTION commerce.arch020_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conv whatsapp."Conversation"%ROWTYPE; owner_shop text; expected jsonb; actual jsonb;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  -- Lock the parent records before validation. Owner-changing UPDATEs take the
  -- same locks; recheck snapshots after waiting, using READ COMMITTED transactions.
  SELECT * INTO conv FROM whatsapp."Conversation" WHERE id=NEW."conversationId" FOR UPDATE;
  IF NOT FOUND OR conv."checkoutRecoveryId" IS NULL OR conv."checkoutRecoveryId" IN ('standalone','product-only','unknown-shop') THEN
    RAISE EXCEPTION 'ARCH020 recovery conversation required' USING ERRCODE='23514'; END IF;
  SELECT "shopId" INTO owner_shop FROM commerce."CheckoutRecovery" WHERE id=conv."checkoutRecoveryId" FOR UPDATE;
  IF NOT FOUND OR owner_shop IS DISTINCT FROM NEW."shopId" OR (conv."shopId" IS NOT NULL AND conv."shopId" IS DISTINCT FROM owner_shop)
    OR NEW."initialInboundVersion">conv."inboundVersion" THEN
    RAISE EXCEPTION 'ARCH020 grant owner or inbound version mismatch' USING ERRCODE='23514'; END IF;
  IF commerce.arch020_strings(NEW."selectedCapabilityKeys",1,32) IS DISTINCT FROM true
    OR NOT (NEW."selectedCapabilityKeys" ? 'conversation_core') OR commerce.arch020_grant_tools(NEW."grantedTools") IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ARCH020 grant shape' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW."selectedCapabilityKeys") k WHERE NOT EXISTS(
    SELECT 1 FROM commerce."CommerceReleaseCapability" m JOIN commerce."CommerceCapability" c ON c.id=m."capabilityId"
    WHERE m."releaseId"=NEW."releaseId" AND c.key=k)) THEN
    RAISE EXCEPTION 'ARCH020 selected key outside release' USING ERRCODE='23514'; END IF;
  -- Canonical complete union: immutable revisions and names, original selected
  -- provenance, no omissions or additional authority. Entry ordering is irrelevant.
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'toolId' COLLATE "C"),'[]'::jsonb) INTO expected FROM (
    SELECT jsonb_build_object('toolId',t.id,'toolRevisionId',tr.id,'toolName',t.name,'definitionVersion',tr."definitionVersion",
      'capabilityKeys',jsonb_agg(c.key ORDER BY c.key COLLATE "C")) entry
    FROM commerce."CommerceReleaseCapability" m JOIN commerce."CommerceCapability" c ON c.id=m."capabilityId"
    JOIN commerce."CommerceCapabilityRevision" r ON r.id=m."capabilityRevisionId"
    CROSS JOIN LATERAL jsonb_array_elements(r."toolBindings") b
    JOIN commerce."CommerceToolRevision" tr ON tr.id=b->>'toolRevisionId' AND tr."toolId"=b->>'toolId' AND tr.status='PUBLISHED'
    JOIN commerce."CommerceTool" t ON t.id=tr."toolId"
    WHERE m."releaseId"=NEW."releaseId" AND NEW."selectedCapabilityKeys" ? c.key
    GROUP BY t.id,tr.id) entries;
  SELECT COALESCE(jsonb_agg(e ORDER BY e->>'toolId' COLLATE "C"),'[]'::jsonb) INTO actual FROM jsonb_array_elements(NEW."grantedTools") e;
  IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'ARCH020 grant must equal complete tool union' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_grant_insert BEFORE INSERT ON commerce."CommerceConversationGrant" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_grant();
CREATE FUNCTION commerce.arch020_parent_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_TABLE_NAME='Conversation' THEN
    IF EXISTS(SELECT 1 FROM commerce."CommerceConversationGrant" g WHERE g."conversationId"=OLD.id
      AND (NEW."checkoutRecoveryId" IS DISTINCT FROM OLD."checkoutRecoveryId" OR
        (NEW."shopId" IS NOT NULL AND NEW."shopId" IS DISTINCT FROM g."shopId"))) THEN
      RAISE EXCEPTION 'ARCH020 retained grant recovery link/owner immutable' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW."shopId" IS DISTINCT FROM OLD."shopId" AND EXISTS(
      SELECT 1 FROM whatsapp."Conversation" c JOIN commerce."CommerceConversationGrant" g ON g."conversationId"=c.id
      WHERE c."checkoutRecoveryId"=OLD.id AND g."shopId" IS DISTINCT FROM NEW."shopId") THEN
      RAISE EXCEPTION 'ARCH020 retained grant recovery owner immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arch020_conversation_owner BEFORE UPDATE OF "checkoutRecoveryId","shopId" ON whatsapp."Conversation" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_parent_owner();
CREATE TRIGGER arch020_recovery_owner BEFORE UPDATE OF "shopId" ON commerce."CheckoutRecovery" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_parent_owner();
