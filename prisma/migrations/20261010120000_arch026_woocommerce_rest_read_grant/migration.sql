-- ARCH-026-DATABASE-003: dedicated outbound, merchant-approved Woo REST read grant.
-- Additive only: inbound installation credentials, Woo onboarding and billing are unchanged.
BEGIN;

CREATE TYPE "woocommerce"."WooCommerceRestReadGrantStatus" AS ENUM
  ('ACTIVE', 'INVALID', 'REVOKED');
CREATE TYPE "woocommerce"."WooCommerceRestReadAttemptStatus" AS ENUM
  ('PENDING', 'SUCCEEDED', 'FAILED');

-- PostgreSQL requires an actual unique constraint/index on every referenced FK
-- column set, even when id and shopId are already separately unique.
CREATE UNIQUE INDEX "WooCommerceInstallation_id_shopId_key"
  ON "woocommerce"."WooCommerceInstallation"("id", "shopId");

CREATE TABLE "woocommerce"."WooCommerceRestReadAttempt" (
  "id" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "tokenDigest" BYTEA NOT NULL,
  "attemptSequence" BIGSERIAL NOT NULL,
  "credentialVersionSnapshot" INTEGER NOT NULL,
  "status" "woocommerce"."WooCommerceRestReadAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "consumptionTransactionId" BIGINT,
  "failureCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooCommerceRestReadAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WooCommerceRestReadAttempt_installation_fkey"
    FOREIGN KEY ("installationId", "shopId")
    REFERENCES "woocommerce"."WooCommerceInstallation"("id", "shopId")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooCommerceRestReadAttempt_digest_check"
    CHECK (octet_length("tokenDigest") = 32),
  CONSTRAINT "WooCommerceRestReadAttempt_version_check"
    CHECK ("credentialVersionSnapshot" > 0),
  CONSTRAINT "WooCommerceRestReadAttempt_expiry_check"
    CHECK ("expiresAt" > "createdAt"
      AND "expiresAt" <= "createdAt" + INTERVAL '15 minutes'),
  CONSTRAINT "WooCommerceRestReadAttempt_lifecycle_check"
    CHECK (
      ("status" = 'PENDING' AND "consumedAt" IS NULL
        AND "consumptionTransactionId" IS NULL AND "failureCode" IS NULL)
      OR ("status" = 'SUCCEEDED' AND "consumedAt" IS NOT NULL
        AND "consumptionTransactionId" IS NOT NULL AND "failureCode" IS NULL)
      OR ("status" = 'FAILED' AND "consumedAt" IS NOT NULL
          AND "consumptionTransactionId" IS NOT NULL AND "failureCode" IS NOT NULL AND btrim("failureCode") <> '')
    ),
  CONSTRAINT "WooCommerceRestReadAttempt_consumption_time_check"
    CHECK ("consumedAt" IS NULL OR
      ("consumedAt" >= "createdAt" AND "consumedAt" <= "expiresAt"))
);

CREATE UNIQUE INDEX "WooCommerceRestReadAttempt_tokenDigest_key"
  ON "woocommerce"."WooCommerceRestReadAttempt"("tokenDigest");
CREATE UNIQUE INDEX "WooCommerceRestReadAttempt_attemptSequence_key"
  ON "woocommerce"."WooCommerceRestReadAttempt"("attemptSequence");
CREATE INDEX "WooCommerceRestReadAttempt_installation_pending_idx"
  ON "woocommerce"."WooCommerceRestReadAttempt"("installationId", "status", "expiresAt");
CREATE INDEX "WooCommerceRestReadAttempt_createdAt_idx"
  ON "woocommerce"."WooCommerceRestReadAttempt"("createdAt");

CREATE TABLE "woocommerce"."WooCommerceRestReadGrant" (
  "id" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "authorizationAttemptId" TEXT NOT NULL,
  "authorizationAttemptSequence" BIGINT NOT NULL,
  "credentialVersionSnapshot" INTEGER NOT NULL,
  "rotationVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "woocommerce"."WooCommerceRestReadGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "credentialCiphertext" BYTEA NOT NULL,
  "credentialNonce" BYTEA NOT NULL,
  "credentialAuthTag" BYTEA NOT NULL,
  "encryptionKeyId" VARCHAR(128) NOT NULL,
  "providerKeyId" VARCHAR(128) NOT NULL,
  "authorizedScope" VARCHAR(16) NOT NULL,
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "invalidatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WooCommerceRestReadGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WooCommerceRestReadGrant_installation_fkey"
    FOREIGN KEY ("installationId", "shopId")
    REFERENCES "woocommerce"."WooCommerceInstallation"("id", "shopId")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- Deleting the successful attempt also removes its grant (fail closed).
  -- Only unselected attempts should be purged during attempt retention cleanup.
  CONSTRAINT "WooCommerceRestReadGrant_attempt_fkey"
    FOREIGN KEY ("authorizationAttemptId")
    REFERENCES "woocommerce"."WooCommerceRestReadAttempt"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooCommerceRestReadGrant_scope_check"
    CHECK ("authorizedScope" = 'read'),
  CONSTRAINT "WooCommerceRestReadGrant_envelope_check"
    CHECK (octet_length("credentialCiphertext") BETWEEN 1 AND 8192
      AND octet_length("credentialNonce") = 12
      AND octet_length("credentialAuthTag") = 16
      AND btrim("encryptionKeyId") <> ''
      AND btrim("providerKeyId") <> ''),
  CONSTRAINT "WooCommerceRestReadGrant_version_check"
    CHECK ("rotationVersion" > 0 AND "credentialVersionSnapshot" > 0
      AND "authorizationAttemptSequence" > 0),
  CONSTRAINT "WooCommerceRestReadGrant_lifecycle_check"
    CHECK (
      ("status" = 'ACTIVE' AND "revokedAt" IS NULL AND "invalidatedAt" IS NULL)
      OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "invalidatedAt" IS NULL)
      OR ("status" = 'INVALID' AND "invalidatedAt" IS NOT NULL AND "revokedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "WooCommerceRestReadGrant_installationId_key"
  ON "woocommerce"."WooCommerceRestReadGrant"("installationId");
-- Prisma's composite one-to-one relation requires this explicit candidate key.
CREATE UNIQUE INDEX "WooCommerceRestReadGrant_installationId_shopId_key"
  ON "woocommerce"."WooCommerceRestReadGrant"("installationId", "shopId");
CREATE UNIQUE INDEX "WooCommerceRestReadGrant_authorizationAttemptId_key"
  ON "woocommerce"."WooCommerceRestReadGrant"("authorizationAttemptId");
CREATE INDEX "WooCommerceRestReadGrant_shop_status_idx"
  ON "woocommerce"."WooCommerceRestReadGrant"("shopId", "status");

-- A pending attempt is a single-use bearer: attempts cannot be reparented,
-- refreshed, or changed from a terminal status back to pending.
CREATE FUNCTION "woocommerce"."arch026_rest_read_attempt_guard"()
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

CREATE TRIGGER "arch026_rest_read_attempt_guard"
  BEFORE INSERT OR UPDATE ON "woocommerce"."WooCommerceRestReadAttempt"
  FOR EACH ROW EXECUTE FUNCTION "woocommerce"."arch026_rest_read_attempt_guard"();

-- A SUCCESSFUL consumption and the corresponding grant must commit together.
-- Without this deferred check an application could consume a bearer in one
-- transaction then issue an outbound credential in a second transaction.
CREATE FUNCTION "woocommerce"."arch026_rest_read_attempt_commit_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "woocommerce"."WooCommerceRestReadGrant" selected_grant
    WHERE selected_grant."authorizationAttemptId" = NEW."id"
      AND selected_grant."installationId" = NEW."installationId"
      AND selected_grant."shopId" = NEW."shopId"
      AND selected_grant."authorizationAttemptSequence" = NEW."attemptSequence"
  ) THEN
    RAISE EXCEPTION 'Woo REST successful attempt requires committed grant in same transaction'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "arch026_rest_read_attempt_commit_guard"
  AFTER UPDATE ON "woocommerce"."WooCommerceRestReadAttempt"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."status" = 'SUCCEEDED')
  EXECUTE FUNCTION "woocommerce"."arch026_rest_read_attempt_commit_guard"();

-- The selected grant is exactly one row per installation. An older successful
-- callback may not overwrite a newer selected attempt, even under concurrency.
CREATE FUNCTION "woocommerce"."arch026_rest_read_grant_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_row "woocommerce"."WooCommerceRestReadAttempt"%ROWTYPE;
  current_version INTEGER;
  current_status "woocommerce"."WooCommerceInstallationStatus";
  shop_platform "commerce"."ShopPlatform";
  replacing BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."id", NEW."installationId", NEW."shopId", NEW."createdAt") IS DISTINCT FROM
       (OLD."id", OLD."installationId", OLD."shopId", OLD."createdAt") THEN
      RAISE EXCEPTION 'Woo REST grant identity is immutable' USING ERRCODE = '23514';
    END IF;
    replacing := NEW."authorizationAttemptId" IS DISTINCT FROM OLD."authorizationAttemptId";
    IF replacing THEN
      IF NEW."authorizationAttemptSequence" <= OLD."authorizationAttemptSequence" OR
         NEW."rotationVersion" <> OLD."rotationVersion" + 1 OR NEW."status" <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Woo REST grant rotation must use a newer successful attempt'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF OLD."status" <> 'ACTIVE' OR NEW."status" NOT IN ('REVOKED', 'INVALID') OR
         (NEW."authorizationAttemptSequence", NEW."credentialVersionSnapshot", NEW."rotationVersion",
          NEW."credentialCiphertext", NEW."credentialNonce", NEW."credentialAuthTag",
          NEW."encryptionKeyId", NEW."providerKeyId", NEW."authorizedScope", NEW."verifiedAt", NEW."grantedAt")
         IS DISTINCT FROM
         (OLD."authorizationAttemptSequence", OLD."credentialVersionSnapshot", OLD."rotationVersion",
          OLD."credentialCiphertext", OLD."credentialNonce", OLD."credentialAuthTag",
          OLD."encryptionKeyId", OLD."providerKeyId", OLD."authorizedScope", OLD."verifiedAt", OLD."grantedAt") THEN
        RAISE EXCEPTION 'Woo REST grant may only be revoked or invalidated without new consent'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
  ELSIF NEW."rotationVersion" <> 1 OR NEW."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Woo REST first grant must be active at version one' USING ERRCODE = '23514';
  END IF;

  SELECT installation."credentialVersion", installation."status", shop."platform"
    INTO current_version, current_status, shop_platform
  FROM "woocommerce"."WooCommerceInstallation" installation
  JOIN "commerce"."Shop" shop ON shop."id" = installation."shopId"
  WHERE installation."id" = NEW."installationId"
    AND installation."shopId" = NEW."shopId"
  FOR SHARE OF installation, shop;
  IF NOT FOUND OR shop_platform <> 'WOOCOMMERCE' OR current_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Woo REST grant requires active Woo installation' USING ERRCODE = '23514';
  END IF;
  IF NEW."credentialVersionSnapshot" <> current_version OR NEW."authorizedScope" <> 'read' THEN
    RAISE EXCEPTION 'Woo REST grant has invalid installation version or scope' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO attempt_row
  FROM "woocommerce"."WooCommerceRestReadAttempt"
  WHERE "id" = NEW."authorizationAttemptId"
  FOR SHARE;
  IF NOT FOUND OR attempt_row."installationId" <> NEW."installationId" OR
     attempt_row."shopId" <> NEW."shopId" OR
     attempt_row."credentialVersionSnapshot" <> NEW."credentialVersionSnapshot" OR
     attempt_row."attemptSequence" <> NEW."authorizationAttemptSequence" OR
     attempt_row."status" <> 'SUCCEEDED' OR
     attempt_row."consumptionTransactionId" <> txid_current() OR
     attempt_row."consumedAt" IS NULL OR attempt_row."consumedAt" > attempt_row."expiresAt" OR
     clock_timestamp() > attempt_row."expiresAt" THEN
    RAISE EXCEPTION 'Woo REST grant requires matching successful unexpired attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "arch026_rest_read_grant_guard"
  BEFORE INSERT OR UPDATE ON "woocommerce"."WooCommerceRestReadGrant"
  FOR EACH ROW EXECUTE FUNCTION "woocommerce"."arch026_rest_read_grant_guard"();

COMMIT;
