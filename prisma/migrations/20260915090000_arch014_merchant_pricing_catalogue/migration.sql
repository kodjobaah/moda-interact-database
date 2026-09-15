CREATE TYPE "billing"."MerchantPricingPlanKind" AS ENUM ('FREE', 'PAID_METERED');
CREATE TYPE "billing"."MerchantPricingAllowancePeriod" AS ENUM ('LIFETIME', 'EVERY_30_DAYS');
CREATE TYPE "billing"."MerchantPricingBillingPeriod" AS ENUM ('EVERY_30_DAYS');
CREATE TYPE "billing"."MerchantPricingUsagePricingMode" AS ENUM ('FIXED', 'GRADUATED', 'VOLUME');

CREATE TABLE "billing"."MerchantPricingPlan" (
    "id" TEXT NOT NULL,
    "shopifyPlanHandle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "planKind" "billing"."MerchantPricingPlanKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cataloguePosition" INTEGER NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "includedRecoveryCredits" INTEGER NOT NULL,
    "allowancePeriod" "billing"."MerchantPricingAllowancePeriod" NOT NULL,
    "billingPeriod" "billing"."MerchantPricingBillingPeriod" NOT NULL,
    "recurringAmountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPricingPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing"."MerchantPricingPlanTranslation" (
    "id" TEXT NOT NULL,
    "merchantPricingPlanId" TEXT NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "merchantDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPricingPlanTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing"."MerchantPricingUsageEvent" (
    "id" TEXT NOT NULL,
    "merchantPricingPlanId" TEXT NOT NULL,
    "eventHandle" TEXT NOT NULL,
    "adminLabel" TEXT NOT NULL,
    "creditsGrantedPerUnit" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "pricingMode" "billing"."MerchantPricingUsagePricingMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fixedUnitAmountMinor" INTEGER,
    "maximumUnitsPerBillingPeriod" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantPricingUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing"."MerchantPricingUsageTier" (
    "id" TEXT NOT NULL,
    "merchantPricingUsageEventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "upTo" INTEGER,
    "amountPerUnitMinor" INTEGER NOT NULL,
    "flatAmountMinor" INTEGER NOT NULL,
    CONSTRAINT "MerchantPricingUsageTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantPricingPlan_shopifyPlanHandle_key" ON "billing"."MerchantPricingPlan"("shopifyPlanHandle");
CREATE INDEX "MerchantPricingPlan_isActive_cataloguePosition_idx" ON "billing"."MerchantPricingPlan"("isActive", "cataloguePosition");
CREATE INDEX "MerchantPricingPlan_planKind_isActive_idx" ON "billing"."MerchantPricingPlan"("planKind", "isActive");
CREATE UNIQUE INDEX "MerchantPricingPlanTranslation_merchantPricingPlanId_locale_key" ON "billing"."MerchantPricingPlanTranslation"("merchantPricingPlanId", "locale");
CREATE UNIQUE INDEX "MerchantPricingUsageEvent_merchantPricingPlanId_eventHandle_key" ON "billing"."MerchantPricingUsageEvent"("merchantPricingPlanId", "eventHandle");
CREATE UNIQUE INDEX "MerchantPricingUsageEvent_merchantPricingPlanId_position_key" ON "billing"."MerchantPricingUsageEvent"("merchantPricingPlanId", "position");
CREATE UNIQUE INDEX "MerchantPricingUsageTier_merchantPricingUsageEventId_position_key" ON "billing"."MerchantPricingUsageTier"("merchantPricingUsageEventId", "position");

ALTER TABLE "billing"."MerchantPricingPlan"
ADD CONSTRAINT "ck_merchant_pricing_plan_handle_nonblank" CHECK (btrim("shopifyPlanHandle") <> ''),
ADD CONSTRAINT "ck_merchant_pricing_plan_display_name_nonblank" CHECK (btrim("displayName") <> ''),
ADD CONSTRAINT "ck_merchant_pricing_plan_catalogue_position" CHECK ("cataloguePosition" >= 0),
ADD CONSTRAINT "ck_merchant_pricing_plan_included_credits_nonnegative" CHECK ("includedRecoveryCredits" >= 0),
ADD CONSTRAINT "ck_merchant_pricing_plan_recurring_amount_nonnegative" CHECK ("recurringAmountMinor" >= 0),
ADD CONSTRAINT "ck_merchant_pricing_plan_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "billing"."MerchantPricingPlanTranslation"
ADD CONSTRAINT "ck_merchant_pricing_translation_locale" CHECK ("locale" IN ('cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant')),
ADD CONSTRAINT "ck_merchant_pricing_translation_description" CHECK (btrim("merchantDescription") <> '' AND char_length("merchantDescription") <= 2000);

ALTER TABLE "billing"."MerchantPricingUsageEvent"
ADD CONSTRAINT "ck_merchant_pricing_usage_handle_nonblank" CHECK (btrim("eventHandle") <> ''),
ADD CONSTRAINT "ck_merchant_pricing_usage_admin_label" CHECK (btrim("adminLabel") <> '' AND char_length("adminLabel") <= 255),
ADD CONSTRAINT "ck_merchant_pricing_usage_credits_positive" CHECK ("creditsGrantedPerUnit" > 0),
ADD CONSTRAINT "ck_merchant_pricing_usage_position" CHECK ("position" BETWEEN 0 AND 4),
ADD CONSTRAINT "ck_merchant_pricing_usage_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "ck_merchant_pricing_usage_fixed_amount" CHECK ("fixedUnitAmountMinor" IS NULL OR "fixedUnitAmountMinor" >= 0),
ADD CONSTRAINT "ck_merchant_pricing_usage_maximum_units" CHECK ("maximumUnitsPerBillingPeriod" IS NULL OR "maximumUnitsPerBillingPeriod" > 0);

ALTER TABLE "billing"."MerchantPricingUsageTier"
ADD CONSTRAINT "ck_merchant_pricing_tier_position" CHECK ("position" BETWEEN 0 AND 5),
ADD CONSTRAINT "ck_merchant_pricing_tier_up_to" CHECK ("upTo" IS NULL OR "upTo" > 0),
ADD CONSTRAINT "ck_merchant_pricing_tier_amounts" CHECK ("amountPerUnitMinor" >= 0 AND "flatAmountMinor" >= 0);

ALTER TABLE "billing"."MerchantPricingPlan"
ADD CONSTRAINT "uq_merchant_pricing_plan_catalogue_position" UNIQUE ("cataloguePosition") DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "billing"."MerchantPricingPlanTranslation"
ADD CONSTRAINT "MerchantPricingPlanTranslation_merchantPricingPlanId_fkey"
FOREIGN KEY ("merchantPricingPlanId") REFERENCES "billing"."MerchantPricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing"."MerchantPricingUsageEvent"
ADD CONSTRAINT "MerchantPricingUsageEvent_merchantPricingPlanId_fkey"
FOREIGN KEY ("merchantPricingPlanId") REFERENCES "billing"."MerchantPricingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing"."MerchantPricingUsageTier"
ADD CONSTRAINT "MerchantPricingUsageTier_merchantPricingUsageEventId_fkey"
FOREIGN KEY ("merchantPricingUsageEventId") REFERENCES "billing"."MerchantPricingUsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_plan(plan_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record RECORD;
  usage_record RECORD;
  tier_count integer;
  usage_count integer;
  previous_up_to integer;
  tier_record RECORD;
BEGIN
  SELECT * INTO plan_record FROM "billing"."MerchantPricingPlan" WHERE "id" = plan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM "billing"."MerchantPricingPlanTranslation" WHERE "merchantPricingPlanId" = plan_id) <> 20 THEN
    RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:translations';
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

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_catalogue_positions()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  plan_count integer;
BEGIN
  SELECT count(*) INTO plan_count FROM "billing"."MerchantPricingPlan";
  IF EXISTS (
    SELECT 1 FROM "billing"."MerchantPricingPlan" p
    WHERE p."cataloguePosition" <> (SELECT count(*) FROM "billing"."MerchantPricingPlan" p2 WHERE p2."cataloguePosition" <= p."cataloguePosition") - 1
  ) OR EXISTS (
    SELECT 1 FROM generate_series(0, plan_count - 1) expected(position)
    WHERE NOT EXISTS (SELECT 1 FROM "billing"."MerchantPricingPlan" p WHERE p."cataloguePosition" = expected.position)
  ) THEN
    RAISE EXCEPTION 'ARCH014_MERCHANT_PRICING_INVALID:catalogue_positions';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_plan_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM billing.validate_arch014_merchant_pricing_plan(COALESCE(NEW."id", OLD."id"));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_translation_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM billing.validate_arch014_merchant_pricing_plan(NEW."merchantPricingPlanId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM billing.validate_arch014_merchant_pricing_plan(OLD."merchantPricingPlanId");
  ELSE
    PERFORM billing.validate_arch014_merchant_pricing_plan(OLD."merchantPricingPlanId");
    IF OLD."merchantPricingPlanId" IS DISTINCT FROM NEW."merchantPricingPlanId" THEN
      PERFORM billing.validate_arch014_merchant_pricing_plan(NEW."merchantPricingPlanId");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_usage_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM billing.validate_arch014_merchant_pricing_plan(NEW."merchantPricingPlanId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM billing.validate_arch014_merchant_pricing_plan(OLD."merchantPricingPlanId");
  ELSE
    PERFORM billing.validate_arch014_merchant_pricing_plan(OLD."merchantPricingPlanId");
    IF OLD."merchantPricingPlanId" IS DISTINCT FROM NEW."merchantPricingPlanId" THEN
      PERFORM billing.validate_arch014_merchant_pricing_plan(NEW."merchantPricingPlanId");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_tier_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_plan_id text;
  new_plan_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "merchantPricingPlanId" INTO new_plan_id
    FROM "billing"."MerchantPricingUsageEvent"
    WHERE "id" = NEW."merchantPricingUsageEventId";
    PERFORM billing.validate_arch014_merchant_pricing_plan(new_plan_id);
  ELSIF TG_OP = 'DELETE' THEN
    SELECT "merchantPricingPlanId" INTO old_plan_id
    FROM "billing"."MerchantPricingUsageEvent"
    WHERE "id" = OLD."merchantPricingUsageEventId";
    PERFORM billing.validate_arch014_merchant_pricing_plan(old_plan_id);
  ELSE
    SELECT "merchantPricingPlanId" INTO old_plan_id
    FROM "billing"."MerchantPricingUsageEvent"
    WHERE "id" = OLD."merchantPricingUsageEventId";
    SELECT "merchantPricingPlanId" INTO new_plan_id
    FROM "billing"."MerchantPricingUsageEvent"
    WHERE "id" = NEW."merchantPricingUsageEventId";
    PERFORM billing.validate_arch014_merchant_pricing_plan(old_plan_id);
    IF OLD."merchantPricingUsageEventId" IS DISTINCT FROM NEW."merchantPricingUsageEventId"
      OR old_plan_id IS DISTINCT FROM new_plan_id THEN
      PERFORM billing.validate_arch014_merchant_pricing_plan(new_plan_id);
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION billing.validate_arch014_merchant_pricing_global_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM billing.validate_arch014_merchant_pricing_catalogue_positions();
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER trg_arch014_merchant_pricing_plan_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingPlan"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.validate_arch014_merchant_pricing_plan_trigger();
CREATE CONSTRAINT TRIGGER trg_arch014_merchant_pricing_translation_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingPlanTranslation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.validate_arch014_merchant_pricing_translation_trigger();
CREATE CONSTRAINT TRIGGER trg_arch014_merchant_pricing_usage_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingUsageEvent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.validate_arch014_merchant_pricing_usage_trigger();
CREATE CONSTRAINT TRIGGER trg_arch014_merchant_pricing_tier_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingUsageTier"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.validate_arch014_merchant_pricing_tier_trigger();
CREATE CONSTRAINT TRIGGER trg_arch014_merchant_pricing_global_validate
AFTER INSERT OR UPDATE OR DELETE ON "billing"."MerchantPricingPlan"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing.validate_arch014_merchant_pricing_global_trigger();