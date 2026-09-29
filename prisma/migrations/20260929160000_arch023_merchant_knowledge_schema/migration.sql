-- ARCH-023 merchant knowledge, store profile, and generic plan-feature configuration.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "commerce"."MerchantKnowledgeInputKind" AS ENUM ('REMOTE_URL', 'UPLOAD');
CREATE TYPE "commerce"."MerchantKnowledgeRevisionReason" AS ENUM ('CREATE', 'URL_CHANGE', 'FILE_REPLACE', 'REFRESH', 'REPROCESS', 'ENTITLEMENT_CHANGE');
CREATE TYPE "commerce"."MerchantKnowledgeRevisionStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACTIVE', 'FAILED', 'SUPERSEDED');
CREATE TYPE "commerce"."MerchantKnowledgeUploadedAssetStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'FAILED', 'DELETED');

ALTER TABLE "billing"."BillingPlanFeature"
  ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "billing"."MerchantPricingPlanFeature"
  ADD COLUMN "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "commerce"."CommercePromptTemplateCategory"
  ADD COLUMN "defaultTemplateId" TEXT;
ALTER TABLE "commerce"."CommerceAgentPromptRevision"
  ADD COLUMN "sourceTemplateEditVersion" INTEGER;
CREATE UNIQUE INDEX "CommercePromptTemplateCategory_defaultTemplateId_key"
  ON "commerce"."CommercePromptTemplateCategory"("defaultTemplateId");
ALTER TABLE "commerce"."CommercePromptTemplateCategory"
  ADD CONSTRAINT "CommercePromptTemplateCategory_defaultTemplate_fkey"
  FOREIGN KEY ("defaultTemplateId") REFERENCES "commerce"."CommercePromptTemplate"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTaxonomyMapping" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "shopifyTaxonomyCategoryId" VARCHAR(255) NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_weight_positive" CHECK ("weight" > 0),
  CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_category_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceStoreCategoryTaxonomyMapping_shopifyTaxonomyCategoryId_key"
  ON "commerce"."CommerceStoreCategoryTaxonomyMapping"("shopifyTaxonomyCategoryId");
CREATE INDEX "CommerceStoreCategoryTaxonomyMapping_categoryId_idx"
  ON "commerce"."CommerceStoreCategoryTaxonomyMapping"("categoryId");

CREATE TABLE "commerce"."CommerceShopProfile" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "activeCategoryId" TEXT,
  "activeCategoryActivatedAt" TIMESTAMPTZ(3),
  "pendingCategoryId" TEXT,
  "pendingPromptRevisionId" TEXT,
  "pendingSelectionGeneration" INTEGER NOT NULL DEFAULT 0,
  "pendingSelectedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceShopProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceShopProfile_pending_generation_nonnegative"
    CHECK ("pendingSelectionGeneration" >= 0),
  CONSTRAINT "CommerceShopProfile_pending_tuple_check"
    CHECK (("pendingCategoryId" IS NULL AND "pendingPromptRevisionId" IS NULL AND "pendingSelectedAt" IS NULL)
        OR ("pendingCategoryId" IS NOT NULL AND "pendingPromptRevisionId" IS NOT NULL AND "pendingSelectedAt" IS NOT NULL)),
  CONSTRAINT "CommerceShopProfile_active_category_timestamp_check"
    CHECK (("activeCategoryId" IS NULL AND "activeCategoryActivatedAt" IS NULL)
        OR ("activeCategoryId" IS NOT NULL AND "activeCategoryActivatedAt" IS NOT NULL)),
  CONSTRAINT "CommerceShopProfile_shop_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "CommerceShopProfile_active_category_fkey"
    FOREIGN KEY ("activeCategoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceShopProfile_pending_category_fkey"
    FOREIGN KEY ("pendingCategoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceShopProfile_pending_prompt_revision_fkey"
    FOREIGN KEY ("pendingPromptRevisionId") REFERENCES "commerce"."CommerceAgentPromptRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceShopProfile_shopId_key" ON "commerce"."CommerceShopProfile"("shopId");
CREATE INDEX "CommerceShopProfile_activeCategoryId_idx" ON "commerce"."CommerceShopProfile"("activeCategoryId");
CREATE INDEX "CommerceShopProfile_pendingCategoryId_idx" ON "commerce"."CommerceShopProfile"("pendingCategoryId");
CREATE INDEX "CommerceShopProfile_pendingPromptRevisionId_idx" ON "commerce"."CommerceShopProfile"("pendingPromptRevisionId");

CREATE TABLE "commerce"."MerchantKnowledgePurpose" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgePurpose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MerchantKnowledgePurpose_key_key" ON "commerce"."MerchantKnowledgePurpose"("key");
CREATE INDEX "MerchantKnowledgePurpose_active_displayOrder_key_idx"
  ON "commerce"."MerchantKnowledgePurpose"("active", "displayOrder", "key");

CREATE TABLE "commerce"."MerchantKnowledgeDataFormat" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(32) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "inputKind" "commerce"."MerchantKnowledgeInputKind" NOT NULL,
  "canonicalExtension" VARCHAR(16),
  "acceptedContentTypes" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgeDataFormat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MerchantKnowledgeDataFormat_key_key" ON "commerce"."MerchantKnowledgeDataFormat"("key");
CREATE INDEX "MerchantKnowledgeDataFormat_active_displayOrder_key_idx"
  ON "commerce"."MerchantKnowledgeDataFormat"("active", "displayOrder", "key");

CREATE TABLE "commerce"."MerchantKnowledgePurposeDataFormat" (
  "purposeId" TEXT NOT NULL,
  "dataFormatId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgePurposeDataFormat_pkey" PRIMARY KEY ("purposeId", "dataFormatId"),
  CONSTRAINT "MerchantKnowledgePurposeDataFormat_purpose_fkey"
    FOREIGN KEY ("purposeId") REFERENCES "commerce"."MerchantKnowledgePurpose"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgePurposeDataFormat_dataFormat_fkey"
    FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "MerchantKnowledgePurposeDataFormat_dataFormatId_purposeId_idx"
  ON "commerce"."MerchantKnowledgePurposeDataFormat"("dataFormatId", "purposeId");

CREATE TABLE "commerce"."MerchantKnowledgeUploadedAsset" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "dataFormatId" TEXT NOT NULL,
  "status" "commerce"."MerchantKnowledgeUploadedAssetStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "objectKey" TEXT NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(128),
  "sizeBytes" BIGINT,
  "sha256" VARCHAR(64),
  "uploadExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "availableAt" TIMESTAMPTZ(3),
  "failureCode" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgeUploadedAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantKnowledgeUploadedAsset_available_fields_check"
    CHECK ("status" <> 'AVAILABLE' OR
      ("contentType" IS NOT NULL AND btrim("contentType") <> '' AND "sizeBytes" IS NOT NULL AND "sizeBytes" > 0
       AND "sha256" IS NOT NULL AND "sha256" ~ '^[0-9a-f]{64}$' AND "availableAt" IS NOT NULL)),
  CONSTRAINT "MerchantKnowledgeUploadedAsset_shop_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeUploadedAsset_dataFormat_fkey"
    FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "MerchantKnowledgeUploadedAsset_objectKey_key"
  ON "commerce"."MerchantKnowledgeUploadedAsset"("objectKey");
CREATE INDEX "MerchantKnowledgeUploadedAsset_shopId_status_createdAt_idx"
  ON "commerce"."MerchantKnowledgeUploadedAsset"("shopId", "status", "createdAt");
CREATE INDEX "MerchantKnowledgeUploadedAsset_dataFormatId_status_idx"
  ON "commerce"."MerchantKnowledgeUploadedAsset"("dataFormatId", "status");

CREATE TABLE "commerce"."MerchantKnowledgeSource" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "purposeId" TEXT NOT NULL,
  "dataFormatId" TEXT NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "languageTag" VARCHAR(16) NOT NULL,
  "position" INTEGER NOT NULL,
  "currentGeneration" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgeSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantKnowledgeSource_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "MerchantKnowledgeSource_generation_nonnegative" CHECK ("currentGeneration" >= 0),
  CONSTRAINT "MerchantKnowledgeSource_shop_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeSource_purpose_fkey"
    FOREIGN KEY ("purposeId") REFERENCES "commerce"."MerchantKnowledgePurpose"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeSource_dataFormat_fkey"
    FOREIGN KEY ("dataFormatId") REFERENCES "commerce"."MerchantKnowledgeDataFormat"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeSource_purposeDataFormat_fkey"
    FOREIGN KEY ("purposeId", "dataFormatId") REFERENCES "commerce"."MerchantKnowledgePurposeDataFormat"("purposeId", "dataFormatId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeSource_shopId_position_key" UNIQUE ("shopId", "position")
);
CREATE INDEX "MerchantKnowledgeSource_shopId_purposeId_position_idx"
  ON "commerce"."MerchantKnowledgeSource"("shopId", "purposeId", "position");
CREATE INDEX "MerchantKnowledgeSource_shopId_dataFormatId_position_idx"
  ON "commerce"."MerchantKnowledgeSource"("shopId", "dataFormatId", "position");
CREATE INDEX "MerchantKnowledgeSource_shopId_languageTag_idx"
  ON "commerce"."MerchantKnowledgeSource"("shopId", "languageTag");

CREATE TABLE "commerce"."MerchantKnowledgeSourceRevision" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "uploadedAssetId" TEXT,
  "generation" INTEGER NOT NULL,
  "reason" "commerce"."MerchantKnowledgeRevisionReason" NOT NULL,
  "requestedUrl" VARCHAR(2048),
  "resolvedUrl" VARCHAR(2048),
  "status" "commerce"."MerchantKnowledgeRevisionStatus" NOT NULL DEFAULT 'PENDING',
  "contentType" VARCHAR(128),
  "httpStatus" INTEGER,
  "normalizedContent" TEXT,
  "contentUnits" INTEGER,
  "contentHash" VARCHAR(64),
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "failureCode" VARCHAR(128),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMPTZ(3),
  "fetchedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgeSourceRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantKnowledgeSourceRevision_locator_check"
    CHECK (("requestedUrl" IS NOT NULL) <> ("uploadedAssetId" IS NOT NULL)),
  CONSTRAINT "MerchantKnowledgeSourceRevision_resolved_url_check"
    CHECK ("resolvedUrl" IS NULL OR "requestedUrl" IS NOT NULL),
  CONSTRAINT "MerchantKnowledgeSourceRevision_generation_positive" CHECK ("generation" > 0),
  CONSTRAINT "MerchantKnowledgeSourceRevision_active_content_check"
    CHECK ("status" NOT IN ('ACTIVE', 'SUPERSEDED') OR
      ("contentUnits" IS NOT NULL AND "contentUnits" >= 0 AND "contentHash" IS NOT NULL AND "contentHash" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "MerchantKnowledgeSourceRevision_sourceId_generation_key" UNIQUE ("sourceId", "generation"),
  CONSTRAINT "MerchantKnowledgeSourceRevision_source_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "commerce"."MerchantKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeSourceRevision_uploadedAsset_fkey"
    FOREIGN KEY ("uploadedAssetId") REFERENCES "commerce"."MerchantKnowledgeUploadedAsset"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "MerchantKnowledgeSourceRevision_sourceId_status_generation_idx"
  ON "commerce"."MerchantKnowledgeSourceRevision"("sourceId", "status", "generation");
CREATE INDEX "MerchantKnowledgeSourceRevision_uploadedAssetId_idx"
  ON "commerce"."MerchantKnowledgeSourceRevision"("uploadedAssetId");
CREATE INDEX "MerchantKnowledgeSourceRevision_status_requestedAt_idx"
  ON "commerce"."MerchantKnowledgeSourceRevision"("status", "requestedAt");
CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_one_active_per_source"
  ON commerce."MerchantKnowledgeSourceRevision" ("sourceId") WHERE "status" = 'ACTIVE';

CREATE TABLE "commerce"."MerchantKnowledgeChunk" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentUnits" INTEGER NOT NULL,
  "contentHash" VARCHAR(64) NOT NULL,
  "embedding" vector NOT NULL,
  "embeddingProvider" VARCHAR(64) NOT NULL,
  "embeddingModel" VARCHAR(255) NOT NULL,
  "embeddingDimensions" INTEGER NOT NULL,
  "embeddingIndexVersion" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantKnowledgeChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantKnowledgeChunk_ordinal_nonnegative" CHECK ("ordinal" >= 0),
  CONSTRAINT "MerchantKnowledgeChunk_content_units_positive" CHECK ("contentUnits" > 0),
  CONSTRAINT "MerchantKnowledgeChunk_embedding_dimensions_positive" CHECK ("embeddingDimensions" > 0),
  CONSTRAINT "MerchantKnowledgeChunk_embedding_dimensions_match" CHECK (vector_dims("embedding") = "embeddingDimensions"),
  CONSTRAINT "MerchantKnowledgeChunk_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "MerchantKnowledgeChunk_revision_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "commerce"."MerchantKnowledgeSourceRevision"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "MerchantKnowledgeChunk_revisionId_ordinal_key" UNIQUE ("revisionId", "ordinal")
);
CREATE INDEX "MerchantKnowledgeChunk_revisionId_ordinal_idx"
  ON "commerce"."MerchantKnowledgeChunk"("revisionId", "ordinal");
CREATE INDEX "MerchantKnowledgeChunk_embeddingIndexVersion_embeddingDimensions_idx"
  ON "commerce"."MerchantKnowledgeChunk"("embeddingIndexVersion", "embeddingDimensions");

INSERT INTO "commerce"."MerchantKnowledgePurpose" ("id", "key", "displayName", "active", "displayOrder") VALUES
  ('mk-purpose-company-information', 'COMPANY_INFORMATION', 'Company information', true, 10),
  ('mk-purpose-customer-support', 'CUSTOMER_SUPPORT', 'Customer support', true, 20),
  ('mk-purpose-policies', 'POLICIES', 'Policies', true, 30),
  ('mk-purpose-faq', 'FAQ', 'FAQ', true, 40),
  ('mk-purpose-product-information', 'PRODUCT_INFORMATION', 'Product information', true, 50),
  ('mk-purpose-shipping-and-delivery', 'SHIPPING_AND_DELIVERY', 'Shipping and delivery', true, 60),
  ('mk-purpose-pricing', 'PRICING', 'Pricing', true, 70)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "commerce"."MerchantKnowledgeDataFormat" ("id", "key", "displayName", "inputKind", "canonicalExtension", "acceptedContentTypes", "active", "displayOrder") VALUES
  ('mk-format-web-page', 'WEB_PAGE', 'Web page', 'REMOTE_URL', NULL, '["text/html","text/plain"]'::jsonb, true, 10),
  ('mk-format-csv', 'CSV', 'CSV spreadsheet', 'UPLOAD', '.csv', '["text/csv","application/csv"]'::jsonb, true, 20),
  ('mk-format-xlsx', 'XLSX', 'Excel spreadsheet (.xlsx)', 'UPLOAD', '.xlsx', '["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]'::jsonb, true, 30)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "commerce"."MerchantKnowledgePurposeDataFormat" ("purposeId", "dataFormatId")
SELECT purpose.id, data_format.id
FROM (VALUES
  ('COMPANY_INFORMATION', 'WEB_PAGE'),
  ('CUSTOMER_SUPPORT', 'WEB_PAGE'),
  ('POLICIES', 'WEB_PAGE'),
  ('FAQ', 'WEB_PAGE'),
  ('PRODUCT_INFORMATION', 'WEB_PAGE'),
  ('PRODUCT_INFORMATION', 'CSV'),
  ('PRODUCT_INFORMATION', 'XLSX'),
  ('SHIPPING_AND_DELIVERY', 'WEB_PAGE'),
  ('PRICING', 'WEB_PAGE'),
  ('PRICING', 'CSV'),
  ('PRICING', 'XLSX')
) AS supported(purpose_key, data_format_key)
JOIN "commerce"."MerchantKnowledgePurpose" AS purpose ON purpose."key" = supported.purpose_key
JOIN "commerce"."MerchantKnowledgeDataFormat" AS data_format ON data_format."key" = supported.data_format_key
ON CONFLICT ("purposeId", "dataFormatId") DO NOTHING;