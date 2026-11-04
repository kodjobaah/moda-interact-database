BEGIN;

-- Bound inventory-lock waits without replacing the server's original diagnostic.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    OR to_regtype('vector') IS NULL
    OR to_regprocedure('vector_dims(vector)') IS NULL THEN
    RAISE EXCEPTION 'REFERENCE_TAXONOMY_VECTOR_UNAVAILABLE';
  END IF;
END;
$$;

LOCK TABLE commerce."CommerceCapability", commerce."CommerceTool" IN SHARE MODE;

DO $$
DECLARE
  feature_id text;
  conflict record;
BEGIN
  SELECT id INTO feature_id FROM billing."Feature"
  WHERE key = 'product_search' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_DISCOVERY_FEATURE_MISSING';
  END IF;

  SELECT capability.id, capability.key, capability."toolId", tool.name
  INTO conflict
  FROM commerce."CommerceCapability" capability
  LEFT JOIN commerce."CommerceTool" tool ON tool.id = capability."toolId"
  WHERE capability."featureId" = feature_id AND (
    capability.key NOT IN (
      'commerce_resolve_product_categories', 'commerce_search_products', 'commerce_get_product'
    )
    OR tool.name IS DISTINCT FROM capability.key
    OR NOT EXISTS (
      SELECT 1 FROM commerce."CommerceAuditEvent" audit
      CROSS JOIN unnest(enum_range(NULL::commerce."CommerceEnvironment")) environment(value)
      WHERE audit.action = 'CREATE_TOOL' AND audit."toolId" = tool.id
        AND left(audit.id, length('system-commerce-tools:v1:' || environment.value::text || ':' || tool.name || ':'))
          = 'system-commerce-tools:v1:' || environment.value::text || ':' || tool.name || ':'
    )
    OR NOT EXISTS (
      SELECT 1 FROM commerce."CommerceAuditEvent" audit
      CROSS JOIN unnest(enum_range(NULL::commerce."CommerceEnvironment")) environment(value)
      WHERE audit.action = 'CREATE_CAPABILITY' AND audit."capabilityId" = capability.id
        AND left(audit.id, length('system-commerce-tools:v1:' || environment.value::text || ':' || capability.key || ':'))
          = 'system-commerce-tools:v1:' || environment.value::text || ':' || capability.key || ':'
    )
  )
  ORDER BY capability.id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PRODUCT_DISCOVERY_MEMBERSHIP_CONFLICT'
      USING DETAIL = format('capability=%s key=%s tool=%s name=%s; reconcile system ownership before retry',
        left(conflict.id,128), left(conflict.key,128),
        left(conflict."toolId",128), left(conflict.name,128));
  END IF;
END;
$$;

CREATE TABLE commerce."ReferenceTaxonomyGeneration" (
  "id" TEXT NOT NULL,
  "environment" commerce."CommerceEnvironment" NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "taxonomyVersion" VARCHAR(64) NOT NULL,
  "languageTag" VARCHAR(35) NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceSha256" VARCHAR(64) NOT NULL,
  "embeddingProvider" VARCHAR(64) NOT NULL,
  "embeddingModel" VARCHAR(255) NOT NULL,
  "embeddingDimensions" INTEGER NOT NULL,
  "embeddingIndexVersion" VARCHAR(64) NOT NULL,
  "embeddingTextVersion" VARCHAR(64) NOT NULL,
  "importFingerprint" VARCHAR(64) NOT NULL,
  "categoryCount" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ReferenceTaxonomyGeneration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReferenceTaxonomyGeneration_nonblank_check" CHECK (
    btrim("id") <> '' AND btrim("source") <> '' AND btrim("taxonomyVersion") <> ''
    AND btrim("languageTag") <> '' AND btrim("sourceUrl") <> ''
    AND btrim("embeddingProvider") <> '' AND btrim("embeddingModel") <> ''
    AND btrim("embeddingIndexVersion") <> '' AND btrim("embeddingTextVersion") <> ''
  ),
  CONSTRAINT "ReferenceTaxonomyGeneration_hashes_check" CHECK (
    "sourceSha256" ~ '^[0-9a-f]{64}$' AND "importFingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ReferenceTaxonomyGeneration_positive_check" CHECK (
    "embeddingDimensions" > 0 AND "categoryCount" > 0
  ),
  CONSTRAINT "ReferenceTaxonomyGeneration_activation_check" CHECK (
    NOT "isActive" OR "activatedAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "ReferenceTaxonomyGeneration_id_dimensions_key"
  ON commerce."ReferenceTaxonomyGeneration" ("id", "embeddingDimensions");
CREATE UNIQUE INDEX "ReferenceTaxonomyGeneration_import_identity_key"
  ON commerce."ReferenceTaxonomyGeneration" ("environment", "source", "languageTag", "importFingerprint");
CREATE UNIQUE INDEX "ReferenceTaxonomyGeneration_active_corpus_key"
  ON commerce."ReferenceTaxonomyGeneration" ("environment", "source", "languageTag")
  WHERE "isActive" = true;

CREATE TABLE commerce."ReferenceTaxonomyCategory" (
  "generationId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "parentId" TEXT,
  "level" INTEGER NOT NULL,
  "ancestorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "embedding" vector NOT NULL,
  "embeddingDimensions" INTEGER NOT NULL,
  CONSTRAINT "ReferenceTaxonomyCategory_pkey" PRIMARY KEY ("generationId", "categoryId"),
  CONSTRAINT "ReferenceTaxonomyCategory_generation_dimensions_fkey"
    FOREIGN KEY ("generationId", "embeddingDimensions")
    REFERENCES commerce."ReferenceTaxonomyGeneration" ("id", "embeddingDimensions")
    ON DELETE CASCADE ON UPDATE RESTRICT NOT DEFERRABLE,
  CONSTRAINT "ReferenceTaxonomyCategory_parent_fkey"
    FOREIGN KEY ("generationId", "parentId")
    REFERENCES commerce."ReferenceTaxonomyCategory" ("generationId", "categoryId")
    ON DELETE NO ACTION ON UPDATE RESTRICT NOT DEFERRABLE,
  CONSTRAINT "ReferenceTaxonomyCategory_identity_check" CHECK (
    btrim("generationId") <> '' AND btrim("categoryId") <> ''
    AND btrim("name") <> '' AND btrim("fullName") <> ''
    AND ("parentId" IS NULL OR (btrim("parentId") <> '' AND "parentId" <> "categoryId"))
  ),
  CONSTRAINT "ReferenceTaxonomyCategory_level_check" CHECK (
    "level" >= 0 AND cardinality("ancestorIds") = "level"
    AND array_position("ancestorIds", NULL) IS NULL
    AND NOT ("categoryId" = ANY("ancestorIds"))
    AND (("level" = 0 AND "parentId" IS NULL)
      OR ("level" > 0 AND "parentId" IS NOT NULL
        AND "parentId" = "ancestorIds"[array_upper("ancestorIds", 1)]))
  ),
  CONSTRAINT "ReferenceTaxonomyCategory_embedding_check" CHECK (
    "embeddingDimensions" > 0 AND vector_dims("embedding") = "embeddingDimensions"
  )
);
CREATE INDEX "ReferenceTaxonomyCategory_generation_parent_idx"
  ON commerce."ReferenceTaxonomyCategory" ("generationId", "parentId");

UPDATE billing."Feature"
SET "activationMode" = 'ALWAYS_ENABLED', "systemRequired" = true,
    "active" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE key = 'product_search';

INSERT INTO billing."MerchantPricingPlanFeature" ("merchantPricingPlanId", "featureId")
SELECT plan.id, feature.id FROM billing."MerchantPricingPlan" plan
CROSS JOIN billing."Feature" feature WHERE feature.key = 'product_search'
ON CONFLICT ("merchantPricingPlanId", "featureId") DO NOTHING;

INSERT INTO billing."BillingPlanFeature" ("id", "planId", "featureId", "enabled")
SELECT 'required-product-search:' || plan.id, plan.id, feature.id, true
FROM billing."BillingPlan" plan
CROSS JOIN billing."Feature" feature WHERE feature.key = 'product_search'
ON CONFLICT ("planId", "featureId") DO UPDATE SET "enabled" = true;

DELETE FROM billing."ShopFeaturePreference"
WHERE "featureId" = (SELECT id FROM billing."Feature" WHERE key = 'product_search');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing."Feature" WHERE key = 'product_search'
      AND "activationMode" = 'ALWAYS_ENABLED' AND "systemRequired" AND "active"
  ) OR EXISTS (
    SELECT 1 FROM billing."MerchantPricingPlan" plan WHERE NOT EXISTS (
      SELECT 1 FROM billing."MerchantPricingPlanFeature" mapping
      JOIN billing."Feature" feature ON feature.id = mapping."featureId"
      WHERE mapping."merchantPricingPlanId" = plan.id AND feature.key = 'product_search'
    )
  ) OR EXISTS (
    SELECT 1 FROM billing."BillingPlan" plan WHERE NOT EXISTS (
      SELECT 1 FROM billing."BillingPlanFeature" mapping
      JOIN billing."Feature" feature ON feature.id = mapping."featureId"
      WHERE mapping."planId" = plan.id AND feature.key = 'product_search' AND mapping.enabled
    )
  ) OR EXISTS (
    SELECT 1 FROM billing."ShopFeaturePreference" preference
    JOIN billing."Feature" feature ON feature.id = preference."featureId"
    WHERE feature.key = 'product_search'
  ) THEN
    RAISE EXCEPTION 'PRODUCT_DISCOVERY_POSTCONDITION_FAILED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION commerce.arch020_grant_tools(v jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  item jsonb;
  ids text[] := '{}';
  names text[] := '{}';
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'array'
    OR octet_length(v::text) > 65536 THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(v) > 32 THEN RETURN false; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(v) AS entries(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF item ? 'kind' THEN
      IF commerce.arch020_object(item,
          ARRAY['kind','toolName','definitionVersion','contractHash']) IS DISTINCT FROM true
        OR item->>'kind' IS DISTINCT FROM 'BUILT_IN'
        OR commerce.arch020_string(item->'toolName',128) IS DISTINCT FROM true
        OR item->>'toolName' NOT IN
          ('commerce_get_discount_options','commerce_get_discount_details')
        OR item->>'definitionVersion' IS DISTINCT FROM '1.0.0'
        OR jsonb_typeof(item->'contractHash') IS DISTINCT FROM 'string'
        OR item->>'contractHash' !~ '^[0-9a-f]{64}$' THEN
        RETURN false;
      END IF;
    ELSE
      IF commerce.arch020_object(item,
          ARRAY['toolId','toolRevisionId','toolName','definitionVersion','capabilityKeys']) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolId',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolRevisionId',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolName',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'definitionVersion',64) IS DISTINCT FROM true
        OR commerce.arch020_strings(item->'capabilityKeys',1,32,true) IS DISTINCT FROM true
        OR item->>'toolId' = ANY(ids) THEN
        RETURN false;
      END IF;
      ids := array_append(ids,item->>'toolId');
    END IF;
    IF item->>'toolName' = ANY(names) THEN RETURN false; END IF;
    names := array_append(names,item->>'toolName');
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION commerce.arch021_conversation_grant_guard()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  conv whatsapp."Conversation"%ROWTYPE;
  owner_shop text;
  expected jsonb;
  actual jsonb;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  SELECT * INTO conv FROM whatsapp."Conversation"
    WHERE id=NEW."conversationId" FOR UPDATE;
  IF NOT FOUND OR conv."checkoutRecoveryId" IS NULL
    OR conv."checkoutRecoveryId" IN ('standalone','product-only','unknown-shop') THEN
    RAISE EXCEPTION 'ARCH021 recovery conversation required' USING ERRCODE='23514';
  END IF;
  SELECT "shopId" INTO owner_shop FROM commerce."CheckoutRecovery"
    WHERE id=conv."checkoutRecoveryId" FOR UPDATE;
  IF NOT FOUND OR owner_shop IS DISTINCT FROM NEW."shopId"
    OR (conv."shopId" IS NOT NULL AND conv."shopId" IS DISTINCT FROM owner_shop)
    OR NEW."initialInboundVersion" > conv."inboundVersion" THEN
    RAISE EXCEPTION 'ARCH021 grant owner or inbound version mismatch' USING ERRCODE='23514';
  END IF;
  IF commerce.arch020_strings(NEW."selectedCapabilityKeys",0,32) IS DISTINCT FROM true
    OR octet_length(NEW."selectedCapabilityKeys"::text) > 8192
    OR commerce.arch020_grant_tools(NEW."grantedTools") IS DISTINCT FROM true THEN
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
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'toolId' COLLATE "C"),'[]'::jsonb)
  INTO expected
  FROM (
    SELECT jsonb_build_object(
      'toolId',tool.id,
      'toolRevisionId',tool_revision.id,
      'toolName',tool.name,
      'definitionVersion',tool_revision."definitionVersion",
      'capabilityKeys',jsonb_agg(capability.key ORDER BY capability.key COLLATE "C")
    ) AS entry
    FROM commerce."CommerceReleaseCapability" member
    JOIN commerce."CommerceCapability" capability ON capability.id=member."capabilityId"
    JOIN commerce."CommerceTool" tool ON tool.id=member."toolId"
    JOIN commerce."CommerceToolRevision" tool_revision
      ON tool_revision.id=member."toolRevisionId" AND tool_revision."toolId"=member."toolId"
      AND tool_revision.status='PUBLISHED'
    WHERE member."releaseId"=NEW."releaseId"
      AND NEW."selectedCapabilityKeys" ? capability.key
    GROUP BY tool.id,tool_revision.id,tool.name,tool_revision."definitionVersion"
  ) entries;
  SELECT COALESCE(jsonb_agg(granted ORDER BY granted->>'toolId' COLLATE "C"),'[]'::jsonb)
  INTO actual
  FROM jsonb_array_elements(NEW."grantedTools") granted
  WHERE NOT (granted ? 'kind');
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'ARCH021 grant must equal direct release Tool authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
COMMIT;
