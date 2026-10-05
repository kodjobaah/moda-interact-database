-- ARCH-029 DATABASE-001: database-backed Store Category localisation and mapping conditions.
--
-- Store Categories remain authored canonically in English. Merchant-facing category
-- and mapping labels are published into dedicated locale tables. Taxonomy mappings
-- additionally gain a stable condition key for the conditional prompt template.
-- Existing rows remain valid with NULL condition/display metadata until Admin makes
-- them enablement-ready. Existing category enabled values are not changed; only the
-- default for future inserts becomes false.

ALTER TABLE "commerce"."CommercePromptTemplateCategory"
  ALTER COLUMN "enabled" SET DEFAULT false;

ALTER TABLE "commerce"."CommerceStoreCategoryTaxonomyMapping"
  ADD COLUMN "conditionKey" VARCHAR(128),
  ADD COLUMN "displayName" VARCHAR(255),
  ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 1;

-- Preserve useful canonical English presentation where the existing reference
-- taxonomy metadata is available. conditionKey is intentionally not fabricated.
UPDATE "commerce"."CommerceStoreCategoryTaxonomyMapping"
SET "displayName" = "taxonomyCategoryName"
WHERE "displayName" IS NULL
  AND "taxonomyCategoryName" IS NOT NULL
  AND btrim("taxonomyCategoryName") <> '';

ALTER TABLE "commerce"."CommerceStoreCategoryTaxonomyMapping"
  ADD CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_condition_key_check"
    CHECK (
      "conditionKey" IS NULL
      OR "conditionKey" ~ '^[a-z][a-z0-9_]{0,127}$'
    ),
  ADD CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_display_name_check"
    CHECK (
      "displayName" IS NULL
      OR btrim("displayName") <> ''
    ),
  ADD CONSTRAINT "CommerceStoreCategoryTaxonomyMapping_edit_version_check"
    CHECK ("editVersion" > 0);

CREATE UNIQUE INDEX "CommerceStoreCategoryTaxonomyMapping_categoryId_conditionKey_key"
  ON "commerce"."CommerceStoreCategoryTaxonomyMapping"("categoryId", "conditionKey");

-- A mapping condition key becomes part of the authored prompt-template contract.
-- Allow legacy NULL -> assigned-key population once, but never silently rename or
-- clear a key that an existing template may reference.
CREATE OR REPLACE FUNCTION commerce.arch029_store_category_mapping_condition_key_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."conditionKey" IS NOT NULL
     AND NEW."conditionKey" IS DISTINCT FROM OLD."conditionKey" THEN
    RAISE EXCEPTION 'Store Category mapping conditionKey is immutable once assigned';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER arch029_store_category_mapping_condition_key_guard
BEFORE UPDATE OF "conditionKey"
ON commerce."CommerceStoreCategoryTaxonomyMapping"
FOR EACH ROW
EXECUTE FUNCTION commerce.arch029_store_category_mapping_condition_key_guard();

CREATE TABLE "commerce"."CommercePromptTemplateCategoryTranslation" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "displayName" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommercePromptTemplateCategoryTranslation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercePromptTemplateCategoryTranslation_locale_check"
    CHECK (btrim("locale") <> ''),
  CONSTRAINT "CommercePromptTemplateCategoryTranslation_display_name_check"
    CHECK (btrim("displayName") <> ''),
  CONSTRAINT "CommercePromptTemplateCategoryTranslation_description_check"
    CHECK (btrim("description") <> '' AND length("description") <= 4096)
);

CREATE UNIQUE INDEX "CommercePromptTemplateCategoryTranslation_categoryId_locale_key"
  ON "commerce"."CommercePromptTemplateCategoryTranslation"("categoryId", "locale");

CREATE INDEX "CommercePromptTemplateCategoryTranslation_locale_categoryId_idx"
  ON "commerce"."CommercePromptTemplateCategoryTranslation"("locale", "categoryId");

ALTER TABLE "commerce"."CommercePromptTemplateCategoryTranslation"
  ADD CONSTRAINT "CommercePromptTemplateCategoryTranslation_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "commerce"."CommercePromptTemplateCategory"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE TABLE "commerce"."CommerceStoreCategoryTaxonomyMappingTranslation" (
  "id" TEXT NOT NULL,
  "mappingId" TEXT NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "displayName" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommerceStoreCategoryTaxonomyMappingTranslation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceStoreCategoryTaxonomyMappingTranslation_locale_check"
    CHECK (btrim("locale") <> ''),
  CONSTRAINT "CommerceStoreCategoryTaxonomyMappingTranslation_display_name_check"
    CHECK (btrim("displayName") <> '')
);

CREATE UNIQUE INDEX "CommerceStoreCategoryTaxonomyMappingTranslation_mappingId_locale_key"
  ON "commerce"."CommerceStoreCategoryTaxonomyMappingTranslation"("mappingId", "locale");

CREATE INDEX "CommerceStoreCategoryTaxonomyMappingTranslation_locale_mappingId_idx"
  ON "commerce"."CommerceStoreCategoryTaxonomyMappingTranslation"("locale", "mappingId");

ALTER TABLE "commerce"."CommerceStoreCategoryTaxonomyMappingTranslation"
  ADD CONSTRAINT "CommerceStoreCategoryTaxonomyMappingTranslation_mappingId_fkey"
  FOREIGN KEY ("mappingId") REFERENCES "commerce"."CommerceStoreCategoryTaxonomyMapping"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
