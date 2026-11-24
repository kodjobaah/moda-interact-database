-- Add a platform-owned pointer to an existing multilingual recovery definition.
-- No merchant, locale, registration or publication is created or modified.
-- As in ARCH-047, approval, exact definition purpose, WABA registration coverage,
-- content integrity and publication policy are validated by the application.
BEGIN;

CREATE TABLE "whatsapp"."WhatsAppRecoveryTemplateDefault" (
    "id" TEXT NOT NULL,
    "wabaId" VARCHAR(191) NOT NULL,
    "purpose" VARCHAR(96) NOT NULL,
    "definitionId" TEXT NOT NULL,
    "updatedByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppRecoveryTemplateDefault_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WhatsAppRecoveryTemplateDefault_purpose_check" CHECK ("purpose" IN (
        'INITIAL_NO_OFFER', 'INITIAL_CODE_OFFER', 'INITIAL_AUTOMATIC_OFFER',
        'FOLLOW_UP_NO_OFFER', 'FOLLOW_UP_CODE_OFFER', 'FOLLOW_UP_AUTOMATIC_OFFER'
    )),
    CONSTRAINT "WhatsAppRecoveryTemplateDefault_wabaId_check"
        CHECK (length("wabaId") > 0 AND "wabaId" !~ '[[:space:]]')
);

CREATE UNIQUE INDEX "WhatsAppRecoveryTemplateDefault_wabaId_purpose_key"
    ON "whatsapp"."WhatsAppRecoveryTemplateDefault"("wabaId", "purpose");
CREATE INDEX "WhatsAppRecoveryTemplateDefault_definitionId_idx"
    ON "whatsapp"."WhatsAppRecoveryTemplateDefault"("definitionId");
CREATE INDEX "WhatsAppRecoveryTemplateDefault_updatedByAdminId_idx"
    ON "whatsapp"."WhatsAppRecoveryTemplateDefault"("updatedByAdminId");

ALTER TABLE "whatsapp"."WhatsAppRecoveryTemplateDefault"
    ADD CONSTRAINT "WhatsAppRecoveryTemplateDefault_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "whatsapp"."WhatsAppTemplateDefinition"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "whatsapp"."WhatsAppRecoveryTemplateDefault"
    ADD CONSTRAINT "WhatsAppRecoveryTemplateDefault_updatedByAdminId_fkey"
    FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
