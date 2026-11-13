-- ARCH-075 additive app-quota state; unrelated pre-existing Prisma naming drift excluded.
-- CreateTable
CREATE TABLE "whatsapp"."MetaTemplateAppOperationState" (
    "environment" "commerce"."CommerceEnvironment" NOT NULL,
    "appId" VARCHAR(32) NOT NULL,
    "cooldownUntil" TIMESTAMPTZ(3),
    "consecutiveThrottleCount" INTEGER NOT NULL DEFAULT 0,
    "lastThrottleAt" TIMESTAMPTZ(3),
    "leaseOwnerToken" VARCHAR(128),
    "leaseGeneration" BIGINT NOT NULL DEFAULT 0,
    "leaseAcquiredAt" TIMESTAMPTZ(3),
    "leaseUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaTemplateAppOperationState_pkey" PRIMARY KEY ("environment","appId")
);

ALTER TABLE "whatsapp"."MetaTemplateAppOperationState"
  ADD CONSTRAINT "MetaTemplateAppOperationState_appId_check"
    CHECK ("appId" ~ '^[0-9]{1,32}$'),
  ADD CONSTRAINT "MetaTemplateAppOperationState_throttle_count_check"
    CHECK ("consecutiveThrottleCount" BETWEEN 0 AND 31),
  ADD CONSTRAINT "MetaTemplateAppOperationState_generation_check"
    CHECK ("leaseGeneration" >= 0),
  ADD CONSTRAINT "MetaTemplateAppOperationState_lease_check"
    CHECK (
      ("leaseOwnerToken" IS NULL AND "leaseAcquiredAt" IS NULL AND "leaseUntil" IS NULL)
      OR
      ("leaseOwnerToken" IS NOT NULL AND length("leaseOwnerToken") BETWEEN 1 AND 128
       AND "leaseGeneration" > 0 AND "leaseAcquiredAt" IS NOT NULL
       AND "leaseUntil" IS NOT NULL AND "leaseUntil" > "leaseAcquiredAt")
    );

CREATE FUNCTION "whatsapp"."guard_meta_template_app_operation_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'META_APP_OPERATION_STATE_DELETE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF NEW."environment" IS DISTINCT FROM OLD."environment"
     OR NEW."appId" IS DISTINCT FROM OLD."appId" THEN
    RAISE EXCEPTION 'META_APP_OPERATION_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW."leaseGeneration" < OLD."leaseGeneration" THEN
    RAISE EXCEPTION 'META_APP_OPERATION_GENERATION_REGRESSION' USING ERRCODE = '23514';
  END IF;
  IF NEW."leaseOwnerToken" IS NOT NULL AND
     (NEW."leaseOwnerToken" IS DISTINCT FROM OLD."leaseOwnerToken"
      OR NEW."leaseAcquiredAt" IS DISTINCT FROM OLD."leaseAcquiredAt") THEN
    IF OLD."leaseOwnerToken" IS NOT NULL AND OLD."leaseUntil" > clock_timestamp() THEN
      RAISE EXCEPTION 'META_APP_OPERATION_LEASE_ACTIVE' USING ERRCODE = '23514';
    END IF;
    IF NEW."leaseGeneration" <= OLD."leaseGeneration" THEN
      RAISE EXCEPTION 'META_APP_OPERATION_NEW_LEASE_GENERATION_REQUIRED' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."leaseGeneration" <> OLD."leaseGeneration" THEN
    RAISE EXCEPTION 'META_APP_OPERATION_NEW_LEASE_GENERATION_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF OLD."cooldownUntil" > clock_timestamp() AND
     (NEW."cooldownUntil" IS NULL OR NEW."cooldownUntil" < OLD."cooldownUntil") THEN
    RAISE EXCEPTION 'META_APP_OPERATION_COOLDOWN_REGRESSION' USING ERRCODE = '23514';
  END IF;
  IF OLD."lastThrottleAt" IS NOT NULL AND
     (NEW."lastThrottleAt" IS NULL OR NEW."lastThrottleAt" < OLD."lastThrottleAt") THEN
    RAISE EXCEPTION 'META_APP_OPERATION_THROTTLE_TIME_REGRESSION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MetaTemplateAppOperationState_guard"
BEFORE UPDATE OR DELETE ON "whatsapp"."MetaTemplateAppOperationState"
FOR EACH ROW EXECUTE FUNCTION "whatsapp"."guard_meta_template_app_operation_state"();
