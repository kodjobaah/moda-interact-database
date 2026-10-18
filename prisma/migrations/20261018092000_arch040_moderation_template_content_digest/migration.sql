-- ARCH-040-DATABASE-005 Attempt 2: bind template moderation to the
-- persisted provider-template identity and parameters. This is a forward
-- correction because the earlier moderation migration was already published.
--
-- The exact moderation input is the UTF-8 encoding of the TEXT result from
-- this function, NOT arbitrary caller-rendered content or raw Meta template
-- text. The contract key fixes version 1. Object key order is normalised by
-- PostgreSQL JSONB; array element order is preserved. BG006 must use this
-- returned text verbatim as its classifier input and compute the SHA-256 of
-- those exact bytes. No second copy of content is stored in assessments.
-- A provider-managed template BODY is not present in the persisted tuple;
-- template body approval/selection is a separate provider/template policy.
CREATE FUNCTION "whatsapp".arch040_moderation_template_input_v1(
  p_template_name TEXT,
  p_language_code TEXT,
  p_template_parameters JSONB
) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'contract', 'moda.whatsapp.template-parameters.v1',
    'templateName', p_template_name,
    'languageCode', p_language_code,
    'parametersPresent', p_template_parameters IS NOT NULL,
    'parameters', p_template_parameters
  )::text;
$$;

-- Prepared AGENT/AUTOMATION ConversationMessage has content TEXT but no
-- authoritative persisted template-name/language/parameters tuple. Until
-- such a tuple is persisted and verifiable, TEMPLATE_PARAMETERS on messages
-- must fail closed. Prepared outbound text remains supported as TEXT.
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
    SELECT cmd."shopId",cmd."conversationId",cmd."kind",cmd."textBody",
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
