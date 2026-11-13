BEGIN;

-- Add the bounded initial-outreach tool-call allowance to the existing
-- CommerceAgent LIVE/Preview policy. Legacy rows inherit the historical limit.
CREATE OR REPLACE FUNCTION "commerce".arch038_valid_model_budget(
  payload jsonb, schema_version integer, policy_scope "commerce"."CommerceModelPolicyScope"
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field record; numeric_text text; key_count integer;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR schema_version <> 1 THEN
    RETURN false;
  END IF;
  SELECT count(*) INTO key_count FROM jsonb_object_keys(payload);
  IF (policy_scope = 'PLATFORM' AND
      (NOT payload ? 'deadlineMs' OR NOT payload ? 'outputTokens' OR key_count NOT IN (2, 3)))
     OR (policy_scope <> 'PLATFORM' AND payload = '{}'::jsonb) THEN
    RETURN false;
  END IF;
  FOR field IN SELECT key, value FROM jsonb_each(payload) LOOP
    IF field.key NOT IN ('deadlineMs', 'outputTokens', 'initialOutreachToolCalls') OR jsonb_typeof(field.value) <> 'number' THEN
      RETURN false;
    END IF;
    numeric_text := field.value::text;
    IF length(numeric_text) > 16 OR numeric_text !~ '^[1-9][0-9]*$' THEN
      RETURN false;
    END IF;
    IF numeric_text::numeric > 9007199254740991 OR
       (field.key = 'initialOutreachToolCalls' AND numeric_text::numeric > 64) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- The trigger treats every change as an Admin edit. A migration default is not
-- an Admin action, so update the required Platform rows with that trigger off.
ALTER TABLE "commerce"."CommerceModelPolicy" DISABLE TRIGGER arch038_model_policy_guard;
UPDATE "commerce"."CommerceModelPolicy"
   SET "budget" = "budget" || '{"initialOutreachToolCalls":16}'::jsonb,
       "editVersion" = "editVersion" + 1,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "scope" = 'PLATFORM'
   AND "context" = 'LIVE'
   AND NOT ("budget" ? 'initialOutreachToolCalls');
ALTER TABLE "commerce"."CommerceModelPolicy" ENABLE TRIGGER arch038_model_policy_guard;

-- Legacy two-field Platform policies and independent Preview defaults remain valid.
COMMIT;
