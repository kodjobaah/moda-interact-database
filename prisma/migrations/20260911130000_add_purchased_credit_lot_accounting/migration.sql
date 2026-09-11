-- Add typed provider settlement evidence without removing legacy settlement data.
CREATE TYPE "billing"."RecoveryCreditProviderActionKind" AS ENUM ('REFUND', 'CREDIT');

ALTER TABLE "billing"."RecoveryCreditPurchase"
ADD COLUMN "committedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundingQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "billing"."UsageReservation"
ADD COLUMN "purchasedCreditPurchaseId" TEXT;

ALTER TABLE "billing"."RecoveryCreditRefund"
ADD COLUMN "purchaseCreditsGrantedSnapshot" INTEGER,
ADD COLUMN "creditsRequested" INTEGER,
ADD COLUMN "creditsApproved" INTEGER,
ADD COLUMN "creditsRefunded" INTEGER,
ADD COLUMN "providerActionKind" "billing"."RecoveryCreditProviderActionKind",
ADD COLUMN "providerAmount" DECIMAL(20,2),
ADD COLUMN "providerCurrency" VARCHAR(3);

-- Existing ARCH-009 refunds were one-per-purchase. Preserve them as readable
-- legacy records while allowing the new schema to record multiple partial refunds.
DROP INDEX "billing"."RecoveryCreditRefund_purchaseId_key";

-- Reject ambiguous legacy quantities before deriving any lot balances.
DO $$
DECLARE
  invalid_refund RECORD;
BEGIN
  SELECT refund.id
  INTO invalid_refund
  FROM "billing"."RecoveryCreditRefund" AS refund
  JOIN "billing"."RecoveryCreditPurchase" AS purchase ON purchase.id = refund."purchaseId"
  WHERE refund."creditsSnapshot" <= 0
     OR refund."creditsSnapshot" > purchase."creditsGranted"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot backfill purchased-credit lots: invalid legacy refund %', invalid_refund.id;
  END IF;
END $$;

-- Capture the original grant and translate legacy full-pack evidence without
-- treating rejected or withdrawn requests as active refund holds.
UPDATE "billing"."RecoveryCreditRefund" AS refund
SET
  "purchaseCreditsGrantedSnapshot" = purchase."creditsGranted",
  "creditsRequested" = refund."creditsSnapshot",
  "creditsApproved" = CASE
    WHEN refund."status"::text IN ('APPROVED', 'PROCESSING', 'PROVIDER_PENDING', 'PROVIDER_ACTION_REQUIRED', 'PROVIDER_CONFIRMED', 'COMPLETED')
    THEN refund."creditsSnapshot"
    ELSE NULL
  END,
  "creditsRefunded" = CASE
    WHEN refund."status"::text = 'COMPLETED' THEN refund."creditsSnapshot"
    ELSE NULL
  END,
  "providerActionKind" = CASE
    WHEN refund."settlementMode"::text = 'PARTNER_DASHBOARD_REFUND' THEN 'REFUND'::"billing"."RecoveryCreditProviderActionKind"
    ELSE NULL
  END
FROM "billing"."RecoveryCreditPurchase" AS purchase
WHERE purchase.id = refund."purchaseId";

-- Seed refund and hold quantities before allocating reservations so those quantities
-- reduce the capacity available to active reservations.
UPDATE "billing"."RecoveryCreditPurchase" AS purchase
SET
  "refundedQuantity" = COALESCE(refunds."refundedQuantity", 0),
  "refundingQuantity" = COALESCE(refunds."refundingQuantity", 0)
FROM (
  SELECT
    refund."purchaseId",
    SUM(CASE WHEN refund."status"::text = 'COMPLETED' THEN refund."creditsSnapshot" ELSE 0 END)::INTEGER AS "refundedQuantity",
    SUM(CASE
      WHEN refund."holdAppliedAt" IS NOT NULL
       AND refund."status"::text NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
      THEN refund."creditsSnapshot"
      ELSE 0
    END)::INTEGER AS "refundingQuantity"
  FROM "billing"."RecoveryCreditRefund" AS refund
  GROUP BY refund."purchaseId"
) AS refunds
WHERE purchase.id = refunds."purchaseId";

-- Build deterministic purchased-credit lots in canonical FIFO order.
CREATE TEMP TABLE "_purchased_credit_lots" (
  "purchaseId" TEXT PRIMARY KEY,
  "remainingQuantity" INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO "_purchased_credit_lots" ("purchaseId", "remainingQuantity")
SELECT purchase.id, purchase."creditsGranted" - purchase."refundedQuantity" - purchase."refundingQuantity"
FROM "billing"."RecoveryCreditPurchase" AS purchase
WHERE purchase."status"::text IN ('ACTIVE', 'REFUNDED')
ORDER BY purchase."shopId", purchase."activatedAt" ASC NULLS LAST, purchase."createdAt" ASC, purchase.id ASC;

DO $$
DECLARE
  reservation RECORD;
  lot RECORD;
  allocated BOOLEAN;
BEGIN
  FOR reservation IN
    SELECT reservation.id, reservation.quantity, reservation.status::text AS status
    FROM "billing"."UsageReservation" AS reservation
    JOIN "billing"."ShopEntitlementCounter" AS counter ON counter.id = reservation."counterId"
    WHERE counter.counter = 'PURCHASED_RECOVERY_CREDITS'
    ORDER BY reservation."createdAt" ASC, reservation.id ASC
  LOOP
    IF reservation.quantity <= 0 THEN
      RAISE EXCEPTION 'Cannot backfill purchased-credit reservation % with non-positive quantity %', reservation.id, reservation.quantity;
    END IF;

    SELECT lots."purchaseId", lots."remainingQuantity"
    INTO lot
    FROM "_purchased_credit_lots" AS lots
    JOIN "billing"."UsageReservation" AS current_reservation ON current_reservation.id = reservation.id
    JOIN "billing"."ShopEntitlementCounter" AS current_counter ON current_counter.id = current_reservation."counterId"
    JOIN "billing"."RecoveryCreditPurchase" AS purchase ON purchase.id = lots."purchaseId"
    WHERE purchase."shopId" = current_counter."shopId"
      AND lots."remainingQuantity" > 0
    ORDER BY purchase."activatedAt" ASC NULLS LAST, purchase."createdAt" ASC, purchase.id ASC
    LIMIT 1;

    IF NOT FOUND OR lot."remainingQuantity" < reservation.quantity THEN
      RAISE EXCEPTION 'Cannot deterministically allocate purchased-credit reservation % without splitting a lot', reservation.id;
    END IF;

    UPDATE "billing"."UsageReservation"
    SET "purchasedCreditPurchaseId" = lot."purchaseId"
    WHERE id = reservation.id;

    IF reservation.status = 'RELEASED' THEN
      CONTINUE;
    END IF;

    UPDATE "_purchased_credit_lots"
    SET "remainingQuantity" = "remainingQuantity" - reservation.quantity
    WHERE "purchaseId" = lot."purchaseId";

    IF reservation.status = 'COMMITTED' THEN
      UPDATE "billing"."RecoveryCreditPurchase"
      SET "committedQuantity" = "committedQuantity" + reservation.quantity
      WHERE id = lot."purchaseId";
    ELSIF reservation.status IN ('RESERVED', 'AMBIGUOUS') THEN
      UPDATE "billing"."RecoveryCreditPurchase"
      SET "reservedQuantity" = "reservedQuantity" + reservation.quantity
      WHERE id = lot."purchaseId";
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  shop_record RECORD;
  purchase_totals RECORD;
  aggregate_totals RECORD;
BEGIN
  FOR shop_record IN
    SELECT DISTINCT purchase."shopId"
    FROM "billing"."RecoveryCreditPurchase" AS purchase
    WHERE purchase."status"::text IN ('ACTIVE', 'REFUNDED')
  LOOP
    SELECT
      COALESCE(SUM(purchase."creditsGranted" - purchase."refundedQuantity"), 0)::INTEGER AS granted,
      COALESCE(SUM(purchase."committedQuantity"), 0)::INTEGER AS committed,
      COALESCE(SUM(purchase."reservedQuantity"), 0)::INTEGER AS reserved,
      COALESCE(SUM(purchase."refundingQuantity"), 0)::INTEGER AS refunding
    INTO purchase_totals
    FROM "billing"."RecoveryCreditPurchase" AS purchase
    WHERE purchase."shopId" = shop_record."shopId"
      AND purchase."status"::text IN ('ACTIVE', 'REFUNDED');

    SELECT
      COALESCE(counter."grantedQuantity", 0)::INTEGER AS granted,
      COALESCE(counter."committedQuantity", 0)::INTEGER AS committed,
      COALESCE(counter."reservedQuantity", 0)::INTEGER AS reserved,
      COALESCE(counter."refundingQuantity", 0)::INTEGER AS refunding
    INTO aggregate_totals
    FROM "billing"."ShopEntitlementCounter" AS counter
    WHERE counter."shopId" = shop_record."shopId"
      AND counter."counter" = 'PURCHASED_RECOVERY_CREDITS';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot reconcile purchased-credit aggregate for shop %: counter is missing', shop_record."shopId";
    END IF;

    IF ROW(purchase_totals.granted, purchase_totals.committed, purchase_totals.reserved, purchase_totals.refunding)
       IS DISTINCT FROM ROW(aggregate_totals.granted, aggregate_totals.committed, aggregate_totals.reserved, aggregate_totals.refunding) THEN
      RAISE EXCEPTION 'Cannot reconcile purchased-credit aggregate for shop % without guessing', shop_record."shopId";
    END IF;
  END LOOP;
END $$;

ALTER TABLE "billing"."RecoveryCreditPurchase"
ADD CONSTRAINT "RecoveryCreditPurchase_lot_quantities_non_negative"
CHECK (
  "committedQuantity" >= 0
  AND "reservedQuantity" >= 0
  AND "refundingQuantity" >= 0
  AND "refundedQuantity" >= 0
  AND "version" >= 0
),
ADD CONSTRAINT "RecoveryCreditPurchase_lot_quantities_within_grant"
CHECK ("committedQuantity" + "reservedQuantity" + "refundingQuantity" + "refundedQuantity" <= "creditsGranted");

ALTER TABLE "billing"."RecoveryCreditRefund"
ALTER COLUMN "purchaseCreditsGrantedSnapshot" SET NOT NULL,
ALTER COLUMN "creditsRequested" SET NOT NULL,
ADD CONSTRAINT "RecoveryCreditRefund_quantities_positive"
CHECK (
  "purchaseCreditsGrantedSnapshot" > 0
  AND "creditsRequested" > 0
  AND ("creditsApproved" IS NULL OR "creditsApproved" > 0)
  AND ("creditsRefunded" IS NULL OR "creditsRefunded" > 0)
  AND ("creditsApproved" IS NULL OR "creditsApproved" <= "creditsRequested")
  AND ("creditsRefunded" IS NULL OR "creditsRefunded" <= "creditsApproved")
);

CREATE INDEX "RecoveryCreditPurchase_shopId_status_activatedAt_createdAt_id_idx"
ON "billing"."RecoveryCreditPurchase"("shopId", "status", "activatedAt", "createdAt", "id");
CREATE INDEX "RecoveryCreditRefund_purchaseId_status_createdAt_idx"
ON "billing"."RecoveryCreditRefund"("purchaseId", "status", "createdAt");
CREATE INDEX "UsageReservation_purchasedCreditPurchaseId_status_idx"
ON "billing"."UsageReservation"("purchasedCreditPurchaseId", "status");

ALTER TABLE "billing"."UsageReservation"
ADD CONSTRAINT "UsageReservation_purchasedCreditPurchaseId_fkey"
FOREIGN KEY ("purchasedCreditPurchaseId") REFERENCES "billing"."RecoveryCreditPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;