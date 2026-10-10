ALTER TABLE "commerce"."RecoveryOutreachAttempt"
    ADD COLUMN "recipient" VARCHAR(64) NOT NULL,
    ADD CONSTRAINT "RecoveryOutreachAttempt_recipient_check"
        CHECK (("recipient" COLLATE "C") ~ '^[0-9]{1,64}$');