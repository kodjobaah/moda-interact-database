BEGIN;

-- Quiesce the relevant producers/consumers before deployment. This lock also
-- prevents a concurrent writer observing the one-trigger backfill exception.
LOCK TABLE "whatsapp"."MerchantConversationSendCommand" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = '"whatsapp"."MerchantConversationSendCommand"'::regclass
      AND tgname = 'arch040_command_guard'
      AND NOT tgisinternal AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'ARCH055 expected enabled arch040_command_guard; stop upgrade';
  END IF;
END;
$$;

ALTER TABLE "whatsapp"."MerchantConversationSendCommand"
  ADD COLUMN "followUpClaimKey" VARCHAR(255);

-- The baseline command guard rejects ordinary CLAIMED -> CLAIMED writes,
-- including metadata-only writes. Bypass ONLY that trigger, ONLY under the
-- exclusive lock and in this transaction. Do not change its function body.
ALTER TABLE "whatsapp"."MerchantConversationSendCommand"
  DISABLE TRIGGER arch040_command_guard;
UPDATE "whatsapp"."MerchantConversationSendCommand"
  SET "followUpClaimKey" = "idempotencyKey"
  WHERE "kind" = 'RECOVERY_FOLLOW_UP_TEMPLATE';
ALTER TABLE "whatsapp"."MerchantConversationSendCommand"
  ENABLE TRIGGER arch040_command_guard;

COMMIT;
