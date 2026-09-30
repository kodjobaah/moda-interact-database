CREATE OR REPLACE FUNCTION commerce.arch021_release_feature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_prompt text;
BEGIN
  PERFORM commerce.arch020_current_snapshot();
  PERFORM 1 FROM billing."Feature" WHERE id=NEW."featureId" FOR SHARE;
  SELECT "behaviourPrompt" INTO current_prompt
    FROM commerce."CommerceFeatureConfiguration"
    WHERE "featureId"=NEW."featureId";
  IF NOT FOUND THEN current_prompt := ''; END IF;
  IF NEW."behaviourPrompt" IS DISTINCT FROM current_prompt
    AND NOT EXISTS (
      SELECT 1 FROM commerce."CommerceReleaseFeature" AS prior
      WHERE prior."featureId"=NEW."featureId"
        AND prior."behaviourPrompt"=NEW."behaviourPrompt"
    ) THEN
    RAISE EXCEPTION 'ARCH021 release Feature snapshot must match current or historical behaviour prompt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
