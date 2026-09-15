ALTER TABLE "billing"."RecoveryCreditPurchase"
  ALTER COLUMN "providerUsageQuantityBeforeSnapshot" TYPE DECIMAL(65, 30)
    USING "providerUsageQuantityBeforeSnapshot"::DECIMAL(65, 30),
  ALTER COLUMN "providerUsageQuantityAfterSnapshot" TYPE DECIMAL(65, 30)
    USING "providerUsageQuantityAfterSnapshot"::DECIMAL(65, 30);