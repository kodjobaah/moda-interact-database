BEGIN;
-- Retire the unused Order Support feature without changing plan prices or subscriptions.
-- References in published releases/audits intentionally block removal for manual review.
DELETE FROM billing."BillingPlanFeature" WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key = 'order_support');
DELETE FROM billing."MerchantPricingPlanFeature" WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key = 'order_support');
DELETE FROM billing."ShopFeaturePreference" WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key = 'order_support');
DELETE FROM commerce."CommerceFeatureConfiguration" WHERE "featureId" IN (SELECT id FROM billing."Feature" WHERE key = 'order_support');
DELETE FROM billing."Feature" WHERE key = 'order_support';
COMMIT;
