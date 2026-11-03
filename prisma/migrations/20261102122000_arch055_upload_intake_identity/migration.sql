BEGIN;

ALTER TABLE "commerce"."MerchantKnowledgeUploadedAsset"
  ADD COLUMN "intentPurposeKey" VARCHAR(64);

LOCK TABLE "commerce"."MerchantKnowledgeSourceRevision" IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE duplicate_asset_count BIGINT;
BEGIN
  SELECT count(*) INTO duplicate_asset_count
  FROM (
    SELECT "uploadedAssetId"
    FROM "commerce"."MerchantKnowledgeSourceRevision"
    WHERE "uploadedAssetId" IS NOT NULL
      AND "reason" IN ('CREATE', 'FILE_REPLACE')
    GROUP BY "uploadedAssetId"
    HAVING count(*) > 1
  ) duplicate_intakes;
  IF duplicate_asset_count > 0 THEN
    RAISE EXCEPTION 'ARCH055 original-intake uniqueness blocked: % assets', duplicate_asset_count
      USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_original_intake_asset_key"
  ON "commerce"."MerchantKnowledgeSourceRevision" ("uploadedAssetId")
  WHERE "uploadedAssetId" IS NOT NULL AND "reason" IN ('CREATE', 'FILE_REPLACE');

COMMIT;
