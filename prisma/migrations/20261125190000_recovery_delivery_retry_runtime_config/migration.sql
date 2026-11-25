-- Operational retry policy is stored in the existing platform singleton.
-- Existing installations receive defaults; no historical retry or dispatch is created.
BEGIN;
ALTER TABLE "public"."BackgroundRuntimeConfig"
  ADD COLUMN "recoveryDeliveryTemporaryRetryDelayMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "recoveryDeliveryRateLimitRetryDelayMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "recoveryDeliveryMarketingRetryDelayMinutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN "recoveryDeliveryMaxRetries" INTEGER NOT NULL DEFAULT 3,
  ADD CONSTRAINT "BackgroundRuntimeConfig_delivery_temp_delay_check" CHECK ("recoveryDeliveryTemporaryRetryDelayMinutes" >= 1),
  ADD CONSTRAINT "BackgroundRuntimeConfig_delivery_rate_delay_check" CHECK ("recoveryDeliveryRateLimitRetryDelayMinutes" >= 1),
  ADD CONSTRAINT "BackgroundRuntimeConfig_delivery_marketing_delay_check" CHECK ("recoveryDeliveryMarketingRetryDelayMinutes" >= 1440),
  ADD CONSTRAINT "BackgroundRuntimeConfig_delivery_max_retries_check" CHECK ("recoveryDeliveryMaxRetries" >= 0);
COMMIT;
