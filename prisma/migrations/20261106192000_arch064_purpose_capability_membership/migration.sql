-- Additive global Studio purpose membership; no merchant grant or capability ownership change.
CREATE TABLE commerce."CommercePurposeCapability" (
  "purposeFeatureId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "CommercePurposeCapability_pkey" PRIMARY KEY ("purposeFeatureId", "capabilityId"),
  CONSTRAINT "CommercePurposeCapability_position_check" CHECK ("position" >= 0),
  CONSTRAINT "CommercePurposeCapability_purposeFeatureId_fkey" FOREIGN KEY ("purposeFeatureId") REFERENCES billing."Feature"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommercePurposeCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES commerce."CommerceCapability"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommercePurposeCapability_purposeFeatureId_position_key" ON commerce."CommercePurposeCapability"("purposeFeatureId", "position");
CREATE INDEX "CommercePurposeCapability_capabilityId_idx" ON commerce."CommercePurposeCapability"("capabilityId");

CREATE TABLE commerce."CommerceReleasePurposeCapability" (
  "releaseId" TEXT NOT NULL,
  "purposeFeatureId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "CommerceReleasePurposeCapability_pkey" PRIMARY KEY ("releaseId", "purposeFeatureId", "capabilityId"),
  CONSTRAINT "CommerceReleasePurposeCapability_position_check" CHECK ("position" >= 0),
  CONSTRAINT "CommerceReleasePurposeCapability_releaseId_purposeFeatureI_fkey" FOREIGN KEY ("releaseId", "purposeFeatureId") REFERENCES commerce."CommerceReleaseFeature"("releaseId", "featureId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommerceReleasePurposeCapability_releaseId_capabilityId_fkey" FOREIGN KEY ("releaseId", "capabilityId") REFERENCES commerce."CommerceReleaseCapability"("releaseId", "capabilityId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "CommerceReleasePurposeCapability_position_key" ON commerce."CommerceReleasePurposeCapability"("releaseId", "purposeFeatureId", "position");
CREATE INDEX "CommerceReleasePurposeCapability_releaseId_capabilityId_idx" ON commerce."CommerceReleasePurposeCapability"("releaseId", "capabilityId");
CREATE TRIGGER arch064_release_purpose_immutable BEFORE UPDATE OR DELETE ON commerce."CommerceReleasePurposeCapability" FOR EACH ROW EXECUTE FUNCTION commerce.arch020_immutable();
