-- Add durable scheduling state for pending subscription reconciliation.
ALTER TABLE "billing"."Subscription" ADD COLUMN "nextReconcileAt" TIMESTAMP(3);

CREATE INDEX "Subscription_nextReconcileAt_idx" ON "billing"."Subscription"("nextReconcileAt");