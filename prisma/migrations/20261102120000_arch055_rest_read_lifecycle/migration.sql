BEGIN;

ALTER TABLE "woocommerce"."WooCommerceRestReadAttempt"
  DROP CONSTRAINT "WooCommerceRestReadAttempt_consumption_time_check";
ALTER TABLE "woocommerce"."WooCommerceRestReadAttempt"
  ADD CONSTRAINT "WooCommerceRestReadAttempt_consumption_time_check"
  CHECK (
    "consumedAt" IS NULL OR
    ("consumedAt" >= "createdAt" AND
      ("status" = 'FAILED' OR "consumedAt" <= "expiresAt"))
  );

CREATE OR REPLACE FUNCTION "woocommerce"."arch026_rest_read_attempt_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_version INTEGER;
  current_status "woocommerce"."WooCommerceInstallationStatus";
  shop_platform "commerce"."ShopPlatform";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."id", NEW."installationId", NEW."shopId", NEW."tokenDigest",
        NEW."attemptSequence", NEW."credentialVersionSnapshot", NEW."expiresAt", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."id", OLD."installationId", OLD."shopId", OLD."tokenDigest",
        OLD."attemptSequence", OLD."credentialVersionSnapshot", OLD."expiresAt", OLD."createdAt") THEN
      RAISE EXCEPTION 'Woo REST authorisation attempt identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" <> 'PENDING' OR NEW."status" = 'PENDING' THEN
      RAISE EXCEPTION 'Woo REST authorisation attempt is single use' USING ERRCODE = '23514';
    END IF;
    -- Failure terminalisation is not bearer consumption that can mint a grant.
    -- Preserve identity and single-use checks above; lifecycle CHECK still requires failureCode.
    IF NEW."status" = 'FAILED' THEN
      IF NEW."consumedAt" IS NULL THEN
        RAISE EXCEPTION 'Woo REST failed attempt requires terminal timestamp' USING ERRCODE = '23514';
      END IF;
      NEW."consumptionTransactionId" := txid_current();
      RETURN NEW;
    END IF;
    IF NEW."consumedAt" IS NULL OR clock_timestamp() > NEW."expiresAt" THEN
      RAISE EXCEPTION 'Woo REST authorisation attempt expired or not consumed' USING ERRCODE = '23514';
    END IF;
    -- A grant may only be minted by the SAME database transaction that consumed
    -- the bearer. Once committed, the bearer cannot mint another grant even if
    -- a selected grant was subsequently deleted.
    NEW."consumptionTransactionId" := txid_current();
  ELSIF NEW."status" <> 'PENDING' OR NEW."consumedAt" IS NOT NULL OR
        NEW."consumptionTransactionId" IS NOT NULL THEN
    RAISE EXCEPTION 'Woo REST authorisation attempt must begin pending' USING ERRCODE = '23514';
  END IF;

  SELECT installation."credentialVersion", installation."status", shop."platform"
    INTO current_version, current_status, shop_platform
  FROM "woocommerce"."WooCommerceInstallation" installation
  JOIN "commerce"."Shop" shop ON shop."id" = installation."shopId"
  WHERE installation."id" = NEW."installationId"
    AND installation."shopId" = NEW."shopId"
  FOR SHARE OF installation, shop;
  IF NOT FOUND OR shop_platform <> 'WOOCOMMERCE' OR current_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Woo REST authorisation requires active Woo installation' USING ERRCODE = '23514';
  END IF;
  IF NEW."credentialVersionSnapshot" <> current_version THEN
    RAISE EXCEPTION 'Woo REST authorisation installation generation is stale' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."expiresAt" <= clock_timestamp() THEN
    RAISE EXCEPTION 'Woo REST authorisation attempt is already expired' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
