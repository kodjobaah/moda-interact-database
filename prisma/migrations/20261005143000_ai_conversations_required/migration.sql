-- AI Conversations is a core capability of every Moda plan, matching the
-- existing Checkout Recovery plan-managed behaviour. Existing merchant opt-in
-- preferences are no longer meaningful once the feature is plan-managed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "billing"."Feature"
    WHERE "key" = 'ai_conversations'
  ) THEN
    RAISE EXCEPTION 'AI Conversations Feature row is required before applying this migration';
  END IF;
END $$;

UPDATE "billing"."Feature"
SET
  "activationMode" = 'ALWAYS_ENABLED',
  "systemRequired" = true,
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'ai_conversations';

-- System-required features belong to every merchant-facing catalogue plan.
INSERT INTO "billing"."MerchantPricingPlanFeature" (
  "merchantPricingPlanId",
  "featureId"
)
SELECT
  p."id",
  f."id"
FROM "billing"."MerchantPricingPlan" p
CROSS JOIN "billing"."Feature" f
WHERE f."key" = 'ai_conversations'
ON CONFLICT ("merchantPricingPlanId", "featureId") DO NOTHING;

-- Existing operational plans must receive the same capability immediately so
-- active subscriptions do not depend on a later rematerialisation.
INSERT INTO "billing"."BillingPlanFeature" (
  "id",
  "planId",
  "featureId",
  "enabled"
)
SELECT
  'required-ai-conversations:' || p."id",
  p."id",
  f."id",
  true
FROM "billing"."BillingPlan" p
CROSS JOIN "billing"."Feature" f
WHERE f."key" = 'ai_conversations'
ON CONFLICT ("planId", "featureId") DO UPDATE
SET "enabled" = true;

-- A core plan-managed capability has no merchant opt-in state.
DELETE FROM "billing"."ShopFeaturePreference"
WHERE "featureId" = (
  SELECT "id"
  FROM "billing"."Feature"
  WHERE "key" = 'ai_conversations'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "billing"."Feature"
    WHERE "key" = 'ai_conversations'
      AND (
        "activationMode" <> 'ALWAYS_ENABLED'
        OR NOT "systemRequired"
        OR NOT "active"
      )
  ) THEN
    RAISE EXCEPTION 'AI Conversations Feature row did not converge to required always-enabled state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing"."MerchantPricingPlan" p
    WHERE NOT EXISTS (
      SELECT 1
      FROM "billing"."MerchantPricingPlanFeature" mpf
      JOIN "billing"."Feature" f ON f."id" = mpf."featureId"
      WHERE mpf."merchantPricingPlanId" = p."id"
        AND f."key" = 'ai_conversations'
    )
  ) THEN
    RAISE EXCEPTION 'A MerchantPricingPlan is missing required AI Conversations support';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing"."BillingPlan" p
    WHERE NOT EXISTS (
      SELECT 1
      FROM "billing"."BillingPlanFeature" bpf
      JOIN "billing"."Feature" f ON f."id" = bpf."featureId"
      WHERE bpf."planId" = p."id"
        AND f."key" = 'ai_conversations'
        AND bpf."enabled" = true
    )
  ) THEN
    RAISE EXCEPTION 'A BillingPlan is missing enabled AI Conversations support';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing"."ShopFeaturePreference" sfp
    JOIN "billing"."Feature" f ON f."id" = sfp."featureId"
    WHERE f."key" = 'ai_conversations'
  ) THEN
    RAISE EXCEPTION 'AI Conversations merchant preferences remain after conversion to a core feature';
  END IF;
END $$;
