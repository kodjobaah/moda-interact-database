-- ARCH-043: Permit additional metadata in configuration audit JSON records.
-- Secret-safe audit payload construction remains the responsibility of authorised
-- application writers. Retain the other audit constraints and append-only triggers.
-- The original migration is immutable; this forward migration is applied afterwards.
ALTER TABLE "public"."PlatformConfigurationAudit"
    DROP CONSTRAINT "PlatformConfigurationAudit_secret_redacted";
