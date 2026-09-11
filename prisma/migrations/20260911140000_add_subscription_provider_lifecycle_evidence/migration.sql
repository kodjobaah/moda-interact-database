-- Persist Shopify subscription freeze state and the latest provider lifecycle evidence.
CREATE TYPE "billing"."ProviderSubscriptionLifecycleState" AS ENUM (
  'CREATED',
  'UPDATED',
  'CANCELLATION_SCHEDULED',
  'CANCELED',
  'FROZEN',
  'UNFROZEN'
);

ALTER TYPE "billing"."SubscriptionProjectionStatus" ADD VALUE 'FROZEN';

ALTER TABLE "billing"."Subscription"
ADD COLUMN "lastProviderLifecycleState" "billing"."ProviderSubscriptionLifecycleState",
ADD COLUMN "lastProviderLifecycleEventId" TEXT,
ADD COLUMN "lastProviderLifecycleEventAt" TIMESTAMP(3);