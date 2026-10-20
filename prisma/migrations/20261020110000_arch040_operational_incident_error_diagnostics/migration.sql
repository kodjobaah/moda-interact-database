-- ARCH-040: bounded, internal-only exception diagnostic for operational incidents.
-- Immutable occurrence history retains the diagnostic observed for each failure.
ALTER TABLE "support"."OperationalIncident"
  ADD COLUMN "lastErrorMessage" VARCHAR(512);

ALTER TABLE "support"."OperationalIncidentEvent"
  ADD COLUMN "errorMessage" VARCHAR(512);

-- Opaque credentials, payloads and stack traces must be redacted by producers.
-- Database bounds are independent of application-side validation.
ALTER TABLE "support"."OperationalIncident"
  ADD CONSTRAINT "OperationalIncident_lastErrorMessage_length_check"
  CHECK ("lastErrorMessage" IS NULL OR char_length("lastErrorMessage") BETWEEN 1 AND 512);

ALTER TABLE "support"."OperationalIncidentEvent"
  ADD CONSTRAINT "OperationalIncidentEvent_errorMessage_length_check"
  CHECK ("errorMessage" IS NULL OR char_length("errorMessage") BETWEEN 1 AND 512);
