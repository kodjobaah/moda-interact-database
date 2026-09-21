-- ARCH-020 DATABASE-003: external API connections and opaque credentials.
CREATE TYPE "commerce"."CommerceExternalConnectionScope" AS ENUM ('PLATFORM', 'PER_SHOP');
CREATE TYPE "commerce"."CommerceExternalAuthMode" AS ENUM ('NONE', 'BEARER', 'API_KEY');
CREATE TYPE "commerce"."CommerceExternalConnectionAction" AS ENUM (
    'CREATE_CONNECTION', 'UPDATE_METADATA', 'CREATE_REVISION', 'SET_ENABLED',
    'SET_CREDENTIAL', 'REMOVE_CREDENTIAL'
);

CREATE TABLE "commerce"."CommerceExternalConnection" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "editVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceExternalConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceExternalConnection_key_format_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,127}$'),
    CONSTRAINT "CommerceExternalConnection_display_name_check" CHECK (btrim("displayName") <> ''),
    CONSTRAINT "CommerceExternalConnection_description_length_check" CHECK (char_length("description") <= 4096),
    CONSTRAINT "CommerceExternalConnection_edit_version_check" CHECK ("editVersion" > 0)
);

CREATE TABLE "commerce"."CommerceExternalConnectionRevision" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "origin" VARCHAR(2048) NOT NULL,
    "scope" "commerce"."CommerceExternalConnectionScope" NOT NULL,
    "authMode" "commerce"."CommerceExternalAuthMode" NOT NULL,
    "authHeader" VARCHAR(128),
    "documentation" TEXT NOT NULL DEFAULT '',
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceExternalConnectionRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceExternalConnectionRevision_revision_check" CHECK ("revisionNumber" > 0),
    CONSTRAINT "CommerceExternalConnectionRevision_auth_header_check" CHECK (
        ("authMode" = 'API_KEY' AND "authHeader" IS NOT NULL AND btrim("authHeader") <> '')
        OR ("authMode" <> 'API_KEY' AND "authHeader" IS NULL)
    ),
    CONSTRAINT "CommerceExternalConnectionRevision_documentation_length_check" CHECK (char_length("documentation") <= 16000)
);

CREATE TABLE "commerce"."CommerceExternalCredential" (
    "id" TEXT NOT NULL,
    "connectionRevisionId" TEXT NOT NULL,
    "shopId" TEXT,
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyId" VARCHAR(64) NOT NULL,
    "editVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceExternalCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceExternalCredential_nonce_length_check" CHECK (octet_length("nonce") = 12),
    CONSTRAINT "CommerceExternalCredential_auth_tag_length_check" CHECK (octet_length("authTag") = 16),
    CONSTRAINT "CommerceExternalCredential_ciphertext_length_check" CHECK (octet_length("ciphertext") BETWEEN 1 AND 8192),
    CONSTRAINT "CommerceExternalCredential_key_id_check" CHECK (btrim("keyId") <> ''),
    CONSTRAINT "CommerceExternalCredential_edit_version_check" CHECK ("editVersion" > 0)
);

CREATE TABLE "commerce"."CommerceExternalConnectionAudit" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "operationId" VARCHAR(128) NOT NULL,
    "action" "commerce"."CommerceExternalConnectionAction" NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "connectionId" TEXT NOT NULL,
    "connectionRevisionId" TEXT,
    "shopId" TEXT,
    "reason" VARCHAR(1000) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceExternalConnectionAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceExternalConnectionAudit_digest_check" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "CommerceExternalConnectionAudit_reason_check" CHECK (btrim("reason") <> ''),
    CONSTRAINT "CommerceExternalConnectionAudit_result_object_check" CHECK (jsonb_typeof("result") = 'object'),
    CONSTRAINT "CommerceExternalConnectionAudit_result_size_check" CHECK (octet_length("result"::text) <= 16384)
);

CREATE UNIQUE INDEX "CommerceExternalConnection_key_key"
    ON "commerce"."CommerceExternalConnection" ("key");
CREATE UNIQUE INDEX "CommerceExternalConnectionRevision_connectionId_revisionNumber_key"
    ON "commerce"."CommerceExternalConnectionRevision" ("connectionId", "revisionNumber");
CREATE UNIQUE INDEX "CommerceExternalConnectionRevision_id_connectionId_key"
    ON "commerce"."CommerceExternalConnectionRevision" ("id", "connectionId");
CREATE UNIQUE INDEX "CommerceExternalCredential_platform_revision_key"
    ON "commerce"."CommerceExternalCredential" ("connectionRevisionId")
    WHERE "shopId" IS NULL;
CREATE UNIQUE INDEX "CommerceExternalCredential_shop_revision_key"
    ON "commerce"."CommerceExternalCredential" ("connectionRevisionId", "shopId")
    WHERE "shopId" IS NOT NULL;
CREATE UNIQUE INDEX "CommerceExternalConnectionAudit_actorAdminId_operationId_key"
    ON "commerce"."CommerceExternalConnectionAudit" ("actorAdminId", "operationId");
CREATE INDEX "CommerceExternalConnectionAudit_connectionId_createdAt_id_idx"
    ON "commerce"."CommerceExternalConnectionAudit" ("connectionId", "createdAt", "id");

ALTER TABLE "commerce"."CommerceExternalConnectionRevision"
    ADD CONSTRAINT "CommerceExternalConnectionRevision_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "commerce"."CommerceExternalConnection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalConnectionRevision_createdByAdminId_fkey"
    FOREIGN KEY ("createdByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceExternalCredential"
    ADD CONSTRAINT "CommerceExternalCredential_connectionRevisionId_fkey"
    FOREIGN KEY ("connectionRevisionId") REFERENCES "commerce"."CommerceExternalConnectionRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalCredential_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalCredential_updatedByAdminId_fkey"
    FOREIGN KEY ("updatedByAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "commerce"."CommerceExternalConnectionAudit"
    ADD CONSTRAINT "CommerceExternalConnectionAudit_actorAdminId_fkey"
    FOREIGN KEY ("actorAdminId") REFERENCES "public"."PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalConnectionAudit_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "commerce"."CommerceExternalConnection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalConnectionAudit_connectionRevisionId_fkey"
    FOREIGN KEY ("connectionRevisionId") REFERENCES "commerce"."CommerceExternalConnectionRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "CommerceExternalConnectionAudit_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "commerce"."Shop"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "commerce"."reject_external_connection_immutable_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'immutable external connection row: %', TG_TABLE_NAME
        USING ERRCODE = '23000';
END;
$$;

CREATE TRIGGER "CommerceExternalConnectionRevision_immutable_trigger"
    BEFORE UPDATE OR DELETE ON "commerce"."CommerceExternalConnectionRevision"
    FOR EACH ROW EXECUTE FUNCTION "commerce"."reject_external_connection_immutable_change"();
CREATE TRIGGER "CommerceExternalConnectionAudit_immutable_trigger"
    BEFORE UPDATE OR DELETE ON "commerce"."CommerceExternalConnectionAudit"
    FOR EACH ROW EXECUTE FUNCTION "commerce"."reject_external_connection_immutable_change"();
