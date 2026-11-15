-- R15 offsets are JavaScript UTF-16 units, not PostgreSQL code points.
-- PostgreSQL text cannot contain lone surrogate code points; reject boundaries
-- inside astral characters and preserve every other byte without normalization.
CREATE FUNCTION whatsapp.arch076_utf16_slice(value TEXT, start_unit INTEGER, end_unit INTEGER)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE i INTEGER; units INTEGER := 0; first_char INTEGER; last_char INTEGER; width INTEGER;
BEGIN
  IF start_unit < 0 OR end_unit <= start_unit THEN RETURN NULL; END IF;
  FOR i IN 1..char_length(value) LOOP
    IF units=start_unit THEN first_char:=i; END IF;
    IF units=end_unit THEN last_char:=i; EXIT; END IF;
    width:=CASE WHEN ascii(substr(value,i,1))>65535 THEN 2 ELSE 1 END;
    units:=units+width;
  END LOOP;
  IF units=end_unit AND last_char IS NULL THEN last_char:=char_length(value)+1; END IF;
  IF first_char IS NULL OR last_char IS NULL THEN RETURN NULL; END IF;
  RETURN substr(value,first_char,last_char-first_char);
END $$;

-- Hash the actual persisted normalized JSONB source, using one versioned SQL
-- serialization shared by producer reads and freeze checks. This deliberately
-- does not pretend PostgreSQL text is JavaScript canonicalJson serialization.
CREATE FUNCTION whatsapp.arch076_r15_audio_source_sha256(raw_input JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(E'arch076.raw-input-jsonb-text.v1\n'||raw_input::text,'UTF8')),'hex')
$$;

-- Verify immutable transcript provenance against the authentic durable message.
CREATE FUNCTION whatsapp.arch076_r15_audio_matches(p JSONB, message_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM whatsapp."ConversationMessage" m WHERE m.id=message_id
  AND m.direction='INBOUND' AND m."senderType"='CUSTOMER'
  AND m."contentType"='AUDIO' AND m."transcriptionStatus"='COMPLETED'
  AND p->'schemaVersion'='1'::jsonb AND p->'verified'='true'::jsonb
  AND p->>'providerMessageId'=m."providerMessageId"
  AND p->>'transcriptSha256'=encode(sha256(convert_to(m.content,'UTF8')),'hex')
  AND p->>'mediaIdSha256'=encode(sha256(convert_to(m."providerMediaId",'UTF8')),'hex')
  AND p->>'mediaSha256' IS NOT DISTINCT FROM m."providerMediaSha256"
  AND p->>'provider'=m."transcriptionProvider" AND p->>'model'=m."transcriptionModel"
  AND p->'durationMs'=to_jsonb(m."mediaDurationMs") AND m."transcriptionCompletedAt" IS NOT NULL
  AND p->>'sourceSha256' ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(p->'operationRows')='array' AND jsonb_array_length(p->'operationRows')>0)
$$;

-- This is an attestation lookup, not an eligibility/assignment-selection query.
-- Only immutable resolved evidence authorizes a second, independently moderated
-- subject on the authentic message. No live control/credit/window predicates.
CREATE FUNCTION whatsapp.arch076_r15_clause_subject(
  assessment_id TEXT, message_id TEXT, conversation_id TEXT, shop_id TEXT,
  digest TEXT, policy TEXT, model TEXT, full_content TEXT, input_kind TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE current_turn whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE;
  original whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE;
  prompt whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE;
  d JSONB; clause TEXT; original_message whatsapp."ConversationMessage"%ROWTYPE;
BEGIN
  SELECT * INTO current_turn FROM whatsapp."RecoveryBasketRoutingTurn"
    WHERE "inboundProviderMessageId"=(SELECT "providerMessageId" FROM whatsapp."ConversationMessage" WHERE id=message_id) FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  d:=current_turn."routingDecision";
  IF input_kind='TRANSCRIPT' AND NOT whatsapp.arch076_r15_audio_matches(d->'audioCurrent',message_id) THEN RETURN FALSE; END IF;
  IF current_turn.state<>'RESOLVED' OR current_turn."selectedConversationId" IS DISTINCT FROM conversation_id OR
    current_turn."resolutionInboundProviderMessageId" IS DISTINCT FROM current_turn."inboundProviderMessageId" OR
    d->>'role' IS DISTINCT FROM 'SELECT_AND_QUESTION' OR
    d->>'currentInboundProviderMessageId' IS DISTINCT FROM current_turn."inboundProviderMessageId" OR
    d->>'selectedAssignmentConversationId' IS DISTINCT FROM conversation_id OR
    d#>>'{associatedMessages,currentMessageId}' IS DISTINCT FROM message_id OR
    d#>>'{moderation,clause,id}' IS DISTINCT FROM assessment_id OR
    d#>>'{moderation,clause,hash}' IS DISTINCT FROM digest OR
    d#>>'{clause,sha256}' IS DISTINCT FROM digest THEN RETURN FALSE; END IF;
  SELECT * INTO original FROM whatsapp."RecoveryBasketRoutingTurn"
    WHERE "inboundProviderMessageId"=current_turn."parentProviderMessageId" FOR SHARE;
  IF NOT FOUND OR original."parentProviderMessageId" IS NOT NULL OR original.state<>'RESOLVED' OR
    original."threadId" IS DISTINCT FROM current_turn."threadId" OR
    original."routeId" IS DISTINCT FROM current_turn."routeId" OR
    original."selectedConversationId" IS DISTINCT FROM conversation_id OR
    original."resolutionInboundProviderMessageId" IS DISTINCT FROM current_turn."inboundProviderMessageId" OR
    d->>'originalTurnId' IS DISTINCT FROM original."inboundProviderMessageId" OR
    d->>'originalInboundProviderMessageId' IS DISTINCT FROM original."inboundProviderMessageId" THEN RETURN FALSE; END IF;
  SELECT * INTO prompt FROM whatsapp."RecoveryBasketRoutingTurn"
    WHERE "inboundProviderMessageId"=d->>'promptTurnId' FOR SHARE;
  IF NOT FOUND OR prompt."threadId" IS DISTINCT FROM current_turn."threadId" OR
    (prompt."inboundProviderMessageId"<>original."inboundProviderMessageId" AND prompt."parentProviderMessageId" IS DISTINCT FROM original."inboundProviderMessageId") OR
    (prompt."routeId" IS NOT NULL AND prompt."routeId" IS DISTINCT FROM current_turn."routeId") OR
    (prompt."promptScopeRouteId" IS NOT NULL AND prompt."promptScopeRouteId" IS DISTINCT FROM current_turn."routeId") OR
    prompt."promptSentAt" IS NULL OR prompt."promptProviderMessageId" IS NULL OR
    d->>'confirmedPromptProviderMessageId' IS DISTINCT FROM prompt."promptProviderMessageId" OR
    NOT EXISTS(SELECT 1 FROM whatsapp."RecoverySenderRoute" WHERE id=current_turn."routeId" AND "threadId"=current_turn."threadId" AND "shopId"=shop_id)
    THEN RETURN FALSE; END IF;
  IF jsonb_typeof(d#>'{clause,start}') IS DISTINCT FROM 'number' OR
    jsonb_typeof(d#>'{clause,end}') IS DISTINCT FROM 'number' OR
    (d#>>'{clause,start}') !~ '^[0-9]{1,9}$' OR (d#>>'{clause,end}') !~ '^[0-9]{1,9}$' THEN RETURN FALSE; END IF;
  clause:=whatsapp.arch076_utf16_slice(full_content,(d#>>'{clause,start}')::INTEGER,(d#>>'{clause,end}')::INTEGER);
  IF clause IS NULL OR encode(sha256(convert_to(clause,'UTF8')),'hex') IS DISTINCT FROM digest THEN RETURN FALSE; END IF;
  SELECT * INTO original_message FROM whatsapp."ConversationMessage" WHERE id=d#>>'{associatedMessages,originalMessageId}' FOR SHARE;
  IF NOT FOUND OR original_message."conversationId"<>conversation_id OR original_message.direction<>'INBOUND' OR original_message."senderType"<>'CUSTOMER' OR
    original_message."providerMessageId" IS DISTINCT FROM original."inboundProviderMessageId" OR
    encode(sha256(convert_to(original_message.content,'UTF8')),'hex') IS DISTINCT FROM d->>'originalTextSha256' THEN RETURN FALSE; END IF;
  IF original_message."contentType"='AUDIO' AND NOT whatsapp.arch076_r15_audio_matches(d->'audioOriginal',original_message.id) THEN RETURN FALSE; END IF;
  RETURN EXISTS(SELECT 1 FROM whatsapp."ConversationModerationAssessment" a WHERE a.id=d#>>'{moderation,current,id}' AND a."conversationMessageId"=message_id AND a."conversationId"=conversation_id AND a."shopId"=shop_id AND a.subject='CUSTOMER_MESSAGE' AND a."inputKind"=input_kind AND a.decision='ALLOW' AND a."policyVersion"=policy AND a."requestedModel"=model AND a."contentSha256"=encode(sha256(convert_to(full_content,'UTF8')),'hex') AND a."contentSha256"=d#>>'{moderation,current,hash}')
    AND EXISTS(SELECT 1 FROM whatsapp."ConversationModerationAssessment" a WHERE a.id=d#>>'{moderation,original,id}' AND a."conversationMessageId"=original_message.id AND a."conversationId"=conversation_id AND a."shopId"=shop_id AND a.subject='CUSTOMER_MESSAGE' AND a.decision='ALLOW' AND a."policyVersion"=policy AND a."requestedModel"=model AND a."contentSha256"=d->>'originalTextSha256' AND a."contentSha256"=d#>>'{moderation,original,hash}');
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
       encode(sha256(convert_to(message_content,'UTF8')),'hex')<>NEW."contentSha256" AND NOT (
         NEW."subject"='CUSTOMER_MESSAGE' AND NEW."inputKind" IN ('TEXT','TRANSCRIPT') AND
         whatsapp.arch076_r15_clause_subject(NEW.id,NEW."conversationMessageId",NEW."conversationId",NEW."shopId",NEW."contentSha256",NEW."policyVersion",NEW."requestedModel",message_content,NEW."inputKind")
       ) THEN
      RAISE EXCEPTION 'ARCH040 moderation message text digest mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Preserve verified non-plaintext attestation before terminal privacy scrub.
-- The worker owns provider/config verification; SQL ties its frozen attestation
-- to the single-fill verification result and authentic raw media identity.
CREATE FUNCTION whatsapp.arch076_r15_audio_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot TEXT; source_row whatsapp."RecoveryBasketRoutingTurn"%ROWTYPE; p JSONB;
BEGIN
  IF NEW."routingDecision" IS NULL OR (TG_OP='UPDATE' AND OLD."routingDecision" IS NOT NULL) THEN RETURN NEW; END IF;
  FOREACH slot IN ARRAY ARRAY['audioCurrent','audioOriginal'] LOOP
    p:=NEW."routingDecision"->slot;
    IF p IS NULL OR p='null'::jsonb THEN CONTINUE; END IF;
    IF slot='audioCurrent' OR NEW."routingDecision"->>'originalInboundProviderMessageId'=NEW."inboundProviderMessageId" THEN source_row:=NEW;
    ELSE
      SELECT * INTO source_row FROM whatsapp."RecoveryBasketRoutingTurn"
        WHERE "inboundProviderMessageId"=NEW."parentProviderMessageId" FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'R15_AUDIO_ATTESTATION_INVALID' USING ERRCODE='23514'; END IF;
    END IF;
    IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p - ARRAY['schemaVersion','verified','sourceSha256','providerMessageId','mediaIdSha256','mediaSha256','transcriptSha256','provider','model','durationMs','operationRows'] <> '{}'::jsonb OR p IS DISTINCT FROM source_row."moderationJson"#>'{audioTranscript,provenance}' OR
      source_row."inputJson"#>>'{content,type}' IS DISTINCT FROM 'audio' OR
      p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p->'verified' IS DISTINCT FROM 'true'::jsonb OR
      p->>'providerMessageId' IS DISTINCT FROM source_row."inboundProviderMessageId" OR
      p->>'mediaIdSha256' IS DISTINCT FROM encode(sha256(convert_to(source_row."inputJson"#>>'{content,mediaId}','UTF8')),'hex') OR
      p->>'mediaSha256' IS DISTINCT FROM source_row."inputJson"#>>'{content,sha256}' OR
      p->>'transcriptSha256' IS DISTINCT FROM encode(sha256(convert_to(source_row."moderationJson"#>>'{audioTranscript,text}','UTF8')),'hex') OR
      COALESCE(p->>'sourceSha256','') !~ '^[0-9a-f]{64}$' OR
      p->>'sourceSha256' IS DISTINCT FROM whatsapp.arch076_r15_audio_source_sha256(source_row."inputJson") OR
      jsonb_typeof(source_row."moderationJson"#>'{audioTranscript,text}') IS DISTINCT FROM 'string' OR
      length(btrim(COALESCE(source_row."moderationJson"#>>'{audioTranscript,text}',''),E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)))=0 OR
      COALESCE(p->>'transcriptSha256','') !~ '^[0-9a-f]{64}$' OR COALESCE(p->>'mediaIdSha256','') !~ '^[0-9a-f]{64}$' OR
      COALESCE(p->>'provider','')='' OR COALESCE(p->>'model','')='' OR
      jsonb_typeof(p->'durationMs') IS DISTINCT FROM 'number' OR COALESCE(p->>'durationMs','') !~ '^[0-9]{1,9}$' OR
      jsonb_typeof(p->'operationRows') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'R15_AUDIO_ATTESTATION_INVALID' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(p->'operationRows')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'operationRows') op WHERE jsonb_typeof(op) IS DISTINCT FROM 'object' OR op - ARRAY['id','version'] <> '{}'::jsonb OR COALESCE(op->>'id','')='' OR jsonb_typeof(op->'version') IS DISTINCT FROM 'number' OR COALESCE(op->>'version','') !~ '^[1-9][0-9]{0,8}$') THEN
      RAISE EXCEPTION 'R15_AUDIO_ATTESTATION_INVALID' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER arch076_r15_audio_freeze BEFORE INSERT OR UPDATE ON whatsapp."RecoveryBasketRoutingTurn"
FOR EACH ROW EXECUTE FUNCTION whatsapp.arch076_r15_audio_freeze_guard();
