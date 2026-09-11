-- Add durable lifecycle vocabulary without changing existing reservation semantics.
CREATE TYPE "billing"."BillingPeriodCloseReason" AS ENUM (
    'RENEWED_SAME_PLAN',
    'PLAN_CHANGED',
    'CONTRACT_ENDED',
    'MIGRATION_RECONCILED'
);

CREATE TYPE "billing"."UsageReservationReleaseReason" AS ENUM ('PERIOD_CLOSED');

ALTER TABLE "billing"."BillingPeriod"
ADD COLUMN "subscriptionId" TEXT,
ADD COLUMN "planId" TEXT,
ADD COLUMN "shopifyPlanHandleSnapshot" TEXT,
ADD COLUMN "planNameSnapshot" TEXT,
ADD COLUMN "planKindSnapshot" "billing"."BillingPlanKind",
ADD COLUMN "includedRecoveryCreditsGranted" INTEGER,
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closeReason" "billing"."BillingPeriodCloseReason";

ALTER TABLE "billing"."UsageReservation"
ADD COLUMN "releaseReason" "billing"."UsageReservationReleaseReason";

-- The shop-level unique Subscription projection makes this join deterministic.
UPDATE "billing"."BillingPeriod" AS period
SET "subscriptionId" = subscription."id"
FROM "billing"."Subscription" AS subscription
WHERE subscription."shopId" = period."shopId";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "billing"."BillingPeriod" AS period
        LEFT JOIN "billing"."Subscription" AS subscription
          ON subscription."id" = period."subscriptionId"
        WHERE subscription."id" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot map every BillingPeriod to exactly one Subscription by shopId';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "billing"."Subscription" AS subscription
        WHERE subscription."billingPeriodId" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "billing"."BillingPeriod" AS period
              WHERE period."id" = subscription."billingPeriodId"
                AND period."subscriptionId" = subscription."id"
          )
    ) THEN
        RAISE EXCEPTION
            'Subscription.billingPeriodId does not identify a BillingPeriod owned by that Subscription';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "billing"."Subscription" AS subscription
        JOIN "billing"."BillingPeriod" AS period
          ON period."subscriptionId" = subscription."id"
         AND period."status" = 'OPEN'
        GROUP BY subscription."id"
        HAVING COUNT(*) > 1
           AND (
               subscription."billingPeriodId" IS NULL
               OR NOT EXISTS (
                   SELECT 1
                   FROM "billing"."BillingPeriod" AS current_period
                   WHERE current_period."id" = subscription."billingPeriodId"
                     AND current_period."subscriptionId" = subscription."id"
                     AND current_period."status" = 'OPEN'
               )
           )
    ) THEN
        RAISE EXCEPTION
            'Cannot normalize multiple OPEN BillingPeriods without an unambiguous current pointer';
    END IF;
END;
$$;

-- Preserve the pointer-selected current period and close only its other OPEN history.
UPDATE "billing"."BillingPeriod" AS period
SET "status" = 'CLOSED',
    "closedAt" = period."periodEnd",
    "closeReason" = 'MIGRATION_RECONCILED'
FROM "billing"."Subscription" AS subscription
WHERE period."subscriptionId" = subscription."id"
  AND period."status" = 'OPEN'
  AND period."id" <> subscription."billingPeriodId";

-- Snapshot only the exact current Subscription plan. Historical periods remain nullable.
UPDATE "billing"."BillingPeriod" AS period
SET "planId" = plan."id",
    "shopifyPlanHandleSnapshot" = plan."shopifyPlanHandle",
    "planNameSnapshot" = plan."name",
    "planKindSnapshot" = plan."kind",
    "includedRecoveryCreditsGranted" = CASE
        WHEN plan."kind" = 'PAID_METERED' THEN plan."includedRecoveryConversationAllowance"
        ELSE NULL
    END
FROM "billing"."Subscription" AS subscription
JOIN "billing"."BillingPlan" AS plan ON plan."id" = subscription."planId"
WHERE period."id" = subscription."billingPeriodId"
  AND period."subscriptionId" = subscription."id"
  AND period."status" = 'OPEN';

DO $$
DECLARE
    current_period RECORD;
    usage_total NUMERIC;
BEGIN
    FOR current_period IN
        SELECT
            period."id" AS period_id,
            period."shopId" AS shop_id,
            period."subscriptionId" AS subscription_id,
            subscription."planId" AS plan_id,
            plan."shopifyUsageEventHandle" AS usage_handle,
            plan."includedRecoveryConversationAllowance" AS allowance
        FROM "billing"."BillingPeriod" AS period
        JOIN "billing"."Subscription" AS subscription
          ON subscription."id" = period."subscriptionId"
         AND subscription."billingPeriodId" = period."id"
        JOIN "billing"."BillingPlan" AS plan
          ON plan."id" = subscription."planId"
         AND plan."kind" = 'PAID_METERED'
         AND plan."active" = TRUE
        WHERE period."status" = 'OPEN'
    LOOP
        IF current_period.allowance IS NULL OR current_period.allowance < 0 THEN
            RAISE EXCEPTION
                'Current paid BillingPeriod % has invalid included recovery allowance',
                current_period.period_id;
        END IF;

        IF current_period.usage_handle IS NULL THEN
            RAISE EXCEPTION
                'Current paid BillingPeriod % has no exact Shopify usage meter handle',
                current_period.period_id;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "billing"."UsageEvent" AS event
            WHERE event."shopId" = current_period.shop_id
              AND event."billingPeriodId" = current_period.period_id
              AND event."metric" = 'RECOVERY_CONVERSATION'
              AND event."shopifyEventHandle" IS DISTINCT FROM current_period.usage_handle
        ) THEN
            RAISE EXCEPTION
                'Current paid BillingPeriod % has recovery usage outside the exact current plan meter',
                current_period.period_id;
        END IF;

        SELECT COALESCE(SUM(event."quantity"), 0)
        INTO usage_total
        FROM "billing"."UsageEvent" AS event
        WHERE event."shopId" = current_period.shop_id
          AND event."billingPeriodId" = current_period.period_id
          AND event."metric" = 'RECOVERY_CONVERSATION'
          AND event."shopifyEventHandle" = current_period.usage_handle;

        IF usage_total < 0 OR usage_total <> trunc(usage_total) THEN
            RAISE EXCEPTION
                'Current paid BillingPeriod % has invalid normal recovery usage total %',
                current_period.period_id,
                usage_total;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM "billing"."BillingPeriodEntitlementCounter" AS counter
            WHERE counter."billingPeriodId" = current_period.period_id
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM "billing"."BillingPeriodEntitlementCounter" AS counter
                WHERE counter."billingPeriodId" = current_period.period_id
                  AND (
                      counter."counter" <> 'INCLUDED_RECOVERY_CREDITS'
                      OR counter."grantedQuantity" <> current_period.allowance
                      OR counter."grantedQuantity" < 0
                      OR counter."committedQuantity" < 0
                      OR counter."reservedQuantity" < 0
                      OR counter."forfeitedQuantity" < 0
                      OR counter."committedQuantity" + counter."reservedQuantity" + counter."forfeitedQuantity" > counter."grantedQuantity"
                  )
            ) THEN
                RAISE EXCEPTION
                    'Current paid BillingPeriod % has an invalid existing entitlement counter',
                    current_period.period_id;
            END IF;
        ELSE
            INSERT INTO "billing"."BillingPeriodEntitlementCounter" (
                "id",
                "shopId",
                "billingPeriodId",
                "counter",
                "grantedQuantity",
                "committedQuantity",
                "reservedQuantity",
                "forfeitedQuantity",
                "version"
            ) VALUES (
                'billing-period-' || current_period.period_id || '-included-recovery-credits',
                current_period.shop_id,
                current_period.period_id,
                'INCLUDED_RECOVERY_CREDITS',
                current_period.allowance,
                LEAST(usage_total, current_period.allowance),
                0,
                0,
                0
            );
        END IF;
    END LOOP;
END;
$$;

ALTER TABLE "billing"."BillingPeriod"
ALTER COLUMN "subscriptionId" SET NOT NULL;

CREATE INDEX "BillingPeriod_subscriptionId_periodStart_periodEnd_idx"
ON "billing"."BillingPeriod"("subscriptionId", "periodStart", "periodEnd");

CREATE UNIQUE INDEX "BillingPeriod_subscriptionId_open_key"
ON "billing"."BillingPeriod"("subscriptionId")
WHERE "status" = 'OPEN';

ALTER TABLE "billing"."BillingPeriod"
ADD CONSTRAINT "BillingPeriod_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "billing"."Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "BillingPeriod_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "billing"."BillingPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BillingPeriod_period_boundary"
CHECK ("periodStart" < "periodEnd"),
ADD CONSTRAINT "BillingPeriod_included_recovery_credits_non_negative"
CHECK ("includedRecoveryCreditsGranted" IS NULL OR "includedRecoveryCreditsGranted" >= 0),
ADD CONSTRAINT "BillingPeriod_open_close_metadata_empty"
CHECK ("status" <> 'OPEN' OR ("closedAt" IS NULL AND "closeReason" IS NULL));
