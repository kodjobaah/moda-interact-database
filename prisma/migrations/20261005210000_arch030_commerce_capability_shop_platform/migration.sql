-- ARCH-030: Capability platform applicability.
-- NULL remains the explicit generic/universal capability scope. Existing rows
-- are intentionally left NULL because provider applicability cannot be inferred
-- safely from historical Tool definitions at the database layer.

ALTER TABLE commerce."CommerceCapability"
  ADD COLUMN "shopPlatform" commerce."ShopPlatform";

-- Capability platform is part of the durable capability identity. Releases
-- reference the capability row, so changing its platform in place would change
-- the meaning of already-composed releases.
CREATE OR REPLACE FUNCTION commerce.arch020_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  IF TG_TABLE_NAME = 'CommerceTool' THEN
    IF NEW."name" IS DISTINCT FROM OLD."name" THEN RAISE EXCEPTION 'ARCH020 tool name immutable' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW."key", NEW."featureId", NEW."toolId", NEW."shopPlatform") IS DISTINCT FROM ROW(OLD."key", OLD."featureId", OLD."toolId", OLD."shopPlatform") THEN
    RAISE EXCEPTION 'ARCH030 capability identity immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
