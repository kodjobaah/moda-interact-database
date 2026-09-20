\set ON_ERROR_STOP on
\echo Tenant 1: date cohort, reverse browse and id tie-breaker
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "detectedAt", "totalPrice", "currency"
FROM "commerce"."CheckoutRecovery"
WHERE "shopId" = 'arch019-shop-1' AND "detectedAt" >= TIMESTAMP '2026-08-10'
  AND "detectedAt" < TIMESTAMP '2026-08-18'
ORDER BY "detectedAt" DESC, "id" DESC LIMIT 26;

\echo Tenant 2: completed status cursor page
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "detectedAt"
FROM "commerce"."CheckoutRecovery"
WHERE "shopId" = 'arch019-shop-2' AND "status" = 'COMPLETED'
  AND "detectedAt" >= TIMESTAMP '2026-08-10' AND "detectedAt" < TIMESTAMP '2026-08-18'
  AND ("detectedAt", "id") < (TIMESTAMP '2026-08-16', 'arch019-r-2-09000')
ORDER BY "detectedAt" DESC, "id" DESC LIMIT 26;

\echo Ongoing multi-status page: optimizer may use a different plan
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "detectedAt"
FROM "commerce"."CheckoutRecovery"
WHERE "shopId" = 'arch019-shop-1' AND "status" IN ('DETECTED','MESSAGE_SENT','ENGAGED')
  AND "detectedAt" >= TIMESTAMP '2026-08-10' AND "detectedAt" < TIMESTAMP '2026-08-18'
ORDER BY "detectedAt" DESC, "id" DESC LIMIT 26;

\echo Same-customer related recoveries
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "detectedAt"
FROM "commerce"."CheckoutRecovery"
WHERE "shopId" = 'arch019-shop-1' AND "customerId" = 'arch019-customer-1-1'
  AND "id" <> 'arch019-r-1-00001'
ORDER BY "detectedAt" DESC, "id" DESC LIMIT 6;

\echo Chronological transcript: owned recovery and message cursor
EXPLAIN (ANALYZE, BUFFERS)
SELECT m."id", m."createdAt", m."content"
FROM "whatsapp"."ConversationMessage" m
JOIN "whatsapp"."Conversation" c ON c."id" = m."conversationId"
JOIN "commerce"."CheckoutRecovery" r ON r."id" = c."checkoutRecoveryId"
WHERE r."shopId" = 'arch019-shop-1' AND r."id" = 'arch019-r-1-00001'
  AND (m."createdAt",m."id") > (TIMESTAMP '2026-09-01 00:01:00','arch019-m-1-00001-0240')
ORDER BY m."createdAt",m."id" LIMIT 51;

\echo Latest transcript window
EXPLAIN (ANALYZE, BUFFERS)
SELECT m."id", m."createdAt"
FROM "whatsapp"."ConversationMessage" m
JOIN "whatsapp"."Conversation" c ON c."id" = m."conversationId"
JOIN "commerce"."CheckoutRecovery" r ON r."id" = c."checkoutRecoveryId"
WHERE r."shopId" = 'arch019-shop-2' AND r."id" = 'arch019-r-2-00001'
ORDER BY m."createdAt" DESC,m."id" DESC LIMIT 51;
