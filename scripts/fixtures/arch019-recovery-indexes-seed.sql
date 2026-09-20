\set ON_ERROR_STOP on
-- Synthetic rows in a disposable database only; never seed a shared environment.
INSERT INTO "commerce"."Shop" ("id", "domain", "updatedAt")
SELECT 'arch019-shop-' || s, 'arch019-' || s || '.invalid', TIMESTAMP '2026-09-01'
FROM generate_series(1,2) s;

INSERT INTO "commerce"."Customer" ("id", "shopId", "firstName", "updatedAt")
SELECT 'arch019-customer-' || s || '-' || c, 'arch019-shop-' || s,
       'Fixture customer ' || c, TIMESTAMP '2026-09-01'
FROM generate_series(1,2) s CROSS JOIN generate_series(0,199) c;

INSERT INTO "commerce"."CheckoutRecovery"
  ("id", "shopId", "checkoutToken", "customerId", "status", "currency", "totalPrice", "detectedAt", "lastExternalActivityAt", "updatedAt")
SELECT 'arch019-r-' || s || '-' || lpad(n::text,5,'0'), 'arch019-shop-' || s,
       'fixture-checkout-' || n, 'arch019-customer-' || s || '-' || (n % 200),
       (ARRAY['DETECTED','MESSAGE_SENT','ENGAGED','COMPLETED','EXPIRED','CANCELLED'])[1+n%6]::"commerce"."CheckoutRecoveryStatus",
       CASE WHEN n % 2 = 0 THEN 'GBP' ELSE 'EUR' END, 10 + n % 150,
       TIMESTAMP '2026-08-01' + (n / 4) * INTERVAL '10 minutes',
       TIMESTAMP '2026-08-01' + (n / 4) * INTERVAL '10 minutes', TIMESTAMP '2026-09-01'
FROM generate_series(1,2) s CROSS JOIN generate_series(1,10000) n;

INSERT INTO "whatsapp"."Conversation" ("id", "checkoutRecoveryId", "type", "updatedAt")
SELECT 'arch019-conv-' || s || '-' || lpad(n::text,5,'0'),
       'arch019-r-' || s || '-' || lpad(n::text,5,'0'), 'RECOVERY', TIMESTAMP '2026-09-01'
FROM generate_series(1,2) s CROSS JOIN generate_series(1,10000) n;

INSERT INTO "whatsapp"."ConversationMessage"
  ("id", "conversationId", "direction", "senderType", "content", "createdAt")
SELECT 'arch019-m-' || s || '-' || lpad(n::text,5,'0') || '-' || lpad(m::text,4,'0'),
       'arch019-conv-' || s || '-' || lpad(n::text,5,'0'), 'INBOUND', 'CUSTOMER', 'Synthetic fixture text',
       TIMESTAMP '2026-09-01' + (m / 4) * INTERVAL '1 second'
FROM generate_series(1,2) s CROSS JOIN generate_series(1,10000) n
CROSS JOIN LATERAL generate_series(1, CASE WHEN n = 1 THEN 1000 ELSE 10 END) m;

ANALYZE "commerce"."CheckoutRecovery";
ANALYZE "whatsapp"."ConversationMessage";

-- Retained in this disposable DB for an exact before/after data comparison.
CREATE TABLE public.arch019_before AS
SELECT 'recoveries' AS kind, count(*) AS rows,
       md5(string_agg(md5(r::text), '' ORDER BY "id")) AS fingerprint
FROM "commerce"."CheckoutRecovery" r
UNION ALL
SELECT 'messages', count(*), md5(string_agg(md5(m::text), '' ORDER BY "id"))
FROM "whatsapp"."ConversationMessage" m;

CREATE TABLE public.arch019_indexes_before AS
SELECT schemaname, indexname, indexdef FROM pg_indexes
WHERE (schemaname, tablename) IN (('commerce','CheckoutRecovery'),('whatsapp','ConversationMessage'));
