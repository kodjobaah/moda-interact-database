CREATE TABLE "billing"."BillingPeriod" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing"."UsageEvent" ADD COLUMN "billingPeriodId" TEXT;

CREATE UNIQUE INDEX "BillingPeriod_shopId_periodStart_key" ON "billing"."BillingPeriod"("shopId", "periodStart");
CREATE INDEX "BillingPeriod_shopId_periodStart_periodEnd_idx" ON "billing"."BillingPeriod"("shopId", "periodStart", "periodEnd");
CREATE INDEX "UsageEvent_billingPeriodId_idx" ON "billing"."UsageEvent"("billingPeriodId");

ALTER TABLE "billing"."BillingPeriod" ADD CONSTRAINT "BillingPeriod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."UsageEvent" ADD CONSTRAINT "UsageEvent_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "billing"."BillingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;