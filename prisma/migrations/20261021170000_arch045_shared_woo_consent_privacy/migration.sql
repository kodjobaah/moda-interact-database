-- ARCH-045-DATABASE-002 (also ARCH-046): additive, fail-closed consent,
-- negative-only contact stops, Woo verified identity/evidence, and erasure.
-- Existing CustomerPhone rows remain UNKNOWN: no migration grants consent.
CREATE TYPE "commerce"."WhatsAppRecoveryConsentDecision" AS ENUM ('UNKNOWN','GRANTED','REVOKED');
CREATE TYPE "commerce"."WhatsAppRecoveryConsentSource" AS ENUM ('SHOPIFY_NATIVE','WOO_MODA_CHECKBOX','WOO_APPROVED_EXTERNAL');
CREATE TYPE "commerce"."WhatsAppRecoveryNoContactReason" AS ENUM ('CUSTOMER_STOP','MERCHANT_OPT_OUT');
CREATE TYPE "commerce"."WhatsAppConsentPurpose" AS ENUM ('WHATSAPP_CHECKOUT_RECOVERY');
CREATE TYPE "woocommerce"."WooWhatsAppConsentCollectionMode" AS ENUM ('NOT_CONFIGURED','MODA_CHECKBOX','APPROVED_EXTERNAL');
CREATE TYPE "woocommerce"."WooCheckoutPrincipalKind" AS ENUM ('ACCOUNT','GUEST_SESSION');
CREATE TYPE "woocommerce"."WooWhatsAppConsentEvidenceDecision" AS ENUM ('GRANT','REVOKE');

ALTER TABLE "commerce"."Customer"
  ADD COLUMN "verifiedPrincipalDigest" BYTEA,
  ADD COLUMN "verifiedPrincipalPlatform" "commerce"."ShopPlatform",
  ADD COLUMN "privacyErasedAt" TIMESTAMPTZ(3),
  ADD COLUMN "privacyRevision" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Customer_verified_principal_check" CHECK (
    ("verifiedPrincipalDigest" IS NULL AND "verifiedPrincipalPlatform" IS NULL)
    OR (octet_length("verifiedPrincipalDigest") = 32 AND "verifiedPrincipalPlatform" IS NOT NULL)
  ),
  ADD CONSTRAINT "Customer_privacyRevision_check" CHECK ("privacyRevision" >= 0),
  ADD CONSTRAINT "Customer_erasure_is_redacted_check" CHECK (
    "privacyErasedAt" IS NULL OR (
      "phone" IS NULL AND "email" IS NULL AND "firstName" IS NULL
      AND "lastName" IS NULL AND "shopifyCustomerId" IS NULL
      AND "verifiedPrincipalDigest" IS NULL AND "verifiedPrincipalPlatform" IS NULL
    )
  );
CREATE UNIQUE INDEX "Customer_id_shopId_key" ON "commerce"."Customer" ("id", "shopId");
CREATE UNIQUE INDEX "Customer_verified_principal_key" ON "commerce"."Customer"
  ("shopId", "verifiedPrincipalPlatform", "verifiedPrincipalDigest");

-- Keep legacy nullable phone writes compatible; only a separately verified
-- canonical recipient may become eligible for a consent grant.
ALTER TABLE "commerce"."CustomerPhone"
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "whatsappCanonicalPhone" VARCHAR(15),
  ADD COLUMN "whatsappPhoneVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "whatsappConsentPurpose" "commerce"."WhatsAppConsentPurpose" NOT NULL DEFAULT 'WHATSAPP_CHECKOUT_RECOVERY',
  ADD COLUMN "whatsappConsentDecision" "commerce"."WhatsAppRecoveryConsentDecision" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "whatsappConsentSource" "commerce"."WhatsAppRecoveryConsentSource",
  ADD COLUMN "whatsappConsentProviderId" VARCHAR(128),
  ADD COLUMN "whatsappConsentSourceEpoch" BIGINT,
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
    AND ("whatsappConsentSourceEpoch" IS NULL OR "whatsappConsentSourceEpoch" >= 0)
    AND "whatsappNoContactRevision" >= 0
  ),
  ADD CONSTRAINT "CustomerPhone_consent_source_check" CHECK (
    "whatsappConsentSource" IS NULL OR
    ("whatsappConsentSource" = 'SHOPIFY_NATIVE' AND "whatsappConsentSourceEpoch" IS NULL AND "whatsappConsentProviderId" IS NULL) OR
    ("whatsappConsentSource" = 'WOO_MODA_CHECKBOX' AND "whatsappConsentSourceEpoch" IS NOT NULL AND "whatsappConsentProviderId" IS NULL) OR
    ("whatsappConsentSource" = 'WOO_APPROVED_EXTERNAL' AND "whatsappConsentSourceEpoch" IS NOT NULL
      AND NULLIF(btrim("whatsappConsentProviderId"), '') IS NOT NULL)
  ),
  ADD CONSTRAINT "CustomerPhone_verified_grant_check" CHECK (
    "whatsappConsentDecision" <> 'GRANTED' OR (
      "phone" IS NOT NULL AND "endedAt" IS NULL
      AND "whatsappCanonicalPhone" IS NOT NULL AND "whatsappPhoneVerifiedAt" IS NOT NULL
      AND "whatsappConsentSource" IS NOT NULL AND "whatsappConsentVerifiedAt" IS NOT NULL
      AND "whatsappConsentProviderObservedAt" IS NOT NULL
      AND "whatsappConsentVerifiedAt" >= "whatsappConsentProviderObservedAt"
      AND "whatsappConsentVerifiedAt" >= "whatsappPhoneVerifiedAt"
      AND "whatsappConsentRevision" > 0 AND "whatsappConsentDecisionSequence" > 0
    )
  ),
  ADD CONSTRAINT "CustomerPhone_no_contact_check" CHECK (
    NOT "whatsappNoContact" OR
    ("whatsappNoContactReason" IS NOT NULL AND "whatsappNoContactAt" IS NOT NULL AND "whatsappNoContactRevision" > 0)
  );
CREATE UNIQUE INDEX "CustomerPhone_id_customerId_key" ON "commerce"."CustomerPhone" ("id", "customerId");
CREATE INDEX "CustomerPhone_customer_canonical_active_idx" ON "commerce"."CustomerPhone" ("customerId", "whatsappCanonicalPhone", "endedAt");
-- Existing legacy rows are not backfilled as verified; only one verified active
-- recipient per Customer (never globally unique by phone across customers).
CREATE UNIQUE INDEX "CustomerPhone_one_verified_active_per_customer_key"
  ON "commerce"."CustomerPhone" ("customerId")
  WHERE "endedAt" IS NULL AND "whatsappCanonicalPhone" IS NOT NULL;

ALTER TABLE "whatsapp"."WhatsAppRecipientReachability"
  ADD COLUMN "permanentNoContact" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "permanentNoContactReason" "commerce"."WhatsAppRecoveryNoContactReason",
  ADD COLUMN "permanentNoContactAt" TIMESTAMPTZ(3),
  ADD COLUMN "permanentNoContactRevision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "permanentNoContactClearedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "RecipientReachability_permanent_no_contact_check" CHECK (
    "permanentNoContactRevision" >= 0 AND
    (NOT "permanentNoContact" OR (
      "permanentNoContactReason" IS NOT NULL AND "permanentNoContactAt" IS NOT NULL
      AND "permanentNoContactRevision" > 0))
  );

ALTER TABLE "woocommerce"."WooCommerceInstallation"
  ADD COLUMN "whatsappConsentMode" "woocommerce"."WooWhatsAppConsentCollectionMode" NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "whatsappConsentProviderId" VARCHAR(128),
  ADD COLUMN "whatsappConsentSourceEpoch" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "whatsappConsentSourceRevision" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "WooInstallation_consent_source_check" CHECK (
    "whatsappConsentSourceEpoch" >= 0 AND "whatsappConsentSourceRevision" >= 0
    AND (("whatsappConsentMode" = 'APPROVED_EXTERNAL'
       AND NULLIF(btrim("whatsappConsentProviderId"), '') IS NOT NULL)
      OR ("whatsappConsentMode" <> 'APPROVED_EXTERNAL' AND "whatsappConsentProviderId" IS NULL))
  );

CREATE TABLE "commerce"."CustomerPrivacyErasureFence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "platform" "commerce"."ShopPlatform" NOT NULL,
  "principalDigest" BYTEA NOT NULL,
  "erasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision" BIGINT NOT NULL DEFAULT 1,
  "rejectedThroughAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CustomerPrivacyErasureFence_digest_revision_check" CHECK (
    octet_length("principalDigest") = 32 AND "revision" >= 1
    AND "rejectedThroughAt" <= "erasedAt"
  ),
  CONSTRAINT "CustomerPrivacyErasureFence_shopId_fkey" FOREIGN KEY ("shopId")
    REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerPrivacyErasureFence_principal_key"
  ON "commerce"."CustomerPrivacyErasureFence" ("shopId", "platform", "principalDigest");
CREATE INDEX "CustomerPrivacyErasureFence_shop_erased_idx"
  ON "commerce"."CustomerPrivacyErasureFence" ("shopId", "erasedAt");

CREATE TABLE "woocommerce"."WooCheckoutCustomerIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "principalKind" "woocommerce"."WooCheckoutPrincipalKind" NOT NULL,
  "principalDigest" BYTEA NOT NULL,
  "sessionGeneration" BIGINT NOT NULL DEFAULT 1,
  "checkoutKeyDigest" BYTEA NOT NULL,
  "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WooCheckoutIdentity_scope_fkey" FOREIGN KEY ("installationId", "shopId")
    REFERENCES "woocommerce"."WooCommerceInstallation"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooCheckoutIdentity_customer_fkey" FOREIGN KEY ("customerId", "shopId")
    REFERENCES "commerce"."Customer"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooCheckoutIdentity_shop_fkey" FOREIGN KEY ("shopId")
    REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WooCheckoutIdentity_session_check" CHECK (
    octet_length("principalDigest") = 32 AND octet_length("checkoutKeyDigest") = 32
    AND "sessionGeneration" > 0 AND "expiresAt" > "verifiedAt"
    AND "expiresAt" <= "verifiedAt" + interval '30 days'
    AND ("revokedAt" IS NULL OR "revokedAt" >= "verifiedAt")
  )
);
CREATE UNIQUE INDEX "WooCheckoutIdentity_id_installation_shop_key"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("id", "installationId", "shopId");
CREATE UNIQUE INDEX "WooCheckoutIdentity_generation_checkout_key"
  ON "woocommerce"."WooCheckoutCustomerIdentity"
  ("installationId", "principalKind", "principalDigest", "sessionGeneration", "checkoutKeyDigest");
-- Checkout keys are NOT globally unique; reuse in another shop is harmless.
-- A rotation revokes the old association before a new one becomes active.
CREATE UNIQUE INDEX "WooCheckoutIdentity_one_live_checkout_key"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("installationId", "checkoutKeyDigest") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "WooCheckoutIdentity_one_live_session_generation"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("installationId", "principalKind", "principalDigest", "sessionGeneration") WHERE "revokedAt" IS NULL;
CREATE INDEX "WooCheckoutIdentity_checkout_lookup_idx"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("installationId", "checkoutKeyDigest", "revokedAt");
CREATE INDEX "WooCheckoutIdentity_principal_lookup_idx"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("installationId", "principalKind", "principalDigest", "sessionGeneration");
CREATE INDEX "WooCheckoutIdentity_customer_expiry_idx"
  ON "woocommerce"."WooCheckoutCustomerIdentity" ("shopId", "customerId", "expiresAt");
CREATE INDEX "WooCheckoutIdentity_expiry_idx" ON "woocommerce"."WooCheckoutCustomerIdentity" ("expiresAt");

CREATE TABLE "woocommerce"."WooWhatsAppConsentEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "eventId" VARCHAR(128) NOT NULL,
  "payloadDigest" BYTEA NOT NULL,
  "customerId" TEXT,
  "customerPhoneId" TEXT,
  "checkoutIdentityId" TEXT,
  "canonicalPhone" VARCHAR(15),
  "purpose" "commerce"."WhatsAppConsentPurpose" NOT NULL DEFAULT 'WHATSAPP_CHECKOUT_RECOVERY',
  "decision" "woocommerce"."WooWhatsAppConsentEvidenceDecision" NOT NULL,
  "sourceMode" "woocommerce"."WooWhatsAppConsentCollectionMode" NOT NULL,
  "providerId" VARCHAR(128),
  "sourceEpoch" BIGINT NOT NULL,
  "sourceRevision" BIGINT NOT NULL,
  "decisionSequence" BIGINT NOT NULL,
  "phoneConsentRevision" BIGINT NOT NULL,
  "providerOccurredAt" TIMESTAMPTZ(3),
  "disclosureText" VARCHAR(4000),
  "disclosureVersion" VARCHAR(128),
  "disclosureLocale" VARCHAR(64),
  "verifiedCheckoutKeyDigest" BYTEA,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redactedAt" TIMESTAMPTZ(3),
  CONSTRAINT "WooConsentEvidence_shop_fkey" FOREIGN KEY ("shopId")
    REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WooConsentEvidence_installation_fkey" FOREIGN KEY ("installationId", "shopId")
    REFERENCES "woocommerce"."WooCommerceInstallation"("id", "shopId") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "WooConsentEvidence_customer_fkey" FOREIGN KEY ("customerId", "shopId")
    REFERENCES "commerce"."Customer"("id", "shopId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WooConsentEvidence_phone_fkey" FOREIGN KEY ("customerPhoneId", "customerId")
    REFERENCES "commerce"."CustomerPhone"("id", "customerId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WooConsentEvidence_identity_fkey" FOREIGN KEY ("checkoutIdentityId", "installationId", "shopId")
    REFERENCES "woocommerce"."WooCheckoutCustomerIdentity"("id", "installationId", "shopId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "WooConsentEvidence_verified_check" CHECK (
    octet_length("payloadDigest") = 32 AND "sourceEpoch" >= 0 AND "sourceRevision" >= 0
    AND "decisionSequence" > 0 AND "phoneConsentRevision" > 0
    AND "sourceMode" <> 'NOT_CONFIGURED'
    AND ("verifiedCheckoutKeyDigest" IS NULL OR octet_length("verifiedCheckoutKeyDigest") = 32)
    AND (("checkoutIdentityId" IS NULL AND "verifiedCheckoutKeyDigest" IS NULL) OR
         ("checkoutIdentityId" IS NOT NULL AND "verifiedCheckoutKeyDigest" IS NOT NULL))
    AND ("sourceMode" <> 'APPROVED_EXTERNAL' OR "providerId" IS NOT NULL OR "redactedAt" IS NOT NULL)
    AND ("redactedAt" IS NOT NULL OR (
      "customerId" IS NOT NULL AND "customerPhoneId" IS NOT NULL
      AND "canonicalPhone" IS NOT NULL
      AND "canonicalPhone" COLLATE "C" ~ '^[1-9][0-9]{1,14}$'
      AND NULLIF(btrim("disclosureText"), '') IS NOT NULL
      AND NULLIF(btrim("disclosureVersion"), '') IS NOT NULL
      AND NULLIF(btrim("disclosureLocale"), '') IS NOT NULL
    ))
    AND ("redactedAt" IS NULL OR (
      "customerId" IS NULL AND "customerPhoneId" IS NULL AND "checkoutIdentityId" IS NULL
      AND "canonicalPhone" IS NULL AND "disclosureText" IS NULL
      AND "disclosureVersion" IS NULL AND "disclosureLocale" IS NULL
      AND "providerId" IS NULL AND "providerOccurredAt" IS NULL
      AND "verifiedCheckoutKeyDigest" IS NULL
    ))
  )
);
CREATE UNIQUE INDEX "WooWhatsAppConsentEvidence_shop_event_key"
  ON "woocommerce"."WooWhatsAppConsentEvidence" ("shopId", "eventId");
CREATE INDEX "WooWhatsAppConsentEvidence_customer_history_idx"
  ON "woocommerce"."WooWhatsAppConsentEvidence" ("shopId", "customerId", "recordedAt");
CREATE INDEX "WooWhatsAppConsentEvidence_installation_history_idx"
  ON "woocommerce"."WooWhatsAppConsentEvidence" ("installationId", "recordedAt");

-- Providers, retries and privacy writers must use short transactions. The
-- Customer row is locked for a current-phone write so erasure and consent
-- updates cannot commit in opposite orders with stale reads.
CREATE FUNCTION "commerce".arch045_customer_privacy_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."privacyErasedAt" IS NOT NULL AND (
      NEW."privacyErasedAt" IS DISTINCT FROM OLD."privacyErasedAt"
      OR NEW."privacyRevision" <> OLD."privacyRevision"
    ) THEN
      RAISE EXCEPTION 'erased Customer cannot be reactivated or relinked' USING ERRCODE = '23514';
    END IF;
    IF OLD."privacyErasedAt" IS NULL AND NEW."privacyErasedAt" IS NOT NULL
       AND NEW."privacyRevision" <> OLD."privacyRevision" + 1 THEN
      RAISE EXCEPTION 'Customer erasure must advance revision' USING ERRCODE = '23514';
    END IF;
    IF NEW."privacyRevision" < OLD."privacyRevision" THEN
      RAISE EXCEPTION 'Customer privacy revision must not decrease' USING ERRCODE = '23514';
    END IF;
    IF OLD."verifiedPrincipalDigest" IS NOT NULL
       AND NEW."privacyErasedAt" IS NULL
       AND (NEW."verifiedPrincipalDigest" IS DISTINCT FROM OLD."verifiedPrincipalDigest"
         OR NEW."verifiedPrincipalPlatform" IS DISTINCT FROM OLD."verifiedPrincipalPlatform") THEN
      RAISE EXCEPTION 'verified principal rotation requires new customer lifecycle' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- For verified principals, a transaction-scoped lock serialises creation
  -- against a concurrent erasure even when no fence row existed at snapshot.
  IF NEW."verifiedPrincipalDigest" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "commerce"."Shop" s
      WHERE s."id"=NEW."shopId" AND s."platform"=NEW."verifiedPrincipalPlatform") THEN
      RAISE EXCEPTION 'verified principal must match shop platform' USING ERRCODE = '23514';
    END IF;
    PERFORM "commerce".arch045_lock_verified_principal(
      NEW."shopId", NEW."verifiedPrincipalPlatform", NEW."verifiedPrincipalDigest");
    IF EXISTS (SELECT 1 FROM "commerce"."CustomerPrivacyErasureFence" f
       WHERE f."shopId"=NEW."shopId" AND f."platform"=NEW."verifiedPrincipalPlatform"
         AND f."principalDigest"=NEW."verifiedPrincipalDigest") THEN
      RAISE EXCEPTION 'erased platform principal cannot be rebound' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."privacyErasedAt" IS NOT NULL AND (
    NEW."phone" IS NOT NULL OR NEW."email" IS NOT NULL OR NEW."firstName" IS NOT NULL
    OR NEW."lastName" IS NOT NULL OR NEW."shopifyCustomerId" IS NOT NULL
    OR NEW."verifiedPrincipalDigest" IS NOT NULL OR NEW."verifiedPrincipalPlatform" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'erased Customer must be anonymised' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_customer_privacy_guard BEFORE INSERT OR UPDATE
  ON "commerce"."Customer" FOR EACH ROW EXECUTE FUNCTION "commerce".arch045_customer_privacy_guard();

CREATE FUNCTION "commerce".arch045_customer_phone_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_shop TEXT;
  erased TIMESTAMPTZ;
  platform "commerce"."ShopPlatform";
  verified_digest BYTEA;
  verified_platform "commerce"."ShopPlatform";
  source_ok BOOLEAN;
  grant_write BOOLEAN := FALSE;
BEGIN
  SELECT c."shopId", c."privacyErasedAt", s."platform",
         c."verifiedPrincipalDigest", c."verifiedPrincipalPlatform"
    INTO parent_shop, erased, platform, verified_digest, verified_platform
    FROM "commerce"."Customer" c
    JOIN "commerce"."Shop" s ON s."id" = c."shopId"
    WHERE c."id" = NEW."customerId"
    FOR SHARE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CustomerPhone requires existing customer' USING ERRCODE = '23503';
  END IF;
  IF erased IS NOT NULL AND (
     NEW."phone" IS NOT NULL OR NEW."whatsappCanonicalPhone" IS NOT NULL
     OR NEW."whatsappPhoneVerifiedAt" IS NOT NULL
     OR NEW."whatsappConsentDecision" <> 'UNKNOWN'
     OR NEW."whatsappConsentSource" IS NOT NULL
     OR NEW."whatsappConsentProviderId" IS NOT NULL
     OR NEW."whatsappConsentSourceEpoch" IS NOT NULL
     OR NEW."whatsappConsentProviderObservedAt" IS NOT NULL
     OR NEW."whatsappConsentVerifiedAt" IS NOT NULL
     OR NEW."whatsappNoContact"
     OR NEW."whatsappNoContactReason" IS NOT NULL
     OR NEW."whatsappNoContactAt" IS NOT NULL
     OR NEW."whatsappNoContactClearedAt" IS NOT NULL ) THEN
    RAISE EXCEPTION 'cannot restore erased CustomerPhone' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
      RAISE EXCEPTION 'phone identity cannot transfer between customers' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentRevision" < OLD."whatsappConsentRevision"
       OR NEW."whatsappConsentDecisionSequence" < OLD."whatsappConsentDecisionSequence"
       OR NEW."whatsappNoContactRevision" < OLD."whatsappNoContactRevision" THEN
      RAISE EXCEPTION 'consent / override revisions cannot decrease' USING ERRCODE = '23514';
    END IF;
    IF (
       NEW."whatsappCanonicalPhone" IS DISTINCT FROM OLD."whatsappCanonicalPhone" OR
       NEW."whatsappConsentDecision" IS DISTINCT FROM OLD."whatsappConsentDecision" OR
       NEW."whatsappConsentSource" IS DISTINCT FROM OLD."whatsappConsentSource" OR
       NEW."whatsappConsentProviderId" IS DISTINCT FROM OLD."whatsappConsentProviderId" OR
       NEW."whatsappConsentSourceEpoch" IS DISTINCT FROM OLD."whatsappConsentSourceEpoch" OR
       NEW."whatsappConsentProviderObservedAt" IS DISTINCT FROM OLD."whatsappConsentProviderObservedAt" OR
       NEW."whatsappConsentVerifiedAt" IS DISTINCT FROM OLD."whatsappConsentVerifiedAt" OR
       NEW."whatsappPhoneVerifiedAt" IS DISTINCT FROM OLD."whatsappPhoneVerifiedAt"
    ) AND NEW."whatsappConsentRevision" <> OLD."whatsappConsentRevision" + 1 THEN
      RAISE EXCEPTION 'consent state write requires next revision' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentRevision" > OLD."whatsappConsentRevision" + 1 THEN
      RAISE EXCEPTION 'consent revision must not skip' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentDecisionSequence" > OLD."whatsappConsentDecisionSequence"
       AND NEW."whatsappConsentRevision" <= OLD."whatsappConsentRevision" THEN
      RAISE EXCEPTION 'new decision sequence requires new revision' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentDecision" = 'GRANTED' AND (
      NEW."whatsappConsentDecisionSequence" <= OLD."whatsappConsentDecisionSequence"
      OR (NEW."whatsappConsentSource" = OLD."whatsappConsentSource"
        AND NEW."whatsappConsentSourceEpoch" IS NOT DISTINCT FROM OLD."whatsappConsentSourceEpoch"
        AND NEW."whatsappConsentProviderObservedAt" <= OLD."whatsappConsentProviderObservedAt")
    ) AND (NEW."whatsappConsentRevision" <> OLD."whatsappConsentRevision") THEN
      RAISE EXCEPTION 'stale grant or provider observation' USING ERRCODE = '23514';
    END IF;
    IF OLD."whatsappConsentDecision" = 'GRANTED'
       AND NEW."whatsappCanonicalPhone" IS DISTINCT FROM OLD."whatsappCanonicalPhone"
       AND NEW."whatsappConsentDecision" = 'GRANTED' THEN
      RAISE EXCEPTION 'phone rotation requires revocation and fresh verification' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappNoContact" IS DISTINCT FROM OLD."whatsappNoContact"
       OR NEW."whatsappNoContactReason" IS DISTINCT FROM OLD."whatsappNoContactReason"
       OR NEW."whatsappNoContactAt" IS DISTINCT FROM OLD."whatsappNoContactAt" THEN
      IF NEW."whatsappNoContactRevision" <> OLD."whatsappNoContactRevision" + 1 THEN
        RAISE EXCEPTION 'local no-contact change must advance revision' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF OLD."whatsappNoContact" AND NOT NEW."whatsappNoContact" AND NOT (
      (erased IS NOT NULL AND NEW."phone" IS NULL AND NEW."whatsappCanonicalPhone" IS NULL
        AND NEW."whatsappConsentDecision" = 'UNKNOWN')
      OR (NEW."whatsappConsentDecision" = 'GRANTED'
      AND NEW."whatsappConsentRevision" = OLD."whatsappConsentRevision" + 1
      AND NEW."whatsappConsentDecisionSequence" > OLD."whatsappConsentDecisionSequence"
      AND NEW."whatsappConsentProviderObservedAt" > OLD."whatsappNoContactAt"
      AND NEW."whatsappConsentVerifiedAt" >= NEW."whatsappConsentProviderObservedAt"
      AND NEW."whatsappNoContactClearedAt" > OLD."whatsappNoContactAt")
    ) THEN
      RAISE EXCEPTION 'STOP requires newer verified affirmative grant' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Serialise current-recipient permissions with unbound/merchant STOP,
  -- including when reachability has no existing row yet.
  IF NEW."whatsappCanonicalPhone" IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW."whatsappConsentDecision" = 'GRANTED' OR NEW."whatsappNoContact"
         OR NEW."whatsappConsentDecision" IS DISTINCT FROM OLD."whatsappConsentDecision"
         OR NEW."whatsappNoContact" IS DISTINCT FROM OLD."whatsappNoContact" THEN
        PERFORM "whatsapp".arch045_lock_contact_recipient(parent_shop, NEW."whatsappCanonicalPhone");
      END IF;
    ELSIF NEW."whatsappConsentDecision" = 'GRANTED' OR NEW."whatsappNoContact" THEN
      PERFORM "whatsapp".arch045_lock_contact_recipient(parent_shop, NEW."whatsappCanonicalPhone");
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    grant_write := NEW."whatsappConsentDecision" = 'GRANTED';
  ELSE
    grant_write := NEW."whatsappConsentDecision" = 'GRANTED'
      AND NEW."whatsappConsentRevision" > OLD."whatsappConsentRevision";
  END IF;
  -- A pure STOP/suppression override must still be writable after a Woo
  -- source switch: only a *new* positive decision needs current source proof.
  IF grant_write THEN
    IF verified_digest IS NULL OR verified_platform IS DISTINCT FROM platform THEN
      RAISE EXCEPTION 'verified external customer principal required for consent' USING ERRCODE = '23514';
    END IF;
    IF erased IS NOT NULL THEN
      RAISE EXCEPTION 'erased principal cannot grant' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentSource" = 'SHOPIFY_NATIVE' THEN
      IF platform <> 'SHOPIFY' THEN
        RAISE EXCEPTION 'Shopify permission on non-Shopify shop' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF platform <> 'WOOCOMMERCE' THEN
        RAISE EXCEPTION 'Woo permission on non-Woo shop' USING ERRCODE = '23514';
      END IF;
      -- Lock the installation *before* the eligibility read, avoiding a
      -- source switch between checking the epoch and taking the row lock.
      PERFORM 1 FROM "woocommerce"."WooCommerceInstallation" i
        WHERE i."shopId" = parent_shop FOR SHARE;
      SELECT EXISTS (
        SELECT 1 FROM "woocommerce"."WooCommerceInstallation" i
          WHERE i."shopId" = parent_shop AND i."status" = 'ACTIVE'
            AND i."whatsappConsentSourceEpoch" = NEW."whatsappConsentSourceEpoch"
            AND ((NEW."whatsappConsentSource" = 'WOO_MODA_CHECKBOX' AND i."whatsappConsentMode" = 'MODA_CHECKBOX')
              OR (NEW."whatsappConsentSource" = 'WOO_APPROVED_EXTERNAL'
                 AND i."whatsappConsentMode" = 'APPROVED_EXTERNAL'
                 AND i."whatsappConsentProviderId" = NEW."whatsappConsentProviderId"))
      ) INTO source_ok;
      IF NOT source_ok THEN
        RAISE EXCEPTION 'Woo consent source epoch mismatch' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_customer_phone_guard BEFORE INSERT OR UPDATE
  ON "commerce"."CustomerPhone" FOR EACH ROW EXECUTE FUNCTION "commerce".arch045_customer_phone_guard();

CREATE FUNCTION "whatsapp".arch045_unbound_stop_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."permanentNoContact" OR
       NEW."permanentNoContact" IS DISTINCT FROM OLD."permanentNoContact" THEN
      PERFORM "whatsapp".arch045_lock_contact_recipient(NEW."shopId", NEW."recipient");
    END IF;
  ELSIF NEW."permanentNoContact" THEN
    PERFORM "whatsapp".arch045_lock_contact_recipient(NEW."shopId", NEW."recipient");
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."permanentNoContactRevision" < OLD."permanentNoContactRevision" THEN
      RAISE EXCEPTION 'recipient STOP revision cannot decrease' USING ERRCODE = '23514';
    END IF;
    IF (NEW."permanentNoContact" IS DISTINCT FROM OLD."permanentNoContact"
        OR NEW."permanentNoContactReason" IS DISTINCT FROM OLD."permanentNoContactReason"
        OR NEW."permanentNoContactAt" IS DISTINCT FROM OLD."permanentNoContactAt")
        AND NEW."permanentNoContactRevision" <> OLD."permanentNoContactRevision" + 1 THEN
      RAISE EXCEPTION 'recipient STOP change requires next revision' USING ERRCODE = '23514';
    END IF;
    IF OLD."permanentNoContact" AND NOT NEW."permanentNoContact" AND NOT (
      NEW."permanentNoContactClearedAt" > OLD."permanentNoContactAt"
      AND EXISTS (
        SELECT 1 FROM "commerce"."CustomerPhone" cp
        JOIN "commerce"."Customer" c ON c."id" = cp."customerId"
        WHERE c."shopId" = NEW."shopId" AND c."privacyErasedAt" IS NULL
          AND cp."endedAt" IS NULL AND cp."whatsappCanonicalPhone" = NEW."recipient"
          AND cp."whatsappConsentDecision" = 'GRANTED' AND NOT cp."whatsappNoContact"
          AND cp."whatsappConsentProviderObservedAt" > OLD."permanentNoContactAt"
      )
    ) THEN
      RAISE EXCEPTION 'unbound STOP requires newer verified exact-recipient grant' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_unbound_stop_guard BEFORE INSERT OR UPDATE
  ON "whatsapp"."WhatsAppRecipientReachability" FOR EACH ROW
  EXECUTE FUNCTION "whatsapp".arch045_unbound_stop_guard();

CREATE FUNCTION "woocommerce".arch045_source_epoch_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."whatsappConsentSourceEpoch" < OLD."whatsappConsentSourceEpoch"
       OR NEW."whatsappConsentSourceRevision" < OLD."whatsappConsentSourceRevision" THEN
      RAISE EXCEPTION 'Woo source epoch/revision cannot decrease' USING ERRCODE = '23514';
    END IF;
    IF NEW."whatsappConsentMode" IS DISTINCT FROM OLD."whatsappConsentMode"
       OR NEW."whatsappConsentProviderId" IS DISTINCT FROM OLD."whatsappConsentProviderId" THEN
      IF NEW."whatsappConsentSourceEpoch" <> OLD."whatsappConsentSourceEpoch" + 1
         OR NEW."whatsappConsentSourceRevision" <> OLD."whatsappConsentSourceRevision" + 1 THEN
        RAISE EXCEPTION 'Woo source change must increment epoch and revision' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."whatsappConsentSourceEpoch" <> OLD."whatsappConsentSourceEpoch"
       AND (NEW."whatsappConsentSourceEpoch" <> OLD."whatsappConsentSourceEpoch" + 1
         OR NEW."whatsappConsentSourceRevision" <> OLD."whatsappConsentSourceRevision" + 1) THEN
      RAISE EXCEPTION 'Woo source refresh must increment epoch and revision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_source_epoch_guard BEFORE INSERT OR UPDATE
  ON "woocommerce"."WooCommerceInstallation" FOR EACH ROW
  EXECUTE FUNCTION "woocommerce".arch045_source_epoch_guard();

CREATE FUNCTION "woocommerce".arch045_checkout_identity_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "commerce"."Customer" c
      WHERE c."id"=NEW."customerId" AND c."shopId"=NEW."shopId"
      AND c."privacyErasedAt" IS NULL) THEN
      RAISE EXCEPTION 'cannot bind checkout to erased/mismatched customer' USING ERRCODE = '23514';
    END IF;
    PERFORM "commerce".arch045_lock_verified_principal(
      NEW."shopId", 'WOOCOMMERCE', NEW."principalDigest");
    IF EXISTS (SELECT 1 FROM "commerce"."CustomerPrivacyErasureFence" f
      WHERE f."shopId"=NEW."shopId" AND f."platform"='WOOCOMMERCE'
        AND f."principalDigest"=NEW."principalDigest") THEN
      RAISE EXCEPTION 'erased Woo account/guest principal cannot be rebound' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."installationId" IS DISTINCT FROM OLD."installationId"
       OR NEW."shopId" IS DISTINCT FROM OLD."shopId"
       OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
       OR NEW."principalDigest" IS DISTINCT FROM OLD."principalDigest"
       OR NEW."checkoutKeyDigest" IS DISTINCT FROM OLD."checkoutKeyDigest"
       OR NEW."sessionGeneration" IS DISTINCT FROM OLD."sessionGeneration"
       OR NEW."principalKind" IS DISTINCT FROM OLD."principalKind"
       OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
       OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
       OR NEW."expiresAt" > OLD."expiresAt" THEN
      RAISE EXCEPTION 'Woo identity change requires rotated new binding' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_checkout_identity_guard BEFORE INSERT OR UPDATE
  ON "woocommerce"."WooCheckoutCustomerIdentity" FOR EACH ROW
  EXECUTE FUNCTION "woocommerce".arch045_checkout_identity_guard();

-- Ordinary Woo evidence rows are immutable. An authenticated privacy handler
-- may redact all identity/disclosure PII once. Deletion needs an explicitly
-- verified operation context; shop teardown must set it in its transaction.
CREATE FUNCTION "woocommerce".arch045_woo_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  verified BOOLEAN;
  existing_payload_digest BYTEA;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A retry of the same accepted event is a no-op even after a later revoke,
    -- source switch or privacy redaction. A changed canonical request digest
    -- must fail rather than being mistaken for a harmless duplicate.
    -- The caller must still compare digests after ON CONFLICT DO NOTHING: a
    -- concurrently uncommitted insert is not visible to this lookup.
    SELECT e."payloadDigest" INTO existing_payload_digest
      FROM "woocommerce"."WooWhatsAppConsentEvidence" e
      WHERE e."shopId" = NEW."shopId" AND e."eventId" = NEW."eventId"
      FOR SHARE;
    IF FOUND THEN
      IF existing_payload_digest IS DISTINCT FROM NEW."payloadDigest" THEN
        RAISE EXCEPTION 'Woo consent event replay payload mismatch' USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END IF;
    PERFORM 1 FROM "woocommerce"."WooCommerceInstallation" i
      WHERE i."id" = NEW."installationId" FOR SHARE;
    PERFORM 1 FROM "commerce"."CustomerPhone" cp
      WHERE cp."id" = NEW."customerPhoneId" FOR SHARE;
    -- Evidence is an ordinary fact about a current, verified shop/customer/
    -- phone. It cannot rehydrate an erased principal or bypass a source switch.
    SELECT EXISTS (
      SELECT 1 FROM "commerce"."CustomerPhone" cp
        JOIN "commerce"."Customer" c ON c."id" = cp."customerId"
        JOIN "woocommerce"."WooCommerceInstallation" i ON i."shopId" = c."shopId"
        WHERE c."id" = NEW."customerId" AND c."shopId" = NEW."shopId"
          AND c."privacyErasedAt" IS NULL
          AND cp."id" = NEW."customerPhoneId" AND cp."endedAt" IS NULL
          AND cp."whatsappCanonicalPhone" = NEW."canonicalPhone"
          AND cp."whatsappConsentRevision" = NEW."phoneConsentRevision"
          AND cp."whatsappConsentDecisionSequence" = NEW."decisionSequence"
          AND cp."whatsappConsentSourceEpoch" = NEW."sourceEpoch"
          AND ((NEW."sourceMode" = 'MODA_CHECKBOX'
                AND cp."whatsappConsentSource" = 'WOO_MODA_CHECKBOX'
                AND cp."whatsappConsentProviderId" IS NULL)
            OR (NEW."sourceMode" = 'APPROVED_EXTERNAL'
                AND cp."whatsappConsentSource" = 'WOO_APPROVED_EXTERNAL'
                AND cp."whatsappConsentProviderId" = NEW."providerId"))
          AND i."id" = NEW."installationId" AND i."status" = 'ACTIVE'
          AND i."whatsappConsentSourceEpoch" = NEW."sourceEpoch"
          AND i."whatsappConsentSourceRevision" = NEW."sourceRevision"
          AND i."whatsappConsentMode" = NEW."sourceMode"
          AND (NEW."sourceMode" <> 'APPROVED_EXTERNAL'
               OR i."whatsappConsentProviderId" = NEW."providerId")
          AND ((NEW."decision" = 'GRANT' AND cp."whatsappConsentDecision" = 'GRANTED')
               OR (NEW."decision" = 'REVOKE' AND cp."whatsappConsentDecision" = 'REVOKED'))
    ) INTO verified;
    IF NOT verified THEN
      RAISE EXCEPTION 'Woo evidence must match current verified consent and source' USING ERRCODE = '23514';
    END IF;
    IF NEW."checkoutIdentityId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "woocommerce"."WooCheckoutCustomerIdentity" b
        WHERE b."id" = NEW."checkoutIdentityId" AND b."installationId" = NEW."installationId"
          AND b."shopId" = NEW."shopId" AND b."customerId" = NEW."customerId"
          AND b."checkoutKeyDigest" = NEW."verifiedCheckoutKeyDigest"
          AND b."revokedAt" IS NULL AND b."expiresAt" > CURRENT_TIMESTAMP
    ) THEN
      RAISE EXCEPTION 'Woo checkout evidence requires active verified binding' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('moda.verified_privacy_erasure', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Woo consent evidence is append-only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."redactedAt" IS NULL AND NEW."redactedAt" IS NOT NULL
     AND NEW."redactedAt" >= OLD."recordedAt"
     AND NEW."customerId" IS NULL AND NEW."customerPhoneId" IS NULL
     AND NEW."checkoutIdentityId" IS NULL AND NEW."canonicalPhone" IS NULL
     AND NEW."disclosureText" IS NULL AND NEW."disclosureVersion" IS NULL
     AND NEW."disclosureLocale" IS NULL AND NEW."providerId" IS NULL
     AND NEW."providerOccurredAt" IS NULL AND NEW."verifiedCheckoutKeyDigest" IS NULL
     AND ROW(NEW."id",NEW."shopId",NEW."installationId",NEW."eventId",
       NEW."payloadDigest",NEW."purpose",NEW."decision",NEW."sourceMode",
       NEW."sourceEpoch",NEW."sourceRevision",NEW."decisionSequence",
       NEW."phoneConsentRevision",NEW."recordedAt")
       IS NOT DISTINCT FROM
       ROW(OLD."id",OLD."shopId",OLD."installationId",OLD."eventId",
         OLD."payloadDigest",OLD."purpose",OLD."decision",OLD."sourceMode",
         OLD."sourceEpoch",OLD."sourceRevision",OLD."decisionSequence",
         OLD."phoneConsentRevision",OLD."recordedAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Woo evidence modification requires one-way privacy redaction' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER arch045_woo_evidence_guard BEFORE INSERT OR UPDATE OR DELETE
  ON "woocommerce"."WooWhatsAppConsentEvidence" FOR EACH ROW
  EXECUTE FUNCTION "woocommerce".arch045_woo_evidence_guard();

CREATE FUNCTION "commerce".arch045_privacy_fence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('moda.verified_shop_teardown', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'erasure fence cannot be removed outside shop teardown' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "commerce"."Shop" s
     WHERE s."id"=NEW."shopId" AND s."platform"=NEW."platform") THEN
    RAISE EXCEPTION 'privacy fence platform/shop mismatch' USING ERRCODE = '23514';
  END IF;
  PERFORM "commerce".arch045_lock_verified_principal(
    NEW."shopId", NEW."platform", NEW."principalDigest");
  IF TG_OP = 'UPDATE' THEN
    IF NEW."shopId" IS DISTINCT FROM OLD."shopId"
       OR NEW."platform" IS DISTINCT FROM OLD."platform"
       OR NEW."principalDigest" IS DISTINCT FROM OLD."principalDigest"
       OR NEW."erasedAt" < OLD."erasedAt"
       OR NEW."rejectedThroughAt" < OLD."rejectedThroughAt"
       OR NEW."revision" <> OLD."revision" + 1 THEN
      RAISE EXCEPTION 'privacy fence must advance monotonically' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER arch045_privacy_fence_guard BEFORE INSERT OR UPDATE OR DELETE
  ON "commerce"."CustomerPrivacyErasureFence" FOR EACH ROW
  EXECUTE FUNCTION "commerce".arch045_privacy_fence_guard();

-- Writers must acquire this *first*, before checking a missing fence or
-- inserting a Customer, so concurrent erasure vs sync/consent cannot bypass
-- a previously absent fence row. Digest is keyed, not a raw external ID.
CREATE FUNCTION "commerce".arch045_lock_verified_principal(
  shop_id TEXT, principal_platform "commerce"."ShopPlatform", principal_digest BYTEA
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF shop_id IS NULL OR principal_platform IS NULL OR octet_length(principal_digest) <> 32 THEN
    RAISE EXCEPTION 'invalid verified principal lock inputs' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    shop_id || ':' || principal_platform::text || ':' || encode(principal_digest, 'hex'), 0));
END;
$$;

-- Coordinate a missing reachability row with an outbound attempt. Consumers
-- lock the canonical recipient before the final read; STOP insert/update and
-- verified CustomerPhone updates acquire the identical transaction lock.
CREATE FUNCTION "whatsapp".arch045_lock_contact_recipient(
  shop_id TEXT, canonical_recipient TEXT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF shop_id IS NULL OR canonical_recipient IS NULL
     OR canonical_recipient COLLATE "C" !~ '^[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'invalid exact WhatsApp recipient lock scope' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    shop_id || ':whatsapp-recipient:' || canonical_recipient, 1));
END;
$$;
