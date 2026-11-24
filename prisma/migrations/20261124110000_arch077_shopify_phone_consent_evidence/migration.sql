-- ARCH-077-DATABASE-001: Shopify signed-checkout per-phone consent evidence.
-- No historical Shopify compatibility/backfill, new tables, triggers or enums.
-- WooCommerce still requires an ACTIVE matching installation and its original
-- exact-state evidence and deferred atomic commit checks.
BEGIN;

ALTER TABLE "commerce"."WhatsAppConsentEvidence"
  ALTER COLUMN "installationId" DROP NOT NULL;

CREATE OR REPLACE FUNCTION "commerce".arch045_woo_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_digest BYTEA;
  valid BOOLEAN;
BEGIN
  -- Both Shopify and Woo evidence are immutable; preserve existing replay
  -- semantics even if a subsequent consent decision has superseded this one.
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

  IF NEW."installationId" IS NOT NULL THEN
    -- Preserve the original ARCH-045/046 WooCommerce authentication path.
    PERFORM 1 FROM "woocommerce"."WooCommerceInstallation" i
      WHERE i."id" = NEW."installationId" AND i."shopId" = NEW."shopId"
        AND i."status" = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'evidence requires active authenticated installation' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Serialize a state check with consent decision updates on the exact phone.
  PERFORM 1 FROM "commerce"."CustomerPhone" cp
    WHERE cp."id" = NEW."customerPhoneId" FOR SHARE;

  IF NEW."installationId" IS NOT NULL THEN
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
  ELSE
    -- A Shopify receipt is verified by Background against Shopify's checkout.
    -- No Woo installation identity is invented or accepted on this branch.
    SELECT EXISTS (
      SELECT 1 FROM "commerce"."CustomerPhone" cp
      JOIN "commerce"."Customer" c ON c."id" = cp."customerId"
      JOIN "commerce"."Shop" s ON s."id" = c."shopId"
      WHERE cp."id" = NEW."customerPhoneId" AND c."id" = NEW."customerId"
        AND c."shopId" = NEW."shopId" AND s."platform" = 'SHOPIFY'
        AND cp."endedAt" IS NULL AND cp."whatsappCanonicalPhone" = NEW."canonicalPhone"
        AND cp."whatsappConsentSource" = 'SHOPIFY_NATIVE'
        AND cp."whatsappConsentPurpose" = NEW."purpose"
        AND cp."whatsappConsentRevision" = NEW."phoneConsentRevision"
        AND cp."whatsappConsentDecisionSequence" = NEW."decisionSequence"
        AND cp."whatsappConsentProviderObservedAt" = NEW."decisionAt"
        AND ((NEW."decision" = 'GRANT' AND cp."whatsappConsentDecision" = 'GRANTED')
          OR (NEW."decision" = 'REVOKE' AND cp."whatsappConsentDecision" = 'REVOKED'))
    ) INTO valid;
    IF NOT valid THEN
      RAISE EXCEPTION 'Shopify evidence must match exact current phone decision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "commerce".arch045_woo_consent_commit_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_phone "commerce"."CustomerPhone"%ROWTYPE;
BEGIN
  SELECT * INTO current_phone FROM "commerce"."CustomerPhone"
    WHERE "id" = NEW."id";
  IF NOT FOUND OR current_phone."whatsappConsentSource" NOT IN ('WOO_MODA_CHECKBOX', 'SHOPIFY_NATIVE')
    OR current_phone."whatsappConsentDecision" NOT IN ('GRANTED', 'REVOKED') THEN
    RETURN NULL;
  END IF;

  IF current_phone."whatsappConsentSource" = 'WOO_MODA_CHECKBOX' THEN
    -- Preserve the existing Woo exact-state commit requirement.
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
  ELSIF current_phone."whatsappConsentSource" = 'SHOPIFY_NATIVE' THEN
    -- An independent STOP/no-contact update changes neither the consent
    -- revision nor decision sequence and must never require a new receipt,
    -- including on a pre-migration Shopify row with no evidence history.
    IF TG_OP = 'UPDATE' THEN
      IF NEW."whatsappConsentRevision" = OLD."whatsappConsentRevision"
        AND NEW."whatsappConsentDecisionSequence" = OLD."whatsappConsentDecisionSequence"
        AND NEW."whatsappConsentDecision" IS NOT DISTINCT FROM OLD."whatsappConsentDecision"
        AND NEW."whatsappConsentSource" IS NOT DISTINCT FROM OLD."whatsappConsentSource" THEN
        RETURN NULL;
      END IF;
    END IF;
    -- New Shopify GRANT/REVOKE must be inseparable from an authenticated
    -- per-phone evidence fact. A provider send also checks evidence directly.
    IF NOT EXISTS (
      SELECT 1 FROM "commerce"."WhatsAppConsentEvidence" e
      WHERE e."installationId" IS NULL
        AND e."customerPhoneId" = current_phone."id"
        AND e."customerId" = current_phone."customerId"
        AND e."canonicalPhone" = current_phone."whatsappCanonicalPhone"
        AND e."purpose" = current_phone."whatsappConsentPurpose"
        AND e."phoneConsentRevision" = current_phone."whatsappConsentRevision"
        AND e."decisionSequence" = current_phone."whatsappConsentDecisionSequence"
        AND e."decisionAt" = current_phone."whatsappConsentProviderObservedAt"
        AND ((e."decision" = 'GRANT' AND current_phone."whatsappConsentDecision" = 'GRANTED')
          OR (e."decision" = 'REVOKE' AND current_phone."whatsappConsentDecision" = 'REVOKED'))
    ) THEN
      RAISE EXCEPTION 'Shopify permission write requires matching same-transaction evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

COMMIT;
