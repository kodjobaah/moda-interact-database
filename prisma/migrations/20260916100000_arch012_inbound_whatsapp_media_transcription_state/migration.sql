CREATE TYPE "whatsapp"."MessageContentType" AS ENUM (
  'TEXT',
  'AUDIO',
  'UNSUPPORTED'
);

CREATE TYPE "whatsapp"."MessageTranscriptionStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'COMPLETED',
  'REJECTED',
  'FAILED'
);

ALTER TABLE "whatsapp"."ConversationMessage"
  ADD COLUMN "contentType" "whatsapp"."MessageContentType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "providerMediaId" TEXT,
  ADD COLUMN "providerMediaMimeType" TEXT,
  ADD COLUMN "providerMediaSha256" TEXT,
  ADD COLUMN "mediaDurationMs" INTEGER,
  ADD COLUMN "transcriptionStatus" "whatsapp"."MessageTranscriptionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "transcriptionProvider" TEXT,
  ADD COLUMN "transcriptionModel" TEXT,
  ADD COLUMN "transcriptionFailureCode" TEXT,
  ADD COLUMN "transcriptionCompletedAt" TIMESTAMP(3);

ALTER TABLE "whatsapp"."ConversationMessage"
  ADD CONSTRAINT "ck_arch012_conversation_message_media_duration_nonnegative"
  CHECK ("mediaDurationMs" IS NULL OR "mediaDurationMs" >= 0);