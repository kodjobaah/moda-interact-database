-- ARCH-040-DATABASE-005: persist content-specific moderation outcomes.
-- Classification never admits a provider dispatch, creates billing credit or
-- modifies the existing conversation, message or command state machine.
-- Caller lock order for moderation subjects: Shop -> Conversation -> subject.
-- Do not hold any of these locks over HTTP/model calls.
CREATE TYPE "whatsapp"."ConversationModerationSubject" AS ENUM
  ('CUSTOMER_MESSAGE', 'HUMAN_COMMAND', 'AGENT_MESSAGE', 'AUTOMATION_MESSAGE');
CREATE TYPE "whatsapp"."ConversationModerationDecision" AS ENUM
  ('PENDING', 'CHECKING', 'ALLOW', 'BLOCK', 'REVIEW_REQUIRED', 'RETRYABLE_ERROR');

CREATE TABLE "whatsapp"."ConversationModerationAssessment" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "subject" "whatsapp"."ConversationModerationSubject" NOT NULL,
  "conversationMessageId" TEXT,
  "merchantSendCommandId" TEXT,
  "contentSha256" VARCHAR(64) NOT NULL,
  "inputKind" VARCHAR(32) NOT NULL,
  "requestedModel" VARCHAR(96) NOT NULL,
  "returnedModel" VARCHAR(96),
  "policyVersion" VARCHAR(48) NOT NULL,
  "decision" "whatsapp"."ConversationModerationDecision" NOT NULL DEFAULT 'PENDING',
  "flagged" BOOLEAN,
  "categories" JSONB,
  "categoryScores" JSONB,
  "reasonCode" VARCHAR(96),
  "providerRequestId" VARCHAR(128),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "leaseToken" VARCHAR(128),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "assessedAt" TIMESTAMPTZ(3),
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByPlatformAdminId" TEXT,
  "reviewDisposition" VARCHAR(32),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConversationModerationAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConversationModerationAssessment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationModerationAssessment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationModerationAssessment_conversationMessageId_fkey" FOREIGN KEY ("conversationMessageId") REFERENCES "whatsapp"."ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationModerationAssessment_merchantSendCommandId_fkey" FOREIGN KEY ("merchantSendCommandId") REFERENCES "whatsapp"."MerchantConversationSendCommand"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationModerationAssessment_reviewedByPlatformAdminId_fkey" FOREIGN KEY ("reviewedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConversationModeration_exactly_one_subject_check" CHECK (
    ("conversationMessageId" IS NOT NULL) <> ("merchantSendCommandId" IS NOT NULL)
  ),
  CONSTRAINT "ConversationModeration_subject_pair_check" CHECK (
    ("subject"='HUMAN_COMMAND' AND "merchantSendCommandId" IS NOT NULL) OR
    ("subject" IN ('CUSTOMER_MESSAGE', 'AGENT_MESSAGE', 'AUTOMATION_MESSAGE') AND "conversationMessageId" IS NOT NULL)
  ),
  CONSTRAINT "ConversationModeration_digest_check" CHECK ("contentSha256" COLLATE "C" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ConversationModeration_input_kind_check" CHECK ("inputKind" IN ('TEXT','TRANSCRIPT','TEMPLATE_PARAMETERS')),
  CONSTRAINT "ConversationModeration_identity_text_check" CHECK (
    length(btrim("requestedModel"))>0 AND length(btrim("policyVersion"))>0
    AND ("returnedModel" IS NULL OR length(btrim("returnedModel"))>0)
    AND ("reasonCode" IS NULL OR length(btrim("reasonCode"))>0)
    AND ("providerRequestId" IS NULL OR length(btrim("providerRequestId"))>0)
  ),
  CONSTRAINT "ConversationModeration_json_check" CHECK (
    ("categories" IS NULL OR (jsonb_typeof("categories")='object' AND octet_length("categories"::text)<=8192)) AND
    ("categoryScores" IS NULL OR (jsonb_typeof("categoryScores")='object' AND octet_length("categoryScores"::text)<=16384))
  ),
  CONSTRAINT "ConversationModeration_review_tuple_check" CHECK (
    ("reviewedAt" IS NULL AND "reviewedByPlatformAdminId" IS NULL AND "reviewDisposition" IS NULL) OR
    ("reviewedAt" IS NOT NULL AND "reviewedByPlatformAdminId" IS NOT NULL AND
      "reviewDisposition" IS NOT NULL AND length(btrim("reviewDisposition"))>0 AND
      "decision" IN ('ALLOW','BLOCK','REVIEW_REQUIRED'))
  ),
  CONSTRAINT "ConversationModeration_state_tuple_check" CHECK (
    "attemptCount">=0 AND
    (("decision"='PENDING' AND "attemptCount"=0 AND "leaseToken" IS NULL AND
       "leaseExpiresAt" IS NULL AND "assessedAt" IS NULL AND "returnedModel" IS NULL AND
       "flagged" IS NULL AND "categories" IS NULL AND "categoryScores" IS NULL AND
       "reasonCode" IS NULL AND "providerRequestId" IS NULL)
    OR ("decision"='CHECKING' AND "attemptCount">0 AND "leaseToken" IS NOT NULL AND
       length(btrim("leaseToken"))>0 AND "leaseExpiresAt" IS NOT NULL AND
       "nextAttemptAt" IS NULL AND "assessedAt" IS NULL AND "returnedModel" IS NULL AND
       "flagged" IS NULL AND "categories" IS NULL AND "categoryScores" IS NULL AND
       "reasonCode" IS NULL AND "providerRequestId" IS NULL)
    OR ("decision"='RETRYABLE_ERROR' AND "attemptCount">0 AND "leaseToken" IS NULL AND
       "leaseExpiresAt" IS NULL AND "nextAttemptAt" IS NOT NULL AND
       "assessedAt" IS NOT NULL AND "reasonCode" IS NOT NULL AND
       "flagged" IS NULL AND "categories" IS NULL AND "categoryScores" IS NULL)
    OR ("decision" IN ('ALLOW','BLOCK','REVIEW_REQUIRED') AND "attemptCount">0 AND
       "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "nextAttemptAt" IS NULL AND
       "assessedAt" IS NOT NULL AND "returnedModel" IS NOT NULL AND
       ("decision"<>'ALLOW' OR "flagged" IS FALSE) AND
       ("decision"<>'BLOCK' OR "flagged" IS TRUE OR "reasonCode" IS NOT NULL)))
  )
);

CREATE UNIQUE INDEX "ConversationModeration_message_content_uq" ON "whatsapp"."ConversationModerationAssessment"
  ("conversationMessageId", "policyVersion", "contentSha256");
CREATE UNIQUE INDEX "ConversationModeration_command_content_uq" ON "whatsapp"."ConversationModerationAssessment"
  ("merchantSendCommandId", "policyVersion", "contentSha256");
CREATE INDEX "ConversationModeration_due_idx" ON "whatsapp"."ConversationModerationAssessment"
  ("decision", "nextAttemptAt", "leaseExpiresAt", "createdAt", "id");
CREATE INDEX "ConversationModeration_shop_incidents_idx" ON "whatsapp"."ConversationModerationAssessment"
  ("shopId", "createdAt", "id");
CREATE INDEX "ConversationModeration_conversation_idx" ON "whatsapp"."ConversationModerationAssessment"
  ("conversationId", "createdAt", "id");
CREATE INDEX "ConversationModeration_review_idx" ON "whatsapp"."ConversationModerationAssessment"
  ("reviewedByPlatformAdminId", "reviewedAt");

-- A recovery-linked Conversation often has shopId=NULL. Resolve the canonical
-- tenant through CheckoutRecovery and protect against mismatched FK principals.
-- Message role/direction and stored effective TEXT/TRANSCRIPT digests are
-- checked against actual rows; template-parameter rendering is owned by BG006
-- because provider-specific deterministic rendering is not a DB primitive.
CREATE FUNCTION "whatsapp".arch040_moderation_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  conversation_shop TEXT;
  recovery_id TEXT;
  recovery_shop TEXT;
  actual_shop TEXT;
  message_conversation TEXT;
  message_direction "whatsapp"."MessageDirection";
  message_sender "whatsapp"."MessageSenderType";
  message_content TEXT;
  command_text TEXT;
  message_type "whatsapp"."MessageContentType";
  transcription_state "whatsapp"."MessageTranscriptionStatus";
  command_kind "whatsapp"."MerchantConversationSendKind";
  command_conversation TEXT;
  command_shop TEXT;
BEGIN
  SELECT c."shopId",c."checkoutRecoveryId" INTO conversation_shop,recovery_id
    FROM "whatsapp"."Conversation" c WHERE c."id"=NEW."conversationId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ARCH040 moderation conversation not found' USING ERRCODE='23514';
  END IF;
  IF recovery_id IS NOT NULL THEN
    SELECT r."shopId" INTO recovery_shop FROM "commerce"."CheckoutRecovery" r
      WHERE r."id"=recovery_id FOR SHARE;
    IF recovery_shop IS NULL OR (conversation_shop IS NOT NULL AND conversation_shop<>recovery_shop) THEN
      RAISE EXCEPTION 'ARCH040 moderation recovery tenant mismatch' USING ERRCODE='23514';
    END IF;
    actual_shop := recovery_shop;
  ELSE
    actual_shop := conversation_shop;
  END IF;
  IF actual_shop IS NULL OR actual_shop<>NEW."shopId" THEN
    RAISE EXCEPTION 'ARCH040 moderation tenant mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW."subject"='HUMAN_COMMAND' THEN
    IF recovery_id IS NULL THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN command requires recovery' USING ERRCODE='23514';
    END IF;
    SELECT cmd."shopId",cmd."conversationId",cmd."kind",cmd."textBody"
      INTO command_shop,command_conversation,command_kind,command_text
      FROM "whatsapp"."MerchantConversationSendCommand" cmd
      WHERE cmd."id"=NEW."merchantSendCommandId" FOR SHARE;
    IF NOT FOUND OR command_shop<>actual_shop OR command_conversation<>NEW."conversationId" OR
       (command_kind='HUMAN_TEXT' AND NEW."inputKind"<>'TEXT') OR
       (command_kind='RECOVERY_FOLLOW_UP_TEMPLATE' AND NEW."inputKind"<>'TEMPLATE_PARAMETERS') THEN
      RAISE EXCEPTION 'ARCH040 moderation command subject/input mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW."inputKind"='TEXT' AND encode(sha256(convert_to(command_text,'UTF8')),'hex')<>NEW."contentSha256" THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN text digest mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT m."conversationId",m."direction",m."senderType",m."contentType",m."transcriptionStatus",m."content"
      INTO message_conversation,message_direction,message_sender,message_type,transcription_state,message_content
      FROM "whatsapp"."ConversationMessage" m
      WHERE m."id"=NEW."conversationMessageId" FOR SHARE;
    IF NOT FOUND OR message_conversation<>NEW."conversationId" OR NOT (
      (NEW."subject"='CUSTOMER_MESSAGE' AND message_direction='INBOUND' AND message_sender='CUSTOMER') OR
      (NEW."subject"='AGENT_MESSAGE' AND message_direction='OUTBOUND' AND message_sender='AGENT') OR
      (NEW."subject"='AUTOMATION_MESSAGE' AND message_direction='OUTBOUND' AND message_sender='AUTOMATION')
    ) OR NOT (
      (NEW."subject"='CUSTOMER_MESSAGE' AND (
        (NEW."inputKind"='TEXT' AND message_type='TEXT') OR
        (NEW."inputKind"='TRANSCRIPT' AND message_type='AUDIO' AND transcription_state='COMPLETED'))) OR
      (NEW."subject" IN ('AGENT_MESSAGE','AUTOMATION_MESSAGE') AND
       NEW."inputKind" IN ('TEXT','TEMPLATE_PARAMETERS') AND message_type='TEXT')
    ) THEN
      RAISE EXCEPTION 'ARCH040 moderation message actor/direction/input mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW."inputKind" IN ('TEXT','TRANSCRIPT') AND
       encode(sha256(convert_to(message_content,'UTF8')),'hex')<>NEW."contentSha256" THEN
      RAISE EXCEPTION 'ARCH040 moderation message text digest mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Content/subject identity is immutable; an edited message must use a *new*
-- content digest assessment. Completion of an active lease requires its actual
-- token, carried through transaction-local context by the SQL completion API.
CREATE FUNCTION "whatsapp".arch040_moderation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_token TEXT;
  admin_actor TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW."decision"<>'PENDING' OR NEW."attemptCount"<>0 OR
       NEW."reviewedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ARCH040 moderation starts PENDING without review' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW."id",NEW."shopId",NEW."conversationId",NEW."subject",NEW."conversationMessageId",
    NEW."merchantSendCommandId",NEW."contentSha256",NEW."inputKind",NEW."requestedModel",
    NEW."policyVersion",NEW."createdAt") IS DISTINCT FROM
    ROW(OLD."id",OLD."shopId",OLD."conversationId",OLD."subject",OLD."conversationMessageId",
    OLD."merchantSendCommandId",OLD."contentSha256",OLD."inputKind",OLD."requestedModel",
    OLD."policyVersion",OLD."createdAt") THEN
    RAISE EXCEPTION 'ARCH040 moderation subject/content/policy identity immutable' USING ERRCODE='23514';
  END IF;
  -- Reviews are one-time attributed annotations, never a replacement decision.
  IF ROW(NEW."reviewedAt",NEW."reviewedByPlatformAdminId",NEW."reviewDisposition") IS DISTINCT FROM
     ROW(OLD."reviewedAt",OLD."reviewedByPlatformAdminId",OLD."reviewDisposition") THEN
    admin_actor := NULLIF(current_setting('moda.moderation_reviewer',true),'');
    IF OLD."reviewedAt" IS NOT NULL OR NEW."reviewedAt" IS NULL OR
       admin_actor IS DISTINCT FROM NEW."reviewedByPlatformAdminId" OR
       NOT EXISTS(SELECT 1 FROM "public"."PlatformAdmin" a
         WHERE a."id"=NEW."reviewedByPlatformAdminId" AND a."active"=true) THEN
      RAISE EXCEPTION 'ARCH040 moderation review requires active attributed admin' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD."decision" IN ('ALLOW','BLOCK','REVIEW_REQUIRED') THEN
    IF ROW(NEW."decision",NEW."flagged",NEW."categories",NEW."categoryScores",
      NEW."returnedModel",NEW."reasonCode",NEW."providerRequestId",NEW."attemptCount",
      NEW."nextAttemptAt",NEW."leaseToken",NEW."leaseExpiresAt",NEW."assessedAt") IS DISTINCT FROM
      ROW(OLD."decision",OLD."flagged",OLD."categories",OLD."categoryScores",
      OLD."returnedModel",OLD."reasonCode",OLD."providerRequestId",OLD."attemptCount",
      OLD."nextAttemptAt",OLD."leaseToken",OLD."leaseExpiresAt",OLD."assessedAt") THEN
      RAISE EXCEPTION 'ARCH040 moderation terminal classifier outcome immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" THEN
    RAISE EXCEPTION 'ARCH040 moderation review requires terminal outcome' USING ERRCODE='23514';
  END IF;
  IF NEW."decision"='CHECKING' AND OLD."decision" IN ('PENDING','RETRYABLE_ERROR') THEN
    IF (OLD."nextAttemptAt" IS NOT NULL AND OLD."nextAttemptAt">clock_timestamp()) OR
       NEW."attemptCount"<>OLD."attemptCount"+1 OR
       NEW."leaseToken" IS NULL OR length(btrim(NEW."leaseToken"))=0 OR
       NEW."leaseExpiresAt"<=clock_timestamp() THEN
      RAISE EXCEPTION 'ARCH040 moderation invalid new claim' USING ERRCODE='23514';
    END IF;
  ELSIF NEW."decision"='CHECKING' AND OLD."decision"='CHECKING' THEN
    IF OLD."leaseExpiresAt">clock_timestamp() THEN
      owner_token := NULLIF(current_setting('moda.moderation_lease_token',true),'');
      IF owner_token IS DISTINCT FROM OLD."leaseToken" OR
         NEW."leaseToken" IS DISTINCT FROM OLD."leaseToken" OR
         NEW."attemptCount"<>OLD."attemptCount" OR
         NEW."leaseExpiresAt"<=OLD."leaseExpiresAt" THEN
        RAISE EXCEPTION 'ARCH040 moderation active lease cannot be stolen' USING ERRCODE='23514';
      END IF;
    ELSIF NEW."leaseToken" IS NOT DISTINCT FROM OLD."leaseToken" OR
          NEW."attemptCount"<>OLD."attemptCount"+1 OR
          NEW."leaseExpiresAt"<=clock_timestamp() THEN
      RAISE EXCEPTION 'ARCH040 moderation expired lease reclaim invalid' USING ERRCODE='23514';
    END IF;
  ELSIF OLD."decision"='CHECKING' AND NEW."decision" IN ('ALLOW','BLOCK','REVIEW_REQUIRED','RETRYABLE_ERROR') THEN
    owner_token := NULLIF(current_setting('moda.moderation_lease_token',true),'');
    IF owner_token IS DISTINCT FROM OLD."leaseToken" OR
       OLD."leaseExpiresAt"<=clock_timestamp() OR
       NEW."attemptCount"<>OLD."attemptCount" OR
       NEW."leaseToken" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL OR
       NEW."assessedAt" IS NULL OR
       (NEW."decision"='RETRYABLE_ERROR' AND NEW."nextAttemptAt"<=clock_timestamp()) THEN
      RAISE EXCEPTION 'ARCH040 moderation completion requires live matching lease' USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'ARCH040 moderation invalid classifier transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Preserve the link's actor/tenant after an assessment has been attached.
-- Body changes remain possible before provider admission, but invalidate the
-- former content digest; the new effective content needs a new assessment.
CREATE FUNCTION "whatsapp".arch040_moderation_parent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ConversationMessage' THEN
    IF ROW(NEW."conversationId",NEW."direction",NEW."senderType") IS DISTINCT FROM
       ROW(OLD."conversationId",OLD."direction",OLD."senderType") AND
       EXISTS(SELECT 1 FROM "whatsapp"."ConversationModerationAssessment" a
         WHERE a."conversationMessageId"=OLD."id") THEN
      RAISE EXCEPTION 'ARCH040 assessed message actor and conversation immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='Conversation' THEN
    IF ROW(NEW."shopId",NEW."checkoutRecoveryId") IS DISTINCT FROM
       ROW(OLD."shopId",OLD."checkoutRecoveryId") AND
       EXISTS(SELECT 1 FROM "whatsapp"."ConversationModerationAssessment" a
         WHERE a."conversationId"=OLD."id") THEN
      RAISE EXCEPTION 'ARCH040 assessed conversation tenant immutable' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='CheckoutRecovery' THEN
    IF NEW."shopId" IS DISTINCT FROM OLD."shopId" AND
       EXISTS(SELECT 1 FROM "whatsapp"."ConversationModerationAssessment" a
         JOIN "whatsapp"."Conversation" c ON c."id"=a."conversationId"
         WHERE c."checkoutRecoveryId"=OLD."id") THEN
      RAISE EXCEPTION 'ARCH040 assessed recovery tenant immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER arch040_moderation_subject_guard BEFORE INSERT ON "whatsapp"."ConversationModerationAssessment"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_moderation_subject_guard();
CREATE TRIGGER arch040_moderation_guard BEFORE INSERT OR UPDATE ON "whatsapp"."ConversationModerationAssessment"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_moderation_guard();
CREATE TRIGGER arch040_moderation_message_parent BEFORE UPDATE OF "conversationId","direction","senderType" ON "whatsapp"."ConversationMessage"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_moderation_parent_guard();
CREATE TRIGGER arch040_moderation_conversation_parent BEFORE UPDATE OF "shopId","checkoutRecoveryId" ON "whatsapp"."Conversation"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_moderation_parent_guard();
CREATE TRIGGER arch040_moderation_recovery_parent BEFORE UPDATE OF "shopId" ON "commerce"."CheckoutRecovery"
  FOR EACH ROW EXECUTE FUNCTION "whatsapp".arch040_moderation_parent_guard();

-- One idempotent row per (linked subject, policyVersion, digest). Two INSERT
-- writers racing on a unique key converge after PostgreSQL resolves conflict.
-- The function intentionally never updates an existing completed assessment.
CREATE FUNCTION "whatsapp".arch040_moderation_create_or_reuse(
  p_id TEXT, p_shop TEXT, p_conversation TEXT,
  p_subject "whatsapp"."ConversationModerationSubject",
  p_message TEXT, p_command TEXT, p_digest TEXT,
  p_input_kind TEXT, p_requested_model TEXT, p_policy_version TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE assessment_id TEXT;
BEGIN
  INSERT INTO "whatsapp"."ConversationModerationAssessment" (
    "id","shopId","conversationId","subject","conversationMessageId",
    "merchantSendCommandId","contentSha256","inputKind","requestedModel",
    "policyVersion","updatedAt"
  ) VALUES (p_id,p_shop,p_conversation,p_subject,p_message,p_command,
    p_digest,p_input_kind,p_requested_model,p_policy_version,clock_timestamp())
  ON CONFLICT DO NOTHING RETURNING "id" INTO assessment_id;
  IF assessment_id IS NULL THEN
    SELECT "id" INTO assessment_id FROM "whatsapp"."ConversationModerationAssessment"
    WHERE "subject"=p_subject AND "shopId"=p_shop
      AND "conversationId"=p_conversation AND "policyVersion"=p_policy_version
      AND "contentSha256"=p_digest AND "inputKind"=p_input_kind
      AND "requestedModel"=p_requested_model
      AND ((p_message IS NOT NULL AND "conversationMessageId"=p_message) OR
           (p_command IS NOT NULL AND "merchantSendCommandId"=p_command));
    IF assessment_id IS NULL THEN
      RAISE EXCEPTION 'ARCH040 moderation conflict does not match existing content identity'
        USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN assessment_id;
END $$;

-- Lock-free OpenAI I/O sits *between* the CHECKING lease claim and this short
-- compare-and-swap completion transaction. FALSE means stale/unknown token:
-- it must never be treated as permission for provider dispatch.
CREATE FUNCTION "whatsapp".arch040_moderation_complete(
  p_id TEXT, p_token TEXT, p_decision "whatsapp"."ConversationModerationDecision",
  p_returned_model TEXT, p_flagged BOOLEAN, p_categories JSONB, p_scores JSONB,
  p_reason TEXT, p_provider_request_id TEXT, p_next_attempt TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  changed INTEGER;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token))=0 OR
     p_decision NOT IN ('ALLOW','BLOCK','REVIEW_REQUIRED','RETRYABLE_ERROR') THEN
    RAISE EXCEPTION 'ARCH040 invalid moderation completion' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('moda.moderation_lease_token',p_token,true);
  UPDATE "whatsapp"."ConversationModerationAssessment" SET
    "decision"=p_decision,
    "returnedModel"=p_returned_model,
    "flagged"=p_flagged,
    "categories"=p_categories,
    "categoryScores"=p_scores,
    "reasonCode"=p_reason,
    "providerRequestId"=p_provider_request_id,
    "assessedAt"=clock_timestamp(),
    "leaseToken"=NULL,"leaseExpiresAt"=NULL,
    "nextAttemptAt"=CASE WHEN p_decision='RETRYABLE_ERROR' THEN p_next_attempt ELSE NULL END,
    "updatedAt"=clock_timestamp()
  WHERE "id"=p_id AND "decision"='CHECKING' AND "leaseToken"=p_token
    AND "leaseExpiresAt">clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('moda.moderation_lease_token','',true);
  RETURN changed=1;
END $$;

CREATE FUNCTION "whatsapp".arch040_moderation_renew_lease(
  p_id TEXT, p_token TEXT, p_expires TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE changed INTEGER;
BEGIN
  PERFORM set_config('moda.moderation_lease_token',coalesce(p_token,''),true);
  UPDATE "whatsapp"."ConversationModerationAssessment" SET "leaseExpiresAt"=p_expires,
    "updatedAt"=clock_timestamp()
  WHERE "id"=p_id AND "decision"='CHECKING' AND "leaseToken"=p_token
    AND "leaseExpiresAt">clock_timestamp() AND p_expires>"leaseExpiresAt";
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('moda.moderation_lease_token','',true);
  RETURN changed=1;
END $$;

-- Admin authorisation is established by the ADMIN service, then passed as
-- an authenticated platform admin ID. The FK/active-state/one-time binding are
-- checked here; this annotation cannot turn REVIEW_REQUIRED into ALLOW.
CREATE FUNCTION "whatsapp".arch040_moderation_record_review(
  p_id TEXT, p_admin_id TEXT, p_disposition TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE changed INTEGER;
BEGIN
  IF p_admin_id IS NULL OR p_disposition IS NULL OR length(btrim(p_disposition))=0 THEN
    RAISE EXCEPTION 'ARCH040 moderation review missing identity/disposition' USING ERRCODE='23514';
  END IF;
  PERFORM set_config('moda.moderation_reviewer',p_admin_id,true);
  UPDATE "whatsapp"."ConversationModerationAssessment" SET
    "reviewedAt"=clock_timestamp(),"reviewedByPlatformAdminId"=p_admin_id,
    "reviewDisposition"=p_disposition,"updatedAt"=clock_timestamp()
  WHERE "id"=p_id AND "reviewedAt" IS NULL
    AND "decision" IN ('ALLOW','BLOCK','REVIEW_REQUIRED');
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM set_config('moda.moderation_reviewer','',true);
  RETURN changed=1;
END $$;

-- Deliberately no moderation retention TTL or outbox/dispatch hook.
