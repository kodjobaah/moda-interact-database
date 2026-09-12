import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260912090000_add_promotion_campaign_catalogue/migration.sql",
  "utf8",
);

assert.match(schema, /enum PromotionTargetScope\s*\{[\s\S]*GLOBAL[\s\S]*PLAN[\s\S]*SHOP/);
assert.match(schema, /enum PromotionCampaignStatus\s*\{[\s\S]*DRAFT[\s\S]*ACTIVE[\s\S]*CLOSED/);
assert.match(schema, /enum PromotionCampaignEventType\s*\{[\s\S]*CREATED[\s\S]*ACTIVATED[\s\S]*CLOSED[\s\S]*REOPENED[\s\S]*EXPIRY_CHANGED/);
assert.match(migration, /CREATE TYPE "billing"\."PromotionTargetScope" AS ENUM \('GLOBAL', 'PLAN', 'SHOP'\)/);
assert.match(migration, /CREATE TYPE "billing"\."PromotionCampaignStatus" AS ENUM \('DRAFT', 'ACTIVE', 'CLOSED'\)/);
assert.match(migration, /CREATE TYPE "billing"\."PromotionCampaignEventType" AS ENUM \('CREATED', 'ACTIVATED', 'CLOSED', 'REOPENED', 'EXPIRY_CHANGED'\)/);

assert.match(schema, /model PromotionCampaign\s*\{[\s\S]*name\s+String[\s\S]*merchantDescription\s+String\?[\s\S]*quantity\s+Int[\s\S]*targetPlanId\s+String\?[\s\S]*targetShopId\s+String\?[\s\S]*startsAt\s+DateTime[\s\S]*expiresAt\s+DateTime[\s\S]*status\s+PromotionCampaignStatus[\s\S]*createdByPlatformAdminId\s+String[\s\S]*version\s+Int/);
assert.match(schema, /targetPlan\s+BillingPlan\?[\s\S]*PromotionCampaignTargetPlan[\s\S]*onDelete:\s*Restrict/);
assert.match(schema, /targetShop\s+Shop\?[\s\S]*PromotionCampaignTargetShop[\s\S]*onDelete:\s*Restrict/);
assert.match(schema, /createdByPlatformAdmin\s+PlatformAdmin[\s\S]*PromotionCampaignCreator[\s\S]*onDelete:\s*Restrict/);
assert.match(schema, /model PromotionCampaignEvent\s*\{[\s\S]*campaignId\s+String[\s\S]*kind\s+PromotionCampaignEventType[\s\S]*oldExpiresAt\s+DateTime\?[\s\S]*newExpiresAt\s+DateTime\?[\s\S]*platformAdminId\s+String[\s\S]*createdAt\s+DateTime/);
assert.match(schema, /campaign\s+PromotionCampaign[\s\S]*onDelete:\s*Restrict/);
assert.match(schema, /platformAdmin\s+PlatformAdmin[\s\S]*PromotionCampaignEvents[\s\S]*onDelete:\s*Restrict/);

assert.match(migration, /CREATE TABLE "billing"\."PromotionCampaign"/);
assert.match(migration, /CREATE TABLE "billing"\."PromotionCampaignEvent"/);
assert.match(migration, /PromotionCampaign_quantity_positive[\s\S]*CHECK \("quantity" > 0\)/);
assert.match(migration, /PromotionCampaign_expiry_after_start[\s\S]*CHECK \("expiresAt" > "startsAt"\)/);
assert.match(migration, /PromotionCampaign_scope_target_shape[\s\S]*"scope" = 'GLOBAL'[\s\S]*"scope" = 'PLAN'[\s\S]*"scope" = 'SHOP'/);
assert.match(migration, /PromotionCampaign_status_startsAt_expiresAt_idx/);
assert.match(migration, /PromotionCampaign_targetPlanId_status_startsAt_expiresAt_idx/);
assert.match(migration, /PromotionCampaign_targetShopId_status_startsAt_expiresAt_idx/);
assert.match(migration, /PromotionCampaign_createdAt_idx/);
assert.match(migration, /PromotionCampaign_updatedAt_idx/);
assert.match(migration, /PromotionCampaignEvent_campaignId_createdAt_idx/);
assert.match(migration, /PromotionCampaignEvent_platformAdminId_createdAt_idx/);
assert.match(migration, /PromotionCampaign_targetPlanId_fkey[\s\S]*REFERENCES "billing"\."BillingPlan"[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /PromotionCampaign_targetShopId_fkey[\s\S]*REFERENCES "commerce"\."Shop"[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /PromotionCampaign_createdByPlatformAdminId_fkey[\s\S]*REFERENCES "public"\."PlatformAdmin"[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /PromotionCampaignEvent_campaignId_fkey[\s\S]*ON DELETE RESTRICT/);
assert.match(migration, /PromotionCampaignEvent_platformAdminId_fkey[\s\S]*REFERENCES "public"\."PlatformAdmin"[\s\S]*ON DELETE RESTRICT/);
assert.doesNotMatch(migration, /INSERT INTO/);
assert.doesNotMatch(migration, /PromotionalCreditGrant|ShopEntitlementCounter|BillingAllowanceAdjustment|BillingPeriod|Subscription/);
assert.doesNotMatch(schema, /enum PromotionCampaignStatus\s*\{[^}]*EXPIRED/);

console.log("Promotion campaign schema assertions passed.");
