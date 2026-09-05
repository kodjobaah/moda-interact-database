-- Replace the initial provider identity constraint with the provider's
-- language code rather than Moda's canonical language tag.
DROP INDEX "whatsapp"."WhatsAppTemplateVariant_identity_key";

CREATE UNIQUE INDEX "WhatsAppTemplateVariant_identity_key"
    ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "providerTemplateName", "providerLanguageCode");

-- Only one approved and enabled variant may satisfy an exact-locale lookup.
CREATE UNIQUE INDEX "WhatsAppTemplateVariant_selectable_key"
    ON "whatsapp"."WhatsAppTemplateVariant"("shopId", "providerAccountId", "purpose", "languageTag")
    WHERE "enabled" = true AND "status" = 'APPROVED';