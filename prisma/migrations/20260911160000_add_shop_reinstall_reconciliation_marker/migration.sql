ALTER TABLE "commerce"."Shop" ADD COLUMN "reinstallPendingAt" TIMESTAMP(3);

CREATE INDEX "Shop_status_reinstallPendingAt_idx" ON "commerce"."Shop"("status", "reinstallPendingAt");