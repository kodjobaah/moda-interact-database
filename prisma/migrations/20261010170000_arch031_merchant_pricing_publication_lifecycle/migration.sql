CREATE TYPE "billing"."MerchantPricingPlanPublicationStatus" AS ENUM (
  'TRANSLATING',
  'TRANSLATION_FAILED',
  'READY'
);

ALTER TABLE "billing"."MerchantPricingPlan"
  ADD COLUMN "publicationStatus" "billing"."MerchantPricingPlanPublicationStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "currentTranslationRunId" TEXT;

CREATE UNIQUE INDEX "MerchantPricingPlan_current_translation_run_key"
  ON "billing"."MerchantPricingPlan"("currentTranslationRunId");

CREATE INDEX "MerchantPricingPlan_publication_active_position_idx"
  ON "billing"."MerchantPricingPlan"("publicationStatus", "isActive", "cataloguePosition");

ALTER TABLE "billing"."MerchantPricingPlan"
  ADD CONSTRAINT "MerchantPricingPlan_current_translation_run_fkey"
    FOREIGN KEY ("currentTranslationRunId")
    REFERENCES "billing"."MerchantPricingTranslationRun"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ck_arch031_merchant_pricing_publication_activation"
    CHECK (NOT "isActive" OR "publicationStatus" = 'READY'),
  ADD CONSTRAINT "ck_arch031_merchant_pricing_publication_run"
    CHECK ("publicationStatus" = 'READY' OR "currentTranslationRunId" IS NOT NULL);

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_plan(plan_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record RECORD;
  usage_record RECORD;
  tier_count integer;
  usage_count integer;
  translation_count integer;
  previous_up_to integer;
  tier_record RECORD;
  current_run_handle text;
BEGIN
  SELECT * INTO plan_record FROM "billing"."MerchantPricingPlan" WHERE "id" = plan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF plan_record."currentTranslationRunId" IS NOT NULL THEN
    SELECT "shopifyPlanHandle" INTO current_run_handle
    FROM "billing"."MerchantPricingTranslationRun"
    WHERE "id" = plan_record."currentTranslationRunId";

    IF NOT FOUND OR current_run_handle IS DISTINCT FROM plan_record."shopifyPlanHandle" THEN
      RAISE EXCEPTION 'ARCH031_MERCHANT_PRICING_INVALID:translation_run_handle';
    END IF;
  END IF;

  SELECT count(*) INTO translation_count
  FROM "billing"."MerchantPricingPlanTranslation"
  WHERE "merchantPricingPlanId" = plan_id;

  IF plan_record."publicationStatus" = 'READY' THEN
    IF translation_count <> 20 THEN
      RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:translations';
    END IF;
  ELSE
    IF translation_count <> 1 OR NOT EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanTranslation"
      WHERE "merchantPricingPlanId" = plan_id AND "locale" = 'en'
    ) OR EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanTranslation"
      WHERE "merchantPricingPlanId" = plan_id AND "locale" <> 'en'
    ) THEN
      RAISE EXCEPTION 'ARCH031_MERCHANT_PRICING_INVALID:draft_translations';
    END IF;
  END IF;

  SELECT count(*) INTO usage_count FROM "billing"."MerchantPricingUsageEvent" WHERE "merchantPricingPlanId" = plan_id;
  IF usage_count > 5 THEN
    RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:usage_count';
  END IF;
  IF usage_count > 0 AND EXISTS (
    SELECT 1 FROM "billing"."MerchantPricingUsageEvent" WHERE "merchantPricingPlanId" = plan_id
    AND "position" <> (SELECT count(*) FROM "billing"."MerchantPricingUsageEvent" e2 WHERE e2."merchantPricingPlanId" = plan_id AND e2."position" <= "MerchantPricingUsageEvent"."position") - 1
  ) THEN
    RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:usage_positions';
  END IF;

  FOR usage_record IN SELECT * FROM "billing"."MerchantPricingUsageEvent" WHERE "merchantPricingPlanId" = plan_id ORDER BY "position" LOOP
    IF usage_record."currency" <> plan_record."currency" THEN
      RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:usage_currency';
    END IF;
    SELECT count(*) INTO tier_count FROM "billing"."MerchantPricingUsageTier" WHERE "merchantPricingUsageEventId" = usage_record."id";
    IF usage_record."pricingMode" = 'FIXED' THEN
      IF usage_record."fixedUnitAmountMinor" IS NULL OR tier_count <> 0 THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:fixed_shape';
      END IF;
      IF usage_record."fixedUnitAmountMinor" = 0 AND usage_record."maximumUnitsPerBillingPeriod" IS NULL THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:fixed_zero_cost';
      END IF;
    ELSE
      IF usage_record."fixedUnitAmountMinor" IS NOT NULL OR tier_count < 1 OR tier_count > 6 THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:tier_shape';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "billing"."MerchantPricingUsageTier" t
        WHERE t."merchantPricingUsageEventId" = usage_record."id"
        AND t."position" <> (SELECT count(*) FROM "billing"."MerchantPricingUsageTier" t2 WHERE t2."merchantPricingUsageEventId" = usage_record."id" AND t2."position" <= t."position") - 1
      ) THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:tier_positions';
      END IF;
      SELECT "upTo" INTO previous_up_to FROM "billing"."MerchantPricingUsageTier" WHERE "merchantPricingUsageEventId" = usage_record."id" ORDER BY "position" DESC LIMIT 1;
      IF previous_up_to IS NOT NULL THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:final_tier_bound';
      END IF;
      previous_up_to := NULL;
      FOR tier_record IN SELECT * FROM "billing"."MerchantPricingUsageTier" WHERE "merchantPricingUsageEventId" = usage_record."id" ORDER BY "position" LOOP
        IF tier_record."position" < tier_count - 1 THEN
          IF tier_record."upTo" IS NULL OR (previous_up_to IS NOT NULL AND tier_record."upTo" <= previous_up_to) THEN
            RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:tier_bounds';
          END IF;
          previous_up_to := tier_record."upTo";
        END IF;
      END LOOP;
      IF usage_record."pricingMode" = 'VOLUME' AND EXISTS (
        SELECT 1 FROM "billing"."MerchantPricingUsageTier" WHERE "merchantPricingUsageEventId" = usage_record."id" AND "flatAmountMinor" = 0 AND "amountPerUnitMinor" = 0
      ) AND usage_record."maximumUnitsPerBillingPeriod" IS NULL THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:volume_zero_cost';
      END IF;
      IF usage_record."pricingMode" = 'GRADUATED' AND EXISTS (
        SELECT 1 FROM "billing"."MerchantPricingUsageTier" WHERE "merchantPricingUsageEventId" = usage_record."id" AND "position" = 0 AND "flatAmountMinor" + "amountPerUnitMinor" = 0
      ) AND usage_record."maximumUnitsPerBillingPeriod" IS NULL THEN
        RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:graduated_zero_cost';
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_plan_highlight_translation_state(highlight_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  translation_count integer;
  publication_status "billing"."MerchantPricingPlanPublicationStatus";
BEGIN
  SELECT plan."publicationStatus" INTO publication_status
  FROM "billing"."MerchantPricingPlanHighlight" highlight
  JOIN "billing"."MerchantPricingPlan" plan
    ON plan."id" = highlight."merchantPricingPlanId"
  WHERE highlight."id" = highlight_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO translation_count
  FROM "billing"."MerchantPricingPlanHighlightTranslation"
  WHERE "merchantPricingPlanHighlightId" = highlight_id;

  IF publication_status = 'READY' THEN
    IF translation_count <> 20 THEN
      RAISE EXCEPTION 'ARCH014_PLAN_HIGHLIGHT_INVALID:translation_count';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanHighlightTranslation" t
      WHERE t."merchantPricingPlanHighlightId" = highlight_id
        AND t."locale" NOT IN ('cs', 'da', 'de', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant', 'en')
    ) OR EXISTS (
      SELECT 1
      FROM (VALUES ('cs'), ('da'), ('de'), ('en'), ('es'), ('fi'), ('fr'), ('it'), ('ja'), ('ko'), ('nb'), ('nl'), ('pl'), ('pt-BR'), ('pt-PT'), ('sv'), ('th'), ('tr'), ('zh-Hans'), ('zh-Hant')) AS expected(locale)
      WHERE NOT EXISTS (
        SELECT 1
        FROM "billing"."MerchantPricingPlanHighlightTranslation" t
        WHERE t."merchantPricingPlanHighlightId" = highlight_id
          AND t."locale" = expected.locale
      )
    ) THEN
      RAISE EXCEPTION 'ARCH014_PLAN_HIGHLIGHT_INVALID:locale_set';
    END IF;
  ELSE
    IF translation_count <> 1 OR NOT EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanHighlightTranslation" t
      WHERE t."merchantPricingPlanHighlightId" = highlight_id
        AND t."locale" = 'en'
    ) OR EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanHighlightTranslation" t
      WHERE t."merchantPricingPlanHighlightId" = highlight_id
        AND t."locale" <> 'en'
    ) THEN
      RAISE EXCEPTION 'ARCH031_PLAN_HIGHLIGHT_INVALID:draft_translations';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing"."MerchantPricingPlanHighlightTranslation" t
    WHERE t."merchantPricingPlanHighlightId" = highlight_id
      AND (btrim(t."merchantTitle") = '' OR char_length(t."merchantTitle") > 120
        OR btrim(t."merchantDescription") = '' OR char_length(t."merchantDescription") > 500)
  ) THEN
    RAISE EXCEPTION 'ARCH014_PLAN_HIGHLIGHT_INVALID:translation_content';
  END IF;
END;
$$;
