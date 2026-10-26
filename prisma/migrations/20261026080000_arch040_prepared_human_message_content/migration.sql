-- ARCH-040-DATABASE-007: immutable accepted merchant intent and durable, set-once
-- customer-visible HUMAN_TEXT preparation. No backfill or provider-permit change.
ALTER TABLE "whatsapp"."MerchantConversationSendCommand"
  ADD COLUMN "preparedTextBody" TEXT,
  ADD COLUMN "preparedWrapperEvidence" JSONB,
  ADD COLUMN "preparedAt" TIMESTAMPTZ(3);

-- Both triggers are already attached. Replace the currently installed function
-- bodies only; preserve historical migrations and all unrelated guard branches.

CREATE OR REPLACE FUNCTION "whatsapp".arch040_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recovery_id TEXT;
DECLARE linked_dispatch_key TEXT;
DECLARE freezing_prepared_body BOOLEAN := FALSE;
BEGIN
  SELECT c."checkoutRecoveryId" INTO recovery_id FROM "whatsapp"."Conversation" c
    JOIN "commerce"."CheckoutRecovery" r ON r."id"=c."checkoutRecoveryId"
    WHERE c."id"=NEW."conversationId" AND r."shopId"=NEW."shopId"
      AND (c."shopId" IS NULL OR c."shopId"=NEW."shopId");
  IF recovery_id IS NULL THEN
    RAISE EXCEPTION 'ARCH040 command requires recovery owned by shop' USING ERRCODE='23514';
  END IF;
  IF NEW."recoveryOutreachAttemptId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "commerce"."RecoveryOutreachAttempt" a
    WHERE a."id"=NEW."recoveryOutreachAttemptId" AND a."checkoutRecoveryId"=recovery_id
      AND (NEW."outboundMessageId" IS NULL OR a."outboundMessageId" IS NULL
           OR NEW."outboundMessageId"=a."outboundMessageId")
  ) THEN
    RAISE EXCEPTION 'ARCH040 follow-up must refer to same recovery' USING ERRCODE='23514';
  END IF;
  IF NEW."outboundMessageId" IS NOT NULL THEN
    SELECT m."providerDispatchKey" INTO linked_dispatch_key FROM "whatsapp"."ConversationMessage" m
      WHERE m."id"=NEW."outboundMessageId" AND m."conversationId"=NEW."conversationId"
        AND m."direction"='OUTBOUND' AND m."senderType"='HUMAN';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ARCH040 command outbound message is not HUMAN in conversation' USING ERRCODE='23514';
    END IF;
    IF NEW."providerDispatchKey" IS NOT NULL AND
      linked_dispatch_key IS DISTINCT FROM NEW."providerDispatchKey" THEN
      RAISE EXCEPTION 'ARCH040 command and message provider dispatch mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- A command's accepted text is immutable intent. Preparing a customer-visible
    -- body is a separate, strictly once-only operation under its current lease.
    IF OLD."preparedTextBody" IS NOT NULL OR OLD."preparedWrapperEvidence" IS NOT NULL
       OR OLD."preparedAt" IS NOT NULL THEN
      IF ROW(NEW."preparedTextBody",NEW."preparedWrapperEvidence",NEW."preparedAt")
         IS DISTINCT FROM ROW(OLD."preparedTextBody",OLD."preparedWrapperEvidence",OLD."preparedAt") THEN
        RAISE EXCEPTION 'ARCH040 prepared HUMAN content is immutable' USING ERRCODE='23514';
      END IF;
    ELSIF NEW."preparedTextBody" IS NOT NULL OR NEW."preparedWrapperEvidence" IS NOT NULL
       OR NEW."preparedAt" IS NOT NULL THEN
      IF NEW."preparedTextBody" IS NULL OR NEW."preparedTextBody" !~ '[^[:space:]]'
         OR NEW."preparedWrapperEvidence" IS NULL OR NEW."preparedAt" IS NULL
         OR OLD."kind"<>'HUMAN_TEXT' OR OLD."state"<>'CLAIMED'
         OR OLD."leaseToken" IS NULL OR OLD."leaseExpiresAt" IS NULL
         OR OLD."leaseExpiresAt"<=statement_timestamp()
         OR OLD."providerDispatchKey" IS NOT NULL THEN
        RAISE EXCEPTION 'ARCH040 prepared HUMAN content requires current claimed lease and complete body' USING ERRCODE='23514';
      END IF;
      freezing_prepared_body := TRUE;
    END IF;
    IF OLD."outboundMessageId" IS NOT NULL AND NEW."outboundMessageId" IS DISTINCT FROM OLD."outboundMessageId" THEN
      RAISE EXCEPTION 'ARCH040 outbound message identity is set-once' USING ERRCODE='23514';
    END IF;
    IF ROW(NEW."id",NEW."shopId",NEW."conversationId",NEW."idempotencyKey",NEW."payloadSha256",
       NEW."expectedControlRevision",NEW."kind",NEW."recipientSnapshot",NEW."textBody",NEW."templateName",
       NEW."templateLanguageCode",NEW."templateParameters",NEW."recoveryOutreachAttemptId",NEW."acceptedAt",NEW."createdAt")
       IS DISTINCT FROM ROW(OLD."id",OLD."shopId",OLD."conversationId",OLD."idempotencyKey",OLD."payloadSha256",
       OLD."expectedControlRevision",OLD."kind",OLD."recipientSnapshot",OLD."textBody",OLD."templateName",
       OLD."templateLanguageCode",OLD."templateParameters",OLD."recoveryOutreachAttemptId",OLD."acceptedAt",OLD."createdAt") THEN
      RAISE EXCEPTION 'ARCH040 accepted command identity/payload immutable' USING ERRCODE='23514';
    END IF;
    IF OLD."providerDispatchKey" IS NOT NULL AND ROW(NEW."providerDispatchKey",NEW."providerDispatchAdmittedAt",
         NEW."providerDispatchControlRevision",NEW."providerDispatchRestrictionRevision",NEW."outboundMessageId") IS DISTINCT FROM
       ROW(OLD."providerDispatchKey",OLD."providerDispatchAdmittedAt",OLD."providerDispatchControlRevision",
         OLD."providerDispatchRestrictionRevision",OLD."outboundMessageId") THEN
      RAISE EXCEPTION 'ARCH040 one-way provider permit immutable' USING ERRCODE='23514';
    END IF;
    IF NEW."dispatchAttemptCount" < OLD."dispatchAttemptCount" THEN
      RAISE EXCEPTION 'ARCH040 dispatch attempt count cannot decrease' USING ERRCODE='23514';
    END IF;
    IF OLD."state" IN ('SENT','CANCELLED') AND NEW."state"<>OLD."state" THEN
      RAISE EXCEPTION 'ARCH040 terminal command cannot reopen' USING ERRCODE='23514';
    END IF;
    IF OLD."providerDispatchKey" IS NOT NULL AND NEW."state" IN ('ACCEPTED','CLAIMED','CANCELLED') THEN
      RAISE EXCEPTION 'ARCH040 admitted command cannot be resent' USING ERRCODE='23514';
    END IF;
    IF NEW."state"='DISPATCH_ADMITTED' AND OLD."state"<>'DISPATCH_ADMITTED' THEN
      IF OLD."state"<>'CLAIMED' OR OLD."leaseToken" IS NULL
         OR OLD."leaseExpiresAt" <= statement_timestamp()
         OR NEW."providerDispatchControlRevision" IS DISTINCT FROM NEW."expectedControlRevision" THEN
        RAISE EXCEPTION 'ARCH040 only current claim can obtain provider permit' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW."state"='CLAIMED' AND OLD."state"='CLAIMED' AND (
       OLD."leaseExpiresAt">statement_timestamp() OR NEW."leaseToken" IS NOT DISTINCT FROM OLD."leaseToken"
       OR NEW."dispatchAttemptCount"<>OLD."dispatchAttemptCount"+1) AND NOT (
         -- Ordinary CLAIMED->CLAIMED writes remain rejected. Exception only
         -- for first freeze (plus ORM updatedAt), with every other field intact.
         freezing_prepared_body AND
         (to_jsonb(NEW) - ARRAY['preparedTextBody','preparedWrapperEvidence','preparedAt','updatedAt'])
         IS NOT DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['preparedTextBody','preparedWrapperEvidence','preparedAt','updatedAt'])
       ) THEN
      RAISE EXCEPTION 'ARCH040 cannot steal active lease' USING ERRCODE='23514';
    END IF;
    IF NEW."state"='CLAIMED' AND OLD."state" IN ('ACCEPTED','FAILED') AND (
       OLD."providerDispatchKey" IS NOT NULL OR NEW."dispatchAttemptCount"<>OLD."dispatchAttemptCount"+1
       OR NEW."leaseExpiresAt"<=statement_timestamp()) THEN
      RAISE EXCEPTION 'ARCH040 invalid lease acquisition' USING ERRCODE='23514';
    END IF;
    IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
      (OLD."state" IN ('ACCEPTED','FAILED') AND NEW."state" IN ('CLAIMED','CANCELLED')) OR
      (OLD."state"='CLAIMED' AND NEW."state" IN ('ACCEPTED','DISPATCH_ADMITTED','FAILED','CANCELLED')) OR
      (OLD."state"='DISPATCH_ADMITTED' AND NEW."state" IN ('SENT','UNKNOWN','FAILED')) OR
      (OLD."state"='UNKNOWN' AND NEW."state" IN ('SENT','FAILED'))
    ) THEN
      RAISE EXCEPTION 'ARCH040 invalid command state transition' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW."state"<>'ACCEPTED' OR NEW."dispatchAttemptCount"<>0 OR NEW."providerDispatchKey" IS NOT NULL OR
       NEW."outboundMessageId" IS NOT NULL OR NEW."leaseToken" IS NOT NULL OR
       NEW."preparedTextBody" IS NOT NULL OR NEW."preparedWrapperEvidence" IS NOT NULL OR
       NEW."preparedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'ARCH040 new command must be accepted intent only' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "whatsapp".arch040_moderation_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  command_template_name TEXT;
  command_template_language TEXT;
  command_template_parameters JSONB;
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
    SELECT cmd."shopId",cmd."conversationId",cmd."kind",cmd."preparedTextBody",
           cmd."templateName",cmd."templateLanguageCode",cmd."templateParameters"
      INTO command_shop,command_conversation,command_kind,command_text,
           command_template_name,command_template_language,command_template_parameters
      FROM "whatsapp"."MerchantConversationSendCommand" cmd
      WHERE cmd."id"=NEW."merchantSendCommandId" FOR SHARE;
    IF NOT FOUND OR command_shop<>actual_shop OR command_conversation<>NEW."conversationId" OR
       (command_kind='HUMAN_TEXT' AND NEW."inputKind"<>'TEXT') OR
       (command_kind='RECOVERY_FOLLOW_UP_TEMPLATE' AND NEW."inputKind"<>'TEMPLATE_PARAMETERS') THEN
      RAISE EXCEPTION 'ARCH040 moderation command subject/input mismatch' USING ERRCODE='23514';
    END IF;
    -- New HUMAN_TEXT assessments require durable frozen content. Template
    -- parameter assessments continue using their original canonical input.
    IF command_kind='HUMAN_TEXT' AND command_text IS NULL THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN text requires frozen prepared content' USING ERRCODE='23514';
    END IF;
    IF NEW."inputKind"='TEXT' AND encode(sha256(convert_to(command_text,'UTF8')),'hex')
       IS DISTINCT FROM NEW."contentSha256" THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN text digest mismatch' USING ERRCODE='23514';
    END IF;
    IF NEW."inputKind"='TEMPLATE_PARAMETERS' AND
       encode(sha256(convert_to(
         "whatsapp".arch040_moderation_template_input_v1(
           command_template_name,command_template_language,command_template_parameters),
         'UTF8')),'hex') IS DISTINCT FROM NEW."contentSha256" THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN template digest mismatch' USING ERRCODE='23514';
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
       NEW."inputKind"='TEXT' AND message_type='TEXT')
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
