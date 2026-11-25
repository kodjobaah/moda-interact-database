-- Preserve historical recipient-undeliverable provenance. All other definitive
-- provider non-delivery outcomes use the new general reason.
ALTER TYPE "billing"."UsageReservationCompensationReason"
  ADD VALUE 'WHATSAPP_DELIVERY_FAILED';
