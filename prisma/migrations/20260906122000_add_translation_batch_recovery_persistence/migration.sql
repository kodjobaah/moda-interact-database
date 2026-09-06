-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "support";

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationDirection" AS ENUM ('MERCHANT_TO_ADMIN', 'ADMIN_TO_MERCHANT', 'SYSTEM_TO_MERCHANT');

-- CreateEnum
CREATE TYPE "support"."MerchantMessageTranslationStatus" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationBatchStatus" AS ENUM ('READY', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'PROVIDER_COMPLETED', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationReconciliationScope" AS ENUM ('TRANSLATION', 'FAILED_TRANSLATIONS');

-- CreateEnum
CREATE TYPE "support"."MerchantTranslationReconciliationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "support"."MerchantTranslationBatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "support"."MerchantTranslationBatchStatus" NOT NULL,
    "providerBatchId" TEXT,
    "inputFileId" TEXT,
    "outputFileId" TEXT,
    "errorFileId" TEXT,
    "submissionStartedAt" TIMESTAMP(3),
    "lastSubmitAttemptAt" TIMESTAMP(3),
    "submitAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextSubmitAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "pollSequence" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantTranslationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantMessageTranslation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" "support"."MerchantTranslationDirection" NOT NULL,
    "sourceLanguageTag" TEXT NOT NULL,
    "targetLanguageTag" TEXT NOT NULL,
    "status" "support"."MerchantMessageTranslationStatus" NOT NULL,
    "translatedBody" TEXT,
    "failureCode" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "currentBatchId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantMessageTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantTranslationBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "providerCustomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantTranslationBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support"."MerchantTranslationReconciliationRequest" (
    "id" TEXT NOT NULL,
    "requestedByPlatformAdminId" TEXT NOT NULL,
    "scope" "support"."MerchantTranslationReconciliationScope" NOT NULL,
    "translationId" TEXT,
    "status" "support"."MerchantTranslationReconciliationStatus" NOT NULL,
    "failureCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantTranslationReconciliationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatch_provider_providerBatchId_key" ON "support"."MerchantTranslationBatch"("provider", "providerBatchId");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatch_status_nextSubmitAt_createdAt_idx" ON "support"."MerchantTranslationBatch"("status", "nextSubmitAt", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatch_status_nextPollAt_createdAt_idx" ON "support"."MerchantTranslationBatch"("status", "nextPollAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMessageTranslation_messageId_targetLanguageTag_key" ON "support"."MerchantMessageTranslation"("messageId", "targetLanguageTag");

-- CreateIndex
CREATE INDEX "MerchantMessageTranslation_status_currentBatchId_nextAttemptAt_createdAt_idx" ON "support"."MerchantMessageTranslation"("status", "currentBatchId", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatchItem_providerCustomId_key" ON "support"."MerchantTranslationBatchItem"("providerCustomId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTranslationBatchItem_batchId_translationId_key" ON "support"."MerchantTranslationBatchItem"("batchId", "translationId");

-- CreateIndex
CREATE INDEX "MerchantTranslationBatchItem_translationId_createdAt_idx" ON "support"."MerchantTranslationBatchItem"("translationId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantTranslationReconciliationRequest_status_requestedAt_idx" ON "support"."MerchantTranslationReconciliationRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "MerchantTranslationReconciliationRequest_translationId_status_idx" ON "support"."MerchantTranslationReconciliationRequest"("translationId", "status");

-- AddForeignKey
ALTER TABLE "support"."MerchantMessageTranslation" ADD CONSTRAINT "MerchantMessageTranslation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "support"."MerchantSupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantMessageTranslation" ADD CONSTRAINT "MerchantMessageTranslation_currentBatchId_fkey" FOREIGN KEY ("currentBatchId") REFERENCES "support"."MerchantTranslationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationBatchItem" ADD CONSTRAINT "MerchantTranslationBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "support"."MerchantTranslationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationBatchItem" ADD CONSTRAINT "MerchantTranslationBatchItem_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "support"."MerchantMessageTranslation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support"."MerchantTranslationReconciliationRequest" ADD CONSTRAINT "MerchantTranslationReconciliationRequest_requestedByPlatformAdminId_fkey" FOREIGN KEY ("requestedByPlatformAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
