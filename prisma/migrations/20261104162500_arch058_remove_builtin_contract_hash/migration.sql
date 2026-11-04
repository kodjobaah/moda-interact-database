BEGIN;

LOCK TABLE commerce."CommerceConversationGrant" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM commerce."CommerceConversationGrant" grant_row
    CROSS JOIN LATERAL jsonb_array_elements(grant_row."grantedTools") AS entries(item)
    WHERE entries.item ? 'kind'
      AND (
        jsonb_typeof(entries.item) IS DISTINCT FROM 'object'
        OR NOT (entries.item ?& ARRAY['kind','toolName','definitionVersion','contractHash'])
        OR entries.item - ARRAY['kind','toolName','definitionVersion','contractHash'] <> '{}'::jsonb
        OR entries.item->>'kind' IS DISTINCT FROM 'BUILT_IN'
        OR entries.item->>'toolName' NOT IN
          ('commerce_get_discount_options','commerce_get_discount_details')
        OR entries.item->>'definitionVersion' IS DISTINCT FROM '1.0.0'
        OR jsonb_typeof(entries.item->'contractHash') IS DISTINCT FROM 'string'
        OR entries.item->>'contractHash' !~ '^[0-9a-f]{64}$'
      )
  ) THEN
    RAISE EXCEPTION 'ARCH058_BUILT_IN_GRANT_SHAPE_UNRECOGNIZED';
  END IF;
END;
$$;

DROP TRIGGER arch020_grant_immutable ON commerce."CommerceConversationGrant";

CREATE OR REPLACE FUNCTION commerce.arch020_grant_tools(v jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  item jsonb;
  ids text[] := '{}';
  names text[] := '{}';
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'array'
    OR octet_length(v::text) > 65536 THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(v) > 32 THEN RETURN false; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(v) AS entries(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF item ? 'kind' THEN
      IF commerce.arch020_object(item,
          ARRAY['kind','toolName','definitionVersion']) IS DISTINCT FROM true
        OR item->>'kind' IS DISTINCT FROM 'BUILT_IN'
        OR commerce.arch020_string(item->'toolName',128) IS DISTINCT FROM true
        OR item->>'toolName' NOT IN
          ('commerce_get_discount_options','commerce_get_discount_details')
        OR item->>'definitionVersion' IS DISTINCT FROM '2.0.0' THEN
        RETURN false;
      END IF;
    ELSE
      IF commerce.arch020_object(item,
          ARRAY['toolId','toolRevisionId','toolName','definitionVersion','capabilityKeys']) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolId',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolRevisionId',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'toolName',128) IS DISTINCT FROM true
        OR commerce.arch020_string(item->'definitionVersion',64) IS DISTINCT FROM true
        OR commerce.arch020_strings(item->'capabilityKeys',1,32,true) IS DISTINCT FROM true
        OR item->>'toolId' = ANY(ids) THEN
        RETURN false;
      END IF;
      ids := array_append(ids,item->>'toolId');
    END IF;
    IF item->>'toolName' = ANY(names) THEN RETURN false; END IF;
    names := array_append(names,item->>'toolName');
  END LOOP;
  RETURN true;
END;
$$;

UPDATE commerce."CommerceConversationGrant" grant_row
SET "grantedTools" = (
  SELECT jsonb_agg(
    CASE WHEN entries.item->>'kind' = 'BUILT_IN'
      THEN (entries.item - 'contractHash') || jsonb_build_object('definitionVersion','2.0.0')
      ELSE entries.item
    END
    ORDER BY entries.ordinality
  )
  FROM jsonb_array_elements(grant_row."grantedTools") WITH ORDINALITY AS entries(item, ordinality)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(grant_row."grantedTools") AS entries(item)
  WHERE entries.item->>'kind' = 'BUILT_IN'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM commerce."CommerceConversationGrant" grant_row
    CROSS JOIN LATERAL jsonb_array_elements(grant_row."grantedTools") AS entries(item)
    WHERE entries.item->>'kind' = 'BUILT_IN'
      AND entries.item ? 'contractHash'
  ) OR EXISTS (
    SELECT 1
    FROM commerce."CommerceConversationGrant" grant_row
    WHERE commerce.arch020_grant_tools(grant_row."grantedTools") IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'ARCH058_BUILT_IN_GRANT_POSTCONDITION_FAILED';
  END IF;
END;
$$;

CREATE TRIGGER arch020_grant_immutable
BEFORE UPDATE ON commerce."CommerceConversationGrant"
FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();

COMMIT;