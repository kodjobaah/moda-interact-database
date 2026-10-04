-- ARCH-023 cross-platform Store Category taxonomy metadata.
--
-- Shopify's Standard Product Taxonomy remains the reference catalogue used by
-- Admin authoring. Persisting the selected human-readable name/full name lets
-- WooCommerce consume the same Moda Store Category mappings without inventing
-- provider-specific taxonomy identifiers.

ALTER TABLE "commerce"."CommercePromptTemplateCategory"
  ADD COLUMN "referenceTaxonomySource" VARCHAR(64),
  ADD COLUMN "referenceTaxonomyVersion" VARCHAR(32),
  ADD COLUMN "referenceTaxonomyCategoryId" VARCHAR(255),
  ADD COLUMN "referenceTaxonomyCategoryName" VARCHAR(255),
  ADD COLUMN "referenceTaxonomyCategoryFullName" TEXT;

CREATE UNIQUE INDEX "CommercePromptTemplateCategory_referenceTaxonomyCategoryId_key"
  ON "commerce"."CommercePromptTemplateCategory"("referenceTaxonomyCategoryId");

ALTER TABLE "commerce"."CommercePromptTemplateCategory"
  ADD CONSTRAINT "CommercePromptTemplateCategory_reference_taxonomy_bundle_check"
  CHECK (
    (
      "referenceTaxonomySource" IS NULL
      AND "referenceTaxonomyVersion" IS NULL
      AND "referenceTaxonomyCategoryId" IS NULL
      AND "referenceTaxonomyCategoryName" IS NULL
      AND "referenceTaxonomyCategoryFullName" IS NULL
    )
    OR
    (
      "referenceTaxonomySource" IS NOT NULL
      AND btrim("referenceTaxonomySource") <> ''
      AND "referenceTaxonomyVersion" IS NOT NULL
      AND btrim("referenceTaxonomyVersion") <> ''
      AND "referenceTaxonomyCategoryId" IS NOT NULL
      AND btrim("referenceTaxonomyCategoryId") <> ''
      AND "referenceTaxonomyCategoryName" IS NOT NULL
      AND btrim("referenceTaxonomyCategoryName") <> ''
      AND "referenceTaxonomyCategoryFullName" IS NOT NULL
      AND btrim("referenceTaxonomyCategoryFullName") <> ''
    )
  );

ALTER TABLE "commerce"."CommerceStoreCategoryTaxonomyMapping"
  ADD COLUMN "taxonomySource" VARCHAR(64),
  ADD COLUMN "taxonomyVersion" VARCHAR(32),
  ADD COLUMN "taxonomyCategoryName" VARCHAR(255),
  ADD COLUMN "taxonomyCategoryFullName" TEXT;

ALTER TABLE "commerce"."CommerceStoreCategoryTaxonomyMapping"
  ADD CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_taxonomy_metadata_bundle_check"
  CHECK (
    (
      "taxonomySource" IS NULL
      AND "taxonomyVersion" IS NULL
      AND "taxonomyCategoryName" IS NULL
      AND "taxonomyCategoryFullName" IS NULL
    )
    OR
    (
      "taxonomySource" IS NOT NULL
      AND btrim("taxonomySource") <> ''
      AND "taxonomyVersion" IS NOT NULL
      AND btrim("taxonomyVersion") <> ''
      AND "taxonomyCategoryName" IS NOT NULL
      AND btrim("taxonomyCategoryName") <> ''
      AND "taxonomyCategoryFullName" IS NOT NULL
      AND btrim("taxonomyCategoryFullName") <> ''
    )
  );
