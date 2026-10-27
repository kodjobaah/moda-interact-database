BEGIN;

ALTER TABLE "shopify"."ShopSettings"
  ADD COLUMN "notifyOnInitialRecoveryOutreach" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "support"."MerchantSupportMessage"
  ADD COLUMN "checkoutRecoveryId" TEXT;

CREATE INDEX "MerchantSupportMessage_checkoutRecoveryId_idx"
  ON "support"."MerchantSupportMessage"("checkoutRecoveryId");

ALTER TABLE "support"."MerchantSupportMessage"
  ADD CONSTRAINT "MerchantSupportMessage_checkoutRecoveryId_fkey"
  FOREIGN KEY ("checkoutRecoveryId") REFERENCES "commerce"."CheckoutRecovery"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
