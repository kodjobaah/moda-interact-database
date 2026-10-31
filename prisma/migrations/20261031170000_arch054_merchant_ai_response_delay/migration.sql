-- ARCH-054-DATABASE-001: persist shop AI delay and frozen pending-turn eligibility.
BEGIN;

ALTER TABLE "shopify"."ShopSettings"
  ADD COLUMN "aiResponseDelayMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "whatsapp"."Conversation"
  ADD COLUMN "pendingAiNotBeforeAt" TIMESTAMPTZ(3),
  ADD COLUMN "pendingAiControlRevision" INTEGER,
  ADD COLUMN "pendingAiDelayMinutes" INTEGER;

CREATE INDEX "Conversation_pendingAiNotBeforeAt_id_idx"
  ON "whatsapp"."Conversation"("pendingAiNotBeforeAt", "id");

ALTER TABLE "shopify"."ShopSettings"
  ADD CONSTRAINT "ShopSettings_aiResponseDelayMinutes_range"
  CHECK ("aiResponseDelayMinutes" >= 0 AND "aiResponseDelayMinutes" <= 30);

ALTER TABLE "whatsapp"."Conversation"
  ADD CONSTRAINT "Conversation_pendingAiTriple_consistency"
  CHECK (
    (
      "pendingAiNotBeforeAt" IS NULL
      AND "pendingAiControlRevision" IS NULL
      AND "pendingAiDelayMinutes" IS NULL
    )
    OR
    (
      "pendingAiNotBeforeAt" IS NOT NULL
      AND "pendingAiControlRevision" IS NOT NULL
      AND "pendingAiDelayMinutes" IS NOT NULL
      AND "pendingTurnStartedAt" IS NOT NULL
      AND "pendingAiControlRevision" >= 0
      AND "pendingAiDelayMinutes" >= 0
      AND "pendingAiDelayMinutes" <= 30
      AND "pendingAiNotBeforeAt" >= ("pendingTurnStartedAt" AT TIME ZONE 'UTC')
    )
  );

COMMIT;
