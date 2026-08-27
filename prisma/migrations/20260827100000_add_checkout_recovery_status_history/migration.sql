CREATE TABLE "commerce"."CheckoutRecoveryStatusHistory" (
    "id" TEXT NOT NULL,
    "checkoutRecoveryId" TEXT NOT NULL,
    "fromStatus" "commerce"."CheckoutRecoveryStatus",
    "toStatus" "commerce"."CheckoutRecoveryStatus" NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutRecoveryStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutRecoveryStatusHistory_checkoutRecoveryId_occurredAt_idx"
ON "commerce"."CheckoutRecoveryStatusHistory"("checkoutRecoveryId", "occurredAt");

CREATE INDEX "CheckoutRecoveryStatusHistory_toStatus_occurredAt_idx"
ON "commerce"."CheckoutRecoveryStatusHistory"("toStatus", "occurredAt");

ALTER TABLE "commerce"."CheckoutRecoveryStatusHistory"
ADD CONSTRAINT "CheckoutRecoveryStatusHistory_checkoutRecoveryId_fkey"
FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id")
ON DELETE CASCADE ON UPDATE CASCADE;