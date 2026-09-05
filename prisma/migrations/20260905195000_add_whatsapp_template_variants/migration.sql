-- CreateEnum
CREATE TYPE "whatsapp"."WhatsAppTemplateStatus" AS ENUM ('APPROVED', 'IN_APPEAL', 'PENDING', 'REJECTED', 'PENDING_DELETION', 'DELETED', 'DISABLED', 'PAUSED', 'LIMIT_EXCEEDED');

-- CreateTable
CREATE TABLE "whatsapp"."WhatsAppTemplateVariant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "languageTag" TEXT NOT NULL,
    "providerLanguageCode" TEXT NOT NULL,
    "providerTemplateName" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "status" "whatsapp"."WhatsAppTemplateStatus" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplateVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplateVariant_identity_key"
    ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "languageTag", "providerTemplateName");

-- CreateIndex
CREATE INDEX "WhatsAppTemplateVariant_selector_idx"
    ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "languageTag", "enabled", "status");

-- AddForeignKey
ALTER TABLE "whatsapp"."WhatsAppTemplateVariant"
    ADD CONSTRAINT "WhatsAppTemplateVariant_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
