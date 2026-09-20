\set ON_ERROR_STOP on
DO $$
DECLARE expected record; actual_rows bigint; actual_fingerprint text;
BEGIN
  FOR expected IN SELECT * FROM public.arch019_before LOOP
    IF expected.kind = 'recoveries' THEN
      SELECT count(*), md5(string_agg(md5(r::text), '' ORDER BY "id")) INTO actual_rows, actual_fingerprint FROM "commerce"."CheckoutRecovery" r;
    ELSE
      SELECT count(*), md5(string_agg(md5(m::text), '' ORDER BY "id")) INTO actual_rows, actual_fingerprint FROM "whatsapp"."ConversationMessage" m;
    END IF;
    IF actual_rows <> expected.rows OR actual_fingerprint IS DISTINCT FROM expected.fingerprint THEN
      RAISE EXCEPTION 'Migration changed % rows/data', expected.kind;
    END IF;
  END LOOP;
  IF EXISTS (SELECT schemaname,indexname,indexdef FROM public.arch019_indexes_before
             EXCEPT SELECT schemaname,indexname,indexdef FROM pg_indexes) THEN
    RAISE EXCEPTION 'Existing index removed or altered';
  END IF;
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE (ns.nspname,c.relname) IN (
        ('commerce','CheckoutRecovery_shopId_detectedAt_id_idx'),
        ('commerce','CheckoutRecovery_shopId_status_detectedAt_id_idx'),
        ('commerce','CheckoutRecovery_shopId_customerId_detectedAt_id_idx'),
        ('whatsapp','ConversationMessage_conversationId_createdAt_id_idx'))
      AND i.indisvalid AND i.indisready AND NOT i.indisunique) <> 4 THEN
    RAISE EXCEPTION 'Four valid ready non-unique indexes required';
  END IF;
END $$;
SELECT * FROM public.arch019_before ORDER BY kind;
SELECT schemaname,indexname,indexdef FROM pg_indexes WHERE indexname IN (
  'CheckoutRecovery_shopId_detectedAt_id_idx', 'CheckoutRecovery_shopId_status_detectedAt_id_idx',
  'CheckoutRecovery_shopId_customerId_detectedAt_id_idx', 'ConversationMessage_conversationId_createdAt_id_idx') ORDER BY indexname;
