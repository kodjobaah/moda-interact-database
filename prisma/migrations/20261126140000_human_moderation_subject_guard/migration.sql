-- Forward correction: R15 replaced the prepared-body subject guard with a
-- raw-text digest comparison. Restore the prepared-body prerequisite without
-- duplicating Background's HUMAN_TEXT digest/ALLOW check. No data rewrite,
-- trigger replacement, schema column change or other moderation policy change.
BEGIN;

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
    -- Require the frozen body, but leave its content-specific assessment and
    -- final dispatch allowance to Background. Do not re-hash HUMAN_TEXT in SQL.
    IF command_kind='HUMAN_TEXT' AND command_text IS NULL THEN
      RAISE EXCEPTION 'ARCH040 moderation HUMAN text requires frozen prepared content' USING ERRCODE='23514';
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
       encode(sha256(convert_to(message_content,'UTF8')),'hex')<>NEW."contentSha256" AND NOT (
         NEW."subject"='CUSTOMER_MESSAGE' AND NEW."inputKind" IN ('TEXT','TRANSCRIPT') AND
         whatsapp.arch076_r15_clause_subject(NEW.id,NEW."conversationMessageId",NEW."conversationId",NEW."shopId",NEW."contentSha256",NEW."policyVersion",NEW."requestedModel",message_content,NEW."inputKind")
       ) THEN
      RAISE EXCEPTION 'ARCH040 moderation message text digest mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
