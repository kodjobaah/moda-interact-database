-- Move the lifetime Free grant default to platform policy.
ALTER TABLE "billing"."PlatformBillingPolicy"
ADD COLUMN "lifetimeFreeRecoveryAllowance" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "billing"."PlatformBillingPolicy"
ADD CONSTRAINT "PlatformBillingPolicy_lifetimeFreeRecoveryAllowance_non_negative"
CHECK ("lifetimeFreeRecoveryAllowance" >= 0);

-- Snapshot the agreed migration-cohort grant only for completed onboarding.
INSERT INTO "billing"."ShopEntitlementCounter" (
    "id",
    "shopId",
    "counter",
    "grantedQuantity",
    "committedQuantity",
    "reservedQuantity",
    "refundingQuantity",
    "version",
    "createdAt",
    "updatedAt"
)
SELECT
    'lifetime-free:' || shop."id",
    shop."id",
    'FREE_RECOVERY_LIFETIME',
    5,
    0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "commerce"."Shop" AS shop
JOIN "shopify"."ShopSettings" AS settings ON settings."shopId" = shop."id"
LEFT JOIN "billing"."ShopEntitlementCounter" AS counter
    ON counter."shopId" = shop."id"
    AND counter."counter" = 'FREE_RECOVERY_LIFETIME'
WHERE settings."onboardingCompleted" = true
  AND counter."id" IS NULL
ON CONFLICT ("shopId", "counter") DO NOTHING;

UPDATE "billing"."ShopEntitlementCounter" AS counter
SET
    "grantedQuantity" = 5,
    "version" = counter."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "shopify"."ShopSettings" AS settings
WHERE counter."shopId" = settings."shopId"
  AND counter."counter" = 'FREE_RECOVERY_LIFETIME'
  AND counter."grantedQuantity" = 0
  AND settings."onboardingCompleted" = true;