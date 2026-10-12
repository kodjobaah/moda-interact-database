-- Forward-only correction for the four deterministic ARCH-017 Feature IDs.
-- Leave the historical migration unchanged: deployed Prisma migrations have
-- recorded checksums. This migration also normalizes already-seeded databases.
--
-- The Feature key is the durable business identity. Do not reset activation,
-- system-required, active, name, description or createdAt on existing records.
-- Billing's feature FKs cascade primary-key updates; Commerce's protected
-- release/capability/audit FKs do not. Refuse to bypass their integrity rules.

BEGIN;

DO $feature_id_preflight$
DECLARE
  feature_mapping RECORD;
  current_id TEXT;
BEGIN
  FOR feature_mapping IN
    SELECT * FROM (VALUES
      ('checkout_recovery', 'arch017-feature-checkout-recovery', 'feature-checkout-recovery'),
      ('ai_conversations',  'arch017-feature-ai-conversations',  'feature-ai-conversations'),
      ('product_search',    'arch017-feature-product-search',    'feature-product-search'),
      ('order_support',     'arch017-feature-order-support',     'feature-order-support')
    ) AS mapping(feature_key, legacy_id, canonical_id)
  LOOP
    SELECT "id" INTO current_id
    FROM "billing"."Feature"
    WHERE "key" = feature_mapping.feature_key;

    IF current_id IS NULL THEN
      RAISE EXCEPTION 'Canonical Feature ID migration: missing required feature key %', feature_mapping.feature_key
        USING ERRCODE = '23514';
    END IF;

    IF current_id <> feature_mapping.legacy_id AND current_id <> feature_mapping.canonical_id THEN
      RAISE EXCEPTION 'Canonical Feature ID migration: unexpected existing ID % for key %',
        current_id, feature_mapping.feature_key
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "billing"."Feature"
      WHERE "id" = feature_mapping.canonical_id
        AND "key" <> feature_mapping.feature_key
    ) THEN
      RAISE EXCEPTION 'Canonical Feature ID migration: target ID % is already owned by another feature',
        feature_mapping.canonical_id
        USING ERRCODE = '23505';
    END IF;

    -- These Commerce tables have ON UPDATE RESTRICT references; some rows are
    -- intentionally immutable. Never disable guards or rewrite published data
    -- merely to change the seeded primary key.
    IF current_id = feature_mapping.legacy_id AND (
      EXISTS (
        SELECT 1 FROM "commerce"."CommerceCapability"
        WHERE "featureId" = current_id
      ) OR EXISTS (
        SELECT 1 FROM "commerce"."CommerceFeatureConfiguration"
        WHERE "featureId" = current_id
      ) OR EXISTS (
        SELECT 1 FROM "commerce"."CommerceReleaseFeature"
        WHERE "featureId" = current_id
      ) OR EXISTS (
        SELECT 1 FROM "commerce"."CommerceAuditEvent"
        WHERE "featureId" = current_id
      )
    ) THEN
      RAISE EXCEPTION 'Canonical Feature ID migration: % (%) is referenced by protected Commerce records',
        feature_mapping.feature_key, current_id
        USING ERRCODE = '23514',
              HINT = 'Preserve immutable Commerce history. Reconcile dependent Commerce records through a separate approved migration before renaming this Feature ID.';
    END IF;
  END LOOP;
END
$feature_id_preflight$;

-- BillingPlanFeature, MerchantPricingPlanFeature and ShopFeaturePreference
-- reference Feature(id) with ON UPDATE CASCADE, preserving those assignments.
UPDATE "billing"."Feature" AS feature
SET "id" = mapping.canonical_id,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('checkout_recovery', 'arch017-feature-checkout-recovery', 'feature-checkout-recovery'),
  ('ai_conversations',  'arch017-feature-ai-conversations',  'feature-ai-conversations'),
  ('product_search',    'arch017-feature-product-search',    'feature-product-search'),
  ('order_support',     'arch017-feature-order-support',     'feature-order-support')
) AS mapping(feature_key, legacy_id, canonical_id)
WHERE feature."key" = mapping.feature_key
  AND feature."id" = mapping.legacy_id;

DO $feature_id_postcondition$
DECLARE
  feature_mapping RECORD;
BEGIN
  FOR feature_mapping IN
    SELECT * FROM (VALUES
      ('checkout_recovery', 'feature-checkout-recovery'),
      ('ai_conversations',  'feature-ai-conversations'),
      ('product_search',    'feature-product-search'),
      ('order_support',     'feature-order-support')
    ) AS mapping(feature_key, canonical_id)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM "billing"."Feature"
      WHERE "key" = feature_mapping.feature_key
        AND "id" = feature_mapping.canonical_id
    ) THEN
      RAISE EXCEPTION 'Canonical Feature ID migration: postcondition failed for key %',
        feature_mapping.feature_key
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END
$feature_id_postcondition$;

COMMIT;
