-- Add the period-scoped included-credit counter without rewriting existing reservations.
CREATE TYPE "billing"."BillingPeriodEntitlementCounterKind" AS ENUM ('INCLUDED_RECOVERY_CREDITS');

CREATE TABLE "billing"."BillingPeriodEntitlementCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billingPeriodId" TEXT NOT NULL,
    "counter" "billing"."BillingPeriodEntitlementCounterKind" NOT NULL,
    "grantedQuantity" INTEGER NOT NULL DEFAULT 0,
    "committedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "forfeitedQuantity" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPeriodEntitlementCounter_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing"."UsageReservation"
ALTER COLUMN "counterId" DROP NOT NULL,
ADD COLUMN "billingPeriodEntitlementCounterId" TEXT;

CREATE UNIQUE INDEX "BillingPeriodEntitlementCounter_billingPeriodId_counter_key"
ON "billing"."BillingPeriodEntitlementCounter"("billingPeriodId", "counter");
CREATE INDEX "BillingPeriodEntitlementCounter_shopId_billingPeriodId_idx"
ON "billing"."BillingPeriodEntitlementCounter"("shopId", "billingPeriodId");
CREATE INDEX "UsageReservation_billingPeriodEntitlementCounterId_idx"
ON "billing"."UsageReservation"("billingPeriodEntitlementCounterId");

ALTER TABLE "billing"."BillingPeriodEntitlementCounter"
ADD CONSTRAINT "BillingPeriodEntitlementCounter_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "BillingPeriodEntitlementCounter_billingPeriodId_fkey"
FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "BillingPeriodEntitlementCounter_grantedQuantity_non_negative"
CHECK ("grantedQuantity" >= 0),
ADD CONSTRAINT "BillingPeriodEntitlementCounter_committedQuantity_non_negative"
CHECK ("committedQuantity" >= 0),
ADD CONSTRAINT "BillingPeriodEntitlementCounter_reservedQuantity_non_negative"
CHECK ("reservedQuantity" >= 0),
ADD CONSTRAINT "BillingPeriodEntitlementCounter_forfeitedQuantity_non_negative"
CHECK ("forfeitedQuantity" >= 0),
ADD CONSTRAINT "BillingPeriodEntitlementCounter_capacity"
CHECK ("committedQuantity" + "reservedQuantity" + "forfeitedQuantity" <= "grantedQuantity");

ALTER TABLE "billing"."UsageReservation"
ADD CONSTRAINT "UsageReservation_billingPeriodEntitlementCounterId_fkey"
FOREIGN KEY ("billingPeriodEntitlementCounterId") REFERENCES "billing"."BillingPeriodEntitlementCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "UsageReservation_counter_family_xor"
CHECK (("counterId" IS NOT NULL) <> ("billingPeriodEntitlementCounterId" IS NOT NULL));