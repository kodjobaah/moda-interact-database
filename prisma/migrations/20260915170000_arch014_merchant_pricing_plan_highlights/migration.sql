CREATE TABLE "billing"."MerchantPricingPlanHighlight" (
    "id" TEXT NOT NULL,
    "merchantPricingPlanId" TEXT NOT NULL,
    "contentKey" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPricingPlanHighlight_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchantPricingPlanHighlight_merchantPricingPlanId_fkey"
      FOREIGN KEY ("merchantPricingPlanId")
      REFERENCES "billing"."MerchantPricingPlan"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ck_arch014_plan_highlight_position" CHECK ("position" >= 0),
    CONSTRAINT "uq_arch014_plan_highlight_content_key" UNIQUE ("merchantPricingPlanId", "contentKey"),
    CONSTRAINT "uq_arch014_plan_highlight_position" UNIQUE ("merchantPricingPlanId", "position") DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE "billing"."MerchantPricingPlanHighlightTranslation" (
    "id" TEXT NOT NULL,
    "merchantPricingPlanHighlightId" TEXT NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "merchantTitle" VARCHAR(120) NOT NULL,
    "merchantDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPricingPlanHighlightTranslation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchantPricingPlanHighlightTranslation_merchantPricingPlanHighlightId_fkey"
      FOREIGN KEY ("merchantPricingPlanHighlightId")
      REFERENCES "billing"."MerchantPricingPlanHighlight"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ck_arch014_plan_highlight_translation_locale" CHECK (
      "locale" IN ('cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant')
    ),
    CONSTRAINT "ck_arch014_plan_highlight_translation_title" CHECK (
      btrim("merchantTitle") <> '' AND char_length("merchantTitle") <= 120
    ),
    CONSTRAINT "ck_arch014_plan_highlight_translation_description" CHECK (
      btrim("merchantDescription") <> '' AND char_length("merchantDescription") <= 500
    ),
    CONSTRAINT "uq_arch014_plan_highlight_translation_locale" UNIQUE ("merchantPricingPlanHighlightId", "locale")
);

CREATE INDEX "MerchantPricingPlanHighlight_merchantPricingPlanId_idx"
  ON "billing"."MerchantPricingPlanHighlight"("merchantPricingPlanId");

CREATE OR REPLACE FUNCTION billing.validate_arch014_plan_highlight_translation_state(highlight_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  translation_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "billing"."MerchantPricingPlanHighlight"
    WHERE "id" = highlight_id
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO translation_count
  FROM "billing"."MerchantPricingPlanHighlightTranslation"
  WHERE "merchantPricingPlanHighlightId" = highlight_id;

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

CREATE OR REPLACE FUNCTION billing.validate_arch014_plan_highlight_position_state(plan_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  highlight_count integer;
BEGIN
  SELECT count(*) INTO highlight_count
  FROM "billing"."MerchantPricingPlanHighlight"
  WHERE "merchantPricingPlanId" = plan_id;

  IF highlight_count = 0 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing"."MerchantPricingPlanHighlight" h
    WHERE h."merchantPricingPlanId" = plan_id
      AND h."position" <> (
        SELECT count(*)
        FROM "billing"."MerchantPricingPlanHighlight" h2
        WHERE h2."merchantPricingPlanId" = plan_id
          AND h2."position" <= h."position"
      ) - 1
  ) OR EXISTS (
    SELECT 1
    FROM generate_series(0, highlight_count - 1) expected(position)
    WHERE NOT EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanHighlight" h
      WHERE h."merchantPricingPlanId" = plan_id
        AND h."position" = expected.position
    )
  ) THEN
    RAISE EXCEPTION 'ARCH014_PLAN_HIGHLIGHT_INVALID:positions';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_plan_highlight_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM billing.validate_arch014_plan_highlight_translation_state(OLD."id");
    PERFORM billing.validate_arch014_plan_highlight_position_state(OLD."merchantPricingPlanId");
  ELSE
    PERFORM billing.validate_arch014_plan_highlight_translation_state(NEW."id");
    PERFORM billing.validate_arch014_plan_highlight_position_state(NEW."merchantPricingPlanId");
    IF TG_OP = 'UPDATE' AND OLD."merchantPricingPlanId" IS DISTINCT FROM NEW."merchantPricingPlanId" THEN
      PERFORM billing.validate_arch014_plan_highlight_position_state(OLD."merchantPricingPlanId");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_plan_highlight_translation_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM billing.validate_arch014_plan_highlight_translation_state(OLD."merchantPricingPlanHighlightId");
  ELSE
    PERFORM billing.validate_arch014_plan_highlight_translation_state(NEW."merchantPricingPlanHighlightId");
    IF TG_OP = 'UPDATE' AND OLD."merchantPricingPlanHighlightId" IS DISTINCT FROM NEW."merchantPricingPlanHighlightId" THEN
      PERFORM billing.validate_arch014_plan_highlight_translation_state(OLD."merchantPricingPlanHighlightId");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER trg_arch014_plan_highlight_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingPlanHighlight"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION billing.validate_arch014_plan_highlight_trigger();

CREATE CONSTRAINT TRIGGER trg_arch014_plan_highlight_translation_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingPlanHighlightTranslation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION billing.validate_arch014_plan_highlight_translation_trigger();
