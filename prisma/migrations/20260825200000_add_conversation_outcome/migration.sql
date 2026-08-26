CREATE TYPE "whatsapp"."ConversationOutcome" AS ENUM ('IN_PROGRESS', 'RECOVERED', 'NO_RESPONSE', 'DECLINED', 'EXPIRED');

ALTER TABLE "whatsapp"."Conversation" ADD COLUMN "outcome" "whatsapp"."ConversationOutcome" NOT NULL DEFAULT 'IN_PROGRESS';