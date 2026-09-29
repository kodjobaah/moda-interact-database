import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20260929120000_arch021_feature_capability_simplification/migration.sql');
const body = name => schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const enumBody = name => schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

const featureConfiguration = body('CommerceFeatureConfiguration');
for (const field of ['featureId', 'behaviourPrompt', 'editVersion', 'createdAt', 'updatedAt']) assert.match(featureConfiguration, new RegExp(`^\\s*${field}\\s`, 'm'));
assert.match(featureConfiguration, /featureId\s+String\s+@id/);
assert.match(featureConfiguration, /onDelete: Restrict/);

const capability = body('CommerceCapability');
for (const field of ['key', 'displayName', 'description', 'featureId', 'toolId', 'enabled', 'createdAt', 'updatedAt']) assert.match(capability, new RegExp(`^\\s*${field}\\s`, 'm'));
assert.match(capability, /featureId\s+String\s+@db\.Text/);
assert.match(capability, /toolId\s+String\s+@db\.Text/);
assert.match(capability, /@@unique\(\[id, featureId, toolId\]\)/);

const releaseMember = body('CommerceReleaseCapability');
for (const field of ['releaseId', 'capabilityId', 'featureId', 'toolId', 'toolRevisionId', 'position']) assert.match(releaseMember, new RegExp(`^\\s*${field}\\s`, 'm'));
assert.match(releaseMember, /references: \[id, toolId\]/);
assert.match(releaseMember, /references: \[releaseId, featureId\]/);
const releaseFeature = body('CommerceReleaseFeature');
assert.match(releaseFeature, /@@id\(\[releaseId, featureId\]\)/);
assert.match(releaseFeature, /behaviourPrompt\s+String\s+@db\.Text/);
assert.match(body('CommerceToolRevision'), /CommerceToolRevisionStatus/);

for (const obsolete of ['CommerceCapabilitySelectionBinding', 'CommerceCapabilityRevision', 'selectionBinding', 'maxSearchResults', 'maxRecommendations']) {
  assert.doesNotMatch(schema, new RegExp(obsolete), `${obsolete} must not persist in the Prisma schema`);
}
for (const removed of ['CREATE_DRAFT', 'UPDATE_DRAFT', 'PUBLISH_REVISION']) assert.doesNotMatch(enumBody('CommerceAuditAction'), new RegExp(`^\\s*${removed}\\s*$`, 'm'));
assert.match(enumBody('CommerceAuditAction'), /^\s*UPDATE_FEATURE_BEHAVIOUR\s*$/m);

const ordering = text => {
  const offset = migration.indexOf(text);
  assert.notEqual(offset, -1, `${text} missing from migration`);
  return offset;
};
assert.ok(ordering('DELETE FROM commerce."CommerceConversationGrant"') < ordering('DROP TABLE commerce."CommerceCapabilityRevision"'));
assert.ok(ordering('DELETE FROM commerce."CommerceReleaseCapability"') < ordering('DROP TABLE commerce."CommerceCapabilityRevision"'));
assert.ok(ordering('ALTER TYPE commerce."CommerceCapabilityRevisionStatus" RENAME TO "CommerceToolRevisionStatus"') < ordering('DROP TABLE commerce."CommerceCapabilityRevision"') || ordering('DROP TABLE commerce."CommerceCapabilityRevision"') < ordering('ALTER TYPE commerce."CommerceCapabilityRevisionStatus" RENAME TO "CommerceToolRevisionStatus"'));
for (const preserved of ['Feature', 'BillingPlan', 'Subscription', 'MerchantPricingPlan', 'CommerceTool', 'CommerceToolRevision', 'CommerceExternalConnection', 'CommerceExternalConnectionRevision', 'CommerceExternalCredential', 'CommerceAgentConfiguration', 'CommerceModelCatalogueEntry', 'CommercePromptTemplate', 'CommerceAgentPromptRevision', 'Shop', 'Conversation', 'CheckoutRecovery']) {
  assert.doesNotMatch(migration, new RegExp(`DROP TABLE(?: IF EXISTS)?\\s+(?:billing|commerce|whatsapp)\\."${preserved}"`), `${preserved} must be preserved`);
}
for (const guard of ['CommerceFeatureConfiguration', 'CommerceReleaseFeature', 'CommerceReleaseCapability', 'UPDATE_FEATURE_BEHAVIOUR', 'CommerceToolRevisionStatus']) assert.match(migration, new RegExp(guard));
assert.match(migration, /FOREIGN KEY \("capabilityId", "featureId", "toolId"\)/);
assert.match(migration, /FOREIGN KEY \("toolRevisionId", "toolId"\)/);
assert.match(migration, /status <> 'PUBLISHED'/);
assert.match(migration, /release Feature snapshot must match current behaviour prompt/);
console.log('ARCH-021 feature-capability schema contract checks passed.');