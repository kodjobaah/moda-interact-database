-- Preserve existing administrator choices; classify their frozen Meta headers.
-- This is a format migration, not an approval refresh or merchant publication.
BEGIN;

ALTER TABLE "whatsapp"."WhatsAppRecoveryTemplateDefault"
    ADD COLUMN "format" VARCHAR(16);

-- Deployment requires paused writers. Hold source evidence stable until commit.
LOCK TABLE "whatsapp"."WhatsAppTemplateDefinition",
    "whatsapp"."WhatsAppTemplateLocale",
    "whatsapp"."WhatsAppTemplateMetaRegistration" IN SHARE MODE;

DO $migration$
DECLARE
    pointer record;
    evidence record;
    components jsonb;
    header_count integer;
    body_count integer;
    header_kind text;
    locale_kind text;
    definition_kind text;
    definition_role text;
    locale_count integer;
    has_english boolean;
BEGIN
    FOR pointer IN
        SELECT p."id", p."wabaId", p."purpose", p."definitionId",
            d."kind", d."purpose" || '_' || d."offerType" AS "definitionPurpose",
            d."providerTemplateName"
        FROM "whatsapp"."WhatsAppRecoveryTemplateDefault" p
        JOIN "whatsapp"."WhatsAppTemplateDefinition" d ON d."id" = p."definitionId"
        ORDER BY p."id"
    LOOP
        IF pointer."kind" IS DISTINCT FROM 'META_RECOVERY'
            OR pointer."definitionPurpose" IS DISTINCT FROM pointer."purpose"
            OR NULLIF(pointer."providerTemplateName", '') IS NULL THEN
            RAISE EXCEPTION 'Cannot classify recovery default %: incompatible definition', pointer."id";
        END IF;
        definition_kind := NULL;
        definition_role := NULL;
        locale_count := 0;
        has_english := false;
        FOR evidence IN
            SELECT l."languageTag", l."localeAst" #> '{prepared,components}' AS prepared,
                l."localeAst" #>> '{prepared,parameterBindings,headerMediaRole}' AS prepared_role,
                l."providerLanguageCode" AS locale_code,
                r."id" AS registration_id, r."providerTemplateName" AS registration_name,
                r."providerLanguageCode" AS registration_code,
                r."componentsSnapshot" AS registered,
                r."parameterBindingsSnapshot" ->> 'headerMediaRole' AS registered_role,
                count(r."id") OVER (PARTITION BY l."id") AS registration_count
            FROM "whatsapp"."WhatsAppTemplateLocale" l
            LEFT JOIN "whatsapp"."WhatsAppTemplateMetaRegistration" r
                ON r."localeId" = l."id" AND r."wabaId" = pointer."wabaId"
            WHERE l."definitionId" = pointer."definitionId"
            ORDER BY l."languageTag", r."id"
        LOOP
            IF evidence.registration_count <> 1 OR evidence.registration_id IS NULL
                OR evidence.registration_name IS DISTINCT FROM pointer."providerTemplateName"
                OR NULLIF(evidence.locale_code, '') IS NULL
                OR evidence.registration_code IS DISTINCT FROM evidence.locale_code THEN
                RAISE EXCEPTION 'Cannot classify recovery default %: registration identity for %', pointer."id", evidence."languageTag";
            END IF;
            -- Classify both immutable projections independently. NONE and TEXT
            -- share a fallback slot, but must not disagree within a definition.
            locale_kind := NULL;
            FOREACH components IN ARRAY ARRAY[evidence.prepared, evidence.registered]
            LOOP
                IF jsonb_typeof(components) IS DISTINCT FROM 'array' THEN
                    RAISE EXCEPTION 'Cannot classify recovery default %: missing components for %', pointer."id", evidence."languageTag";
                END IF;
                SELECT count(*) FILTER (WHERE c->>'type' = 'HEADER'),
                    count(*) FILTER (WHERE c->>'type' = 'BODY'),
                    max(c->>'format') FILTER (WHERE c->>'type' = 'HEADER')
                INTO header_count, body_count, header_kind
                FROM jsonb_array_elements(components) AS e(c);
                IF EXISTS (SELECT 1 FROM jsonb_array_elements(components) AS e(c)
                    WHERE jsonb_typeof(c) IS DISTINCT FROM 'object'
                        OR c->>'type' IS NULL OR c->>'type' NOT IN ('HEADER', 'BODY', 'FOOTER', 'BUTTONS'))
                    OR body_count <> 1 OR header_count > 1
                    OR (header_count = 1 AND (header_kind IS NULL OR header_kind NOT IN ('TEXT', 'IMAGE'))) THEN
                    RAISE EXCEPTION 'Cannot classify recovery default %: unsupported header/body for %', pointer."id", evidence."languageTag";
                END IF;
                IF header_count = 0 THEN header_kind := 'NONE'; END IF;
                IF locale_kind IS NOT NULL AND locale_kind <> header_kind THEN
                    RAISE EXCEPTION 'Cannot classify recovery default %: frozen header mismatch for %', pointer."id", evidence."languageTag";
                END IF;
                locale_kind := header_kind;
            END LOOP;
            IF evidence.prepared_role IS DISTINCT FROM evidence.registered_role
                OR (locale_kind = 'IMAGE' AND (evidence.registered_role IS NULL OR
                    evidence.registered_role NOT IN ('LOGO', 'SQUARE_LOGO', 'COVER_IMAGE', 'CHECKOUT_PRODUCT')))
                OR (locale_kind <> 'IMAGE' AND evidence.registered_role IS NOT NULL) THEN
                RAISE EXCEPTION 'Cannot classify recovery default %: incompatible media binding for %', pointer."id", evidence."languageTag";
            END IF;
            IF definition_kind IS NOT NULL AND (definition_kind <> locale_kind
                OR definition_role IS DISTINCT FROM evidence.registered_role) THEN
                RAISE EXCEPTION 'Cannot classify recovery default %: mixed locale header formats or roles', pointer."id";
            END IF;
            definition_kind := locale_kind;
            definition_role := evidence.registered_role;
            locale_count := locale_count + 1;
            has_english := has_english OR evidence."languageTag" = 'en';
        END LOOP;
        IF locale_count <> 20 OR NOT has_english OR definition_kind IS NULL THEN
            RAISE EXCEPTION 'Cannot classify recovery default %: incomplete frozen locale cohort (% locales)', pointer."id", locale_count;
        END IF;
        UPDATE "whatsapp"."WhatsAppRecoveryTemplateDefault"
            SET "format" = CASE WHEN definition_kind = 'IMAGE' THEN 'IMAGE' ELSE 'TEXT' END
            WHERE "id" = pointer."id";
    END LOOP;
END;
$migration$;

ALTER TABLE "whatsapp"."WhatsAppRecoveryTemplateDefault"
    ALTER COLUMN "format" SET NOT NULL,
    ADD CONSTRAINT "WhatsAppRecoveryTemplateDefault_format_check" CHECK ("format" IN ('TEXT', 'IMAGE'));

DROP INDEX "whatsapp"."WhatsAppRecoveryTemplateDefault_wabaId_purpose_key";
CREATE UNIQUE INDEX "WhatsAppRecoveryTemplateDefault_wabaId_purpose_format_key"
    ON "whatsapp"."WhatsAppRecoveryTemplateDefault"("wabaId", "purpose", "format");

COMMIT;
