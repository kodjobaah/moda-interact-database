-- ARCH-045-DATABASE-002 / ARCH-046 consent foundation (unmerged Attempt 1).
-- Exactly one new table and consent fields on existing CustomerPhone. Existing
-- rows remain UNKNOWN; phone matching alone never changes permission.
CREATE TYPE "commerce"."WhatsAppRecoveryConsentDecision" AS ENUM ('UNKNOWN', 'GRANTED', 'REVOKED');
CREATE TYPE "commerce"."WhatsAppRecoveryConsentSource" AS ENUM ('SHOPIFY_NATIVE', 'WOO_MODA_CHECKBOX');
CREATE TYPE "commerce"."WhatsAppRecoveryNoContactReason" AS ENUM ('CUSTOMER_STOP', 'MERCHANT_OPT_OUT');
CREATE TYPE "commerce"."WhatsAppConsentPurpose" AS ENUM ('WHATSAPP_CHECKOUT_RECOVERY');
CREATE TYPE "commerce"."WhatsAppConsentEvidenceDecision" AS ENUM ('GRANT', 'REVOKE');

-- Composite indexes support tenant-safe evidence foreign keys without adding
-- any columns to Customer (the existing shopId remains the tenant boundary).
CREATE UNIQUE INDEX "Customer_id_shopId_key" ON "commerce"."Customer" ("id", "shopId");

ALTER TABLE "commerce"."CustomerPhone"
  ADD COLUMN "whatsappCanonicalPhone" VARCHAR(15),
  ADD COLUMN "whatsappPhoneVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "whatsappConsentPurpose" "commerce"."WhatsAppConsentPurpose" NOT NULL DEFAULT 'WHATSAPP_CHECKOUT_RECOVERY',
  ADD COLUMN "whatsappConsentDecision" "commerce"."WhatsAppRecoveryConsentDecision" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "whatsappConsentSource" "commerce"."WhatsAppRecoveryConsentSource",
  ADD COLUMN "whatsappConsentProviderObservedAt" TIMESTAMPTZ(3),
  ADD COLUMN "whatsappConsentVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "whatsappConsentRevision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "whatsappConsentDecisionSequence" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "whatsappNoContact" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "whatsappNoContactReason" "commerce"."WhatsAppRecoveryNoContactReason",
  ADD COLUMN "whatsappNoContactAt" TIMESTAMPTZ(3),
  ADD COLUMN "whatsappNoContactRevision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "whatsappNoContactClearedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "CustomerPhone_canonical_check" CHECK (
    "whatsappCanonicalPhone" IS NULL OR "whatsappCanonicalPhone" COLLATE "C" ~ '^[1-9][0-9]{1,14}$'
  ),
  ADD CONSTRAINT "CustomerPhone_consent_revision_check" CHECK (
    "whatsappConsentRevision" >= 0 AND "whatsappConsentDecisionSequence" >= 0
    AND "whatsappNoContactRevision" >= 0
  ),
  ADD CONSTRAINT "CustomerPhone_verified_decision_check" CHECK (
    "whatsappConsentDecision" = 'UNKNOWN' OR (
      "whatsappConsentSource" IS NOT NULL
      AND "whatsappConsentProviderObservedAt" IS NOT NULL
      AND "whatsappConsentRevision" > 0 AND "whatsappConsentDecisionSequence" > 0
    )
  ),
  ADD CONSTRAINT "CustomerPhone_verified_grant_check" CHECK (
    "whatsappConsentDecision" <> 'GRANTED' OR (
      "endedAt" IS NULL AND "whatsappCanonicalPhone" IS NOT NULL
      AND "whatsappPhoneVerifiedAt" IS NOT NULL
      AND "whatsappConsentSource" IS NOT NULL
      AND "whatsappConsentVerifiedAt" IS NOT NULL
      AND "whatsappConsentProviderObservedAt" IS NOT NULL
      AND "whatsappConsentVerifiedAt" >= "whatsappConsentProviderObservedAt"
      AND "whatsappConsentVerifiedAt" >= "whatsappPhoneVerifiedAt"
      AND "whatsappConsentRevision" > 0 AND "whatsappConsentDecisionSequence" > 0
    )
  ),
  ADD CONSTRAINT "CustomerPhone_no_contact_check" CHECK (
    (NOT "whatsappNoContact" AND "whatsappNoContactReason" IS NULL)
    OR ("whatsappNoContact" AND "whatsappNoContactReason" IS NOT NULL
      AND "whatsappNoContactAt" IS NOT NULL AND "whatsappNoContactRevision" > 0)
  );
CREATE UNIQUE INDEX "CustomerPhone_id_customerId_key"
  ON "commerce"."CustomerPhone" ("id", "customerId");
CREATE INDEX "CustomerPhone_customer_canonical_active_idx"
  ON "commerce"."CustomerPhone" ("customerId", "whatsappCanonicalPhone", "endedAt");
CREATE INDEX "CustomerPhone_canonical_lookup_idx"
  ON "commerce"."CustomerPhone" ("whatsappCanonicalPhone", "endedAt", "customerId");
-- Do not duplicate a current number on the same Customer. A Customer may
-- have more than one distinct active phone. A given (shop,phone) can still
-- match multiple Customers and must then fail closed at the API boundary.
CREATE UNIQUE INDEX "CustomerPhone_unique_active_canonical_per_customer_key"
  ON "commerce"."CustomerPhone" ("customerId", "whatsappCanonicalPhone")
  WHERE "endedAt" IS NULL AND "whatsappCanonicalPhone" IS NOT NULL;

CREATE TABLE "commerce"."WhatsAppConsentEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "eventId" VARCHAR(128) NOT NULL,
  "payloadDigest" BYTEA NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerPhoneId" TEXT NOT NULL,
  "canonicalPhone" VARCHAR(15) NOT NULL,
  "purpose" "commerce"."WhatsAppConsentPurpose" NOT NULL DEFAULT 'WHATSAPP_CHECKOUT_RECOVERY',
  "decision" "commerce"."WhatsAppConsentEvidenceDecision" NOT NULL,
  "decisionSequence" BIGINT NOT NULL,
  "phoneConsentRevision" BIGINT NOT NULL,
  "decisionAt" TIMESTAMPTZ(3) NOT NULL,
  "disclosureText" VARCHAR(4000),
  "disclosureVersion" VARCHAR(128),
  "disclosureLocale" VARCHAR(64),
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppConsentEvidence_shop_fkey" FOREIGN KEY ("shopId")
    REFERENCES "commerce"."Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WhatsAppConsentEvidence_installation_fkey" FOREIGN KEY ("installationId", "shopId")
    REFERENCES "woocommerce"."WooCommerceInstallation" ("id", "shopId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WhatsAppConsentEvidence_customer_fkey" FOREIGN KEY ("customerId", "shopId")
    REFERENCES "commerce"."Customer" ("id", "shopId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WhatsAppConsentEvidence_phone_fkey" FOREIGN KEY ("customerPhoneId", "customerId")
    REFERENCES "commerce"."CustomerPhone" ("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WhatsAppConsentEvidence_verified_check" CHECK (
    octet_length("payloadDigest") = 32 AND "decisionSequence" > 0 AND "phoneConsentRevision" > 0
    AND "eventId" <> '' AND "canonicalPhone" COLLATE "C" ~ '^[1-9][0-9]{1,14}$'
    AND ("decision" <> 'GRANT' OR (
      NULLIF(btrim("disclosureText"), '') IS NOT NULL
      AND NULLIF(btrim("disclosureVersion"), '') IS NOT NULL
      AND NULLIF(btrim("disclosureLocale"), '') IS NOT NULL
    ))
  )
);
CREATE UNIQUE INDEX "WhatsAppConsentEvidence_shop_event_key"
  ON "commerce"."WhatsAppConsentEvidence" ("shopId", "eventId");
-- A successful consent revision can have only one matching Woo audit fact,
-- even when two events race with different eventIds.
CREATE UNIQUE INDEX "WhatsAppConsentEvidence_phone_revision_key"
  ON "commerce"."WhatsAppConsentEvidence" ("customerPhoneId", "phoneConsentRevision");
CREATE INDEX "WhatsAppConsentEvidence_customer_history_idx"
  ON "commerce"."WhatsAppConsentEvidence" ("shopId", "customerId", "recordedAt");
CREATE INDEX "WhatsAppConsentEvidence_installation_history_idx"
  ON "commerce"."WhatsAppConsentEvidence" ("installationId", "recordedAt");

-- Authentication, national-phone normalisation and shop-scoped matching are
-- API/Background responsibilities. The DB enforces exact recipient eligibility,
-- revision monotonicity and active Woo installation on accepted writes.
CREATE FUNCTION "commerce".arch045_customer_phone_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_shop TEXT;
  platform "commerce"."ShopPlatform";
  is_decision_change BOOLEAN := FALSE;
BEGIN
  SELECT c."shopId", s."platform" INTO parent_shop, platform
    FROM "commerce"."Customer" c
    JOIN "commerce"."Shop" s ON s."id" = c."shopId"
    WHERE c."id" = NEW."customerId" FOR SHARE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CustomerPhone requires existing Customer' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
      RAISE EXCEPTION 'CustomerPhone cannot transfer between Customers' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentRevision" < OLD."whatsappConsentRevision"
      OR NEW."whatsappConsentDecisionSequence" < OLD."whatsappConsentDecisionSequence"
      OR NEW."whatsappNoContactRevision" < OLD."whatsappNoContactRevision" THEN
      RAISE EXCEPTION 'consent/override revisions cannot decrease' USING ERRCODE = '23514';
    END IF;
    IF (
      NEW."whatsappCanonicalPhone" IS DISTINCT FROM OLD."whatsappCanonicalPhone"
      OR NEW."whatsappPhoneVerifiedAt" IS DISTINCT FROM OLD."whatsappPhoneVerifiedAt"
      OR NEW."whatsappConsentPurpose" IS DISTINCT FROM OLD."whatsappConsentPurpose"
      OR NEW."whatsappConsentDecision" IS DISTINCT FROM OLD."whatsappConsentDecision"
      OR NEW."whatsappConsentSource" IS DISTINCT FROM OLD."whatsappConsentSource"
      OR NEW."whatsappConsentProviderObservedAt" IS DISTINCT FROM OLD."whatsappConsentProviderObservedAt"
      OR NEW."whatsappConsentVerifiedAt" IS DISTINCT FROM OLD."whatsappConsentVerifiedAt"
    ) AND NEW."whatsappConsentRevision" <> OLD."whatsappConsentRevision" + 1 THEN
      RAISE EXCEPTION 'consent change requires next revision' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentRevision" > OLD."whatsappConsentRevision" + 1 THEN
      RAISE EXCEPTION 'consent revision must not skip' USING ERRCODE = '23514';
    END IF;
    is_decision_change :=
      NEW."whatsappConsentDecision" IS DISTINCT FROM OLD."whatsappConsentDecision"
      OR NEW."whatsappConsentSource" IS DISTINCT FROM OLD."whatsappConsentSource"
      OR NEW."whatsappConsentProviderObservedAt" IS DISTINCT FROM OLD."whatsappConsentProviderObservedAt"
      OR NEW."whatsappConsentVerifiedAt" IS DISTINCT FROM OLD."whatsappConsentVerifiedAt";
    IF is_decision_change AND (
      NEW."whatsappConsentDecisionSequence" <= OLD."whatsappConsentDecisionSequence"
      OR NEW."whatsappConsentRevision" <> OLD."whatsappConsentRevision" + 1
    ) THEN
      RAISE EXCEPTION 'decision must advance sequence and revision' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentDecisionSequence" > OLD."whatsappConsentDecisionSequence" + 1 THEN
      RAISE EXCEPTION 'decision sequence must not skip' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentDecisionSequence" > OLD."whatsappConsentDecisionSequence"
      AND NEW."whatsappConsentRevision" <> OLD."whatsappConsentRevision" + 1 THEN
      RAISE EXCEPTION 'new decision sequence needs new revision' USING ERRCODE = '23514';
    END IF;
    IF OLD."whatsappConsentProviderObservedAt" IS NOT NULL
      AND NEW."whatsappConsentProviderObservedAt" IS NOT NULL
      AND (NEW."whatsappConsentProviderObservedAt" < OLD."whatsappConsentProviderObservedAt"
        OR (is_decision_change AND NEW."whatsappConsentSource" IS NOT NULL
          AND NEW."whatsappConsentProviderObservedAt" <= OLD."whatsappConsentProviderObservedAt")) THEN
      RAISE EXCEPTION 'stale consent observation' USING ERRCODE = '23514';
    END IF;
    IF OLD."whatsappConsentDecision" = 'GRANTED'
      AND (NEW."whatsappCanonicalPhone" IS DISTINCT FROM OLD."whatsappCanonicalPhone"
        OR NEW."phone" IS DISTINCT FROM OLD."phone")
      AND NEW."whatsappConsentDecision" = 'GRANTED' THEN
      RAISE EXCEPTION 'recipient rotation needs a new consent' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappNoContactRevision" > OLD."whatsappNoContactRevision" + 1 THEN
      RAISE EXCEPTION 'local no-contact revision must not skip' USING ERRCODE = '23514';
    END IF;
    IF (NEW."whatsappNoContact" IS DISTINCT FROM OLD."whatsappNoContact"
      OR NEW."whatsappNoContactReason" IS DISTINCT FROM OLD."whatsappNoContactReason"
      OR NEW."whatsappNoContactAt" IS DISTINCT FROM OLD."whatsappNoContactAt")
      AND NEW."whatsappNoContactRevision" <> OLD."whatsappNoContactRevision" + 1 THEN
      RAISE EXCEPTION 'local no-contact requires next revision' USING ERRCODE = '23514';
    END IF;
    -- An authoritative WhatsApp STOP cannot be lifted by a later Shopify
    -- provider GRANT, Woo checkbox, or merchant action. It is terminal here.
    IF OLD."whatsappNoContact" AND OLD."whatsappNoContactReason" = 'CUSTOMER_STOP'
      AND (NOT NEW."whatsappNoContact" OR NEW."whatsappNoContactReason" <> 'CUSTOMER_STOP') THEN
      RAISE EXCEPTION 'customer STOP cannot be cleared by consent source' USING ERRCODE = '23514';
    END IF;
    IF OLD."whatsappNoContact" AND NOT NEW."whatsappNoContact" THEN
      IF OLD."whatsappNoContactReason" <> 'MERCHANT_OPT_OUT'
        OR NEW."whatsappConsentDecision" <> 'GRANTED'
        OR NEW."whatsappNoContactClearedAt" IS NULL
        OR NEW."whatsappNoContactClearedAt" <= OLD."whatsappNoContactAt" THEN
        RAISE EXCEPTION 'merchant suppression removal requires existing valid GRANT' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF NEW."whatsappConsentDecision" = 'GRANTED' THEN
    IF NEW."endedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ended CustomerPhone cannot grant' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentSource" = 'SHOPIFY_NATIVE' THEN
      IF platform <> 'SHOPIFY' THEN
        RAISE EXCEPTION 'Shopify consent on non-Shopify merchant' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."whatsappConsentSource" = 'WOO_MODA_CHECKBOX' THEN
      IF platform <> 'WOOCOMMERCE' THEN
        RAISE EXCEPTION 'Woo consent on non-Woo merchant' USING ERRCODE = '23514';
      END IF;
      PERFORM 1 FROM "woocommerce"."WooCommerceInstallation" i
        WHERE i."shopId" = parent_shop AND i."status" = 'ACTIVE' FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Woo consent requires active installation' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'consent grant requires native source' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_customer_phone_guard BEFORE INSERT OR UPDATE
  ON "commerce"."CustomerPhone" FOR EACH ROW
  EXECUTE FUNCTION "commerce".arch045_customer_phone_guard();

-- Match exact current state. A previously accepted event may be retried after
-- subsequent withdrawals; the same digest is a no-op, a changed digest fails.
CREATE FUNCTION "commerce".arch045_woo_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_digest BYTEA;
  valid BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WhatsApp consent evidence is append-only' USING ERRCODE = '23514';
  END IF;
  SELECT e."payloadDigest" INTO previous_digest FROM "commerce"."WhatsAppConsentEvidence" e
    WHERE e."shopId" = NEW."shopId" AND e."eventId" = NEW."eventId" FOR SHARE;
  IF FOUND THEN
    IF previous_digest IS DISTINCT FROM NEW."payloadDigest" THEN
      RAISE EXCEPTION 'same eventId with different consent payload' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  PERFORM 1 FROM "woocommerce"."WooCommerceInstallation" i
    WHERE i."id" = NEW."installationId" AND i."shopId" = NEW."shopId"
      AND i."status" = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence requires active authenticated installation' USING ERRCODE = '23514';
  END IF;
  -- Prevent a concurrent state change between comparison and insertion.
  PERFORM 1 FROM "commerce"."CustomerPhone" cp
    WHERE cp."id" = NEW."customerPhoneId" FOR SHARE;
  SELECT EXISTS (
    SELECT 1 FROM "commerce"."CustomerPhone" cp
    JOIN "commerce"."Customer" c ON c."id" = cp."customerId"
    JOIN "commerce"."Shop" s ON s."id" = c."shopId"
    WHERE cp."id" = NEW."customerPhoneId" AND c."id" = NEW."customerId"
      AND c."shopId" = NEW."shopId" AND s."platform" = 'WOOCOMMERCE'
      AND cp."endedAt" IS NULL AND cp."whatsappCanonicalPhone" = NEW."canonicalPhone"
      AND cp."whatsappConsentSource" = 'WOO_MODA_CHECKBOX'
      AND cp."whatsappConsentPurpose" = NEW."purpose"
      AND cp."whatsappConsentRevision" = NEW."phoneConsentRevision"
      AND cp."whatsappConsentDecisionSequence" = NEW."decisionSequence"
      AND cp."whatsappConsentProviderObservedAt" = NEW."decisionAt"
      AND ((NEW."decision" = 'GRANT' AND cp."whatsappConsentDecision" = 'GRANTED')
        OR (NEW."decision" = 'REVOKE' AND cp."whatsappConsentDecision" = 'REVOKED'))
  ) INTO valid;
  IF NOT valid THEN
    RAISE EXCEPTION 'Woo evidence must match exact current phone decision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_woo_evidence_guard BEFORE INSERT OR UPDATE OR DELETE
  ON "commerce"."WhatsAppConsentEvidence" FOR EACH ROW
  EXECUTE FUNCTION "commerce".arch045_woo_evidence_guard();

-- Force Woo permission+history to commit together. The application must write
-- the checked, authenticated event and current phone in one transaction.
-- The caller updates CustomerPhone before inserting evidence; the deferred
-- check then verifies the final committed pair.
CREATE FUNCTION "commerce".arch045_woo_consent_commit_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_phone "commerce"."CustomerPhone"%ROWTYPE;
BEGIN
  SELECT * INTO current_phone FROM "commerce"."CustomerPhone"
    WHERE "id" = NEW."id";
  IF NOT FOUND OR current_phone."whatsappConsentSource" IS DISTINCT FROM 'WOO_MODA_CHECKBOX'
    OR current_phone."whatsappConsentDecision" NOT IN ('GRANTED', 'REVOKED') THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "commerce"."WhatsAppConsentEvidence" e
    WHERE e."customerPhoneId" = current_phone."id"
      AND e."customerId" = current_phone."customerId"
      AND e."canonicalPhone" = current_phone."whatsappCanonicalPhone"
      AND e."phoneConsentRevision" = current_phone."whatsappConsentRevision"
      AND e."decisionSequence" = current_phone."whatsappConsentDecisionSequence"
      AND e."decisionAt" = current_phone."whatsappConsentProviderObservedAt"
      AND ((e."decision" = 'GRANT' AND current_phone."whatsappConsentDecision" = 'GRANTED')
        OR (e."decision" = 'REVOKE' AND current_phone."whatsappConsentDecision" = 'REVOKED'))
  ) THEN
    RAISE EXCEPTION 'Woo permission write requires matching same-transaction evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER arch045_woo_consent_commit_guard
  AFTER INSERT OR UPDATE ON "commerce"."CustomerPhone"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "commerce".arch045_woo_consent_commit_guard();
