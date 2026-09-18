import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const seed = readFileSync(resolve(root, "prisma/seed.mjs"), "utf8");
const migrationPath = resolve(root, "prisma/migrations/20260918120000_arch017_dynamic_features_billing_policy/migration.sql");
const migration = readFileSync(migrationPath, "utf8");

function requireText(text, value, label) {
  if (!text.includes(value)) throw new Error(`${label}: missing ${value}`);
}
function forbidText(text, value, label) {
  if (text.includes(value)) throw new Error(`${label}: forbidden ${value}`);
}
function requirePattern(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: pattern did not match`);
}
function model(name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

function enumValues(name) {
  const match = schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) throw new Error(`missing enum ${name}`);
  return [...match[1].matchAll(/^\s{2}([A-Z_]+)\s*$/gm)].map(([, value]) => value);
}

function requireOrdered(text, first, second, label) {
  if (text.indexOf(first) >= text.indexOf(second)) throw new Error(`${label}: invalid order`);
}

forbidText(schema, "BillingPlanFeatureIdentifier", "schema enum");
requireText(schema, "enum FeatureActivationMode", "activation enum");
const activationModes = enumValues("FeatureActivationMode");
if (activationModes.join(",") !== "ALWAYS_ENABLED,MERCHANT_OPT_IN") throw new Error("activation enum: unexpected values");
for (const key of ["checkout_recovery", "ai_conversations", "product_search", "order_support"]) requireText(migration, key, "feature seed");
const featureModel = model("Feature");
const merchantPlanModel = model("MerchantPricingPlan");
const billingPlanModel = model("BillingPlan");
const billingPlanFeatureModel = model("BillingPlanFeature");
const merchantPlanFeatureModel = model("MerchantPricingPlanFeature");
const shopPreferenceModel = model("ShopFeaturePreference");
requirePattern(featureModel, /key\s+String\s+@unique/, "Feature key");
requirePattern(featureModel, /active\s+Boolean\s+@default\(true\)/, "Feature active");
requirePattern(featureModel, /activationMode\s+FeatureActivationMode/, "Feature activation mode");
requirePattern(featureModel, /systemRequired\s+Boolean\s+@default\(false\)/, "Feature system required");
requireText(merchantPlanModel, "shopifyPlanHandle String @unique", "MerchantPricingPlan unique handle");
for (const field of ["shopifyRecoveryUsageEventHandle", "materializedAt", "features     MerchantPricingPlanFeature[]"]) requireText(merchantPlanModel, field, "MerchantPricingPlan field");
for (const forbidden of ["MerchantPricingPlan", "billingPlanId"]) forbidText(billingPlanModel, forbidden, "BillingPlan physical independence");
requireText(billingPlanFeatureModel, "featureId String", "BillingPlanFeature FK");
requireText(billingPlanFeatureModel, "feature   Feature @relation(fields: [featureId], references: [id], onDelete: Restrict)", "BillingPlanFeature relation");
requireText(billingPlanFeatureModel, "@@unique([planId, featureId])", "BillingPlanFeature identity");
requireText(merchantPlanFeatureModel, "@@id([merchantPricingPlanId, featureId])", "MerchantPricingPlanFeature identity");
requireText(merchantPlanFeatureModel, "onDelete: Cascade", "MerchantPricingPlanFeature cascade");
requireText(shopPreferenceModel, "@@unique([shopId, featureId])", "Shop preference identity");
for (const forbidden of ["Subscription", "BillingPeriod"]) forbidText(shopPreferenceModel, forbidden, "Shop preference lifecycle independence");
for (const field of ["defaultOutboundSoftLimit", "defaultOutboundHardLimit", "terminalMessageReservedSlots"]) {
  forbidText(billingPlanModel, field, "BillingPlan moved field");
  requireText(model("PlatformBillingPolicy"), field, "PlatformBillingPolicy field");
}
requirePattern(model("PlatformBillingPolicy"), /defaultOutboundSoftLimit\s+Int\s+@default\(1000\)/, "PlatformBillingPolicy soft default");
requirePattern(model("PlatformBillingPolicy"), /defaultOutboundHardLimit\s+Int\s+@default\(2000\)/, "PlatformBillingPolicy hard default");
requirePattern(model("PlatformBillingPolicy"), /terminalMessageReservedSlots\s+Int\s+@default\(1\)/, "PlatformBillingPolicy terminal default");
requireText(model("ShopBillingPolicyOverride"), "terminalMessageReservedSlots Int?", "Shop override field");
requireText(migration, 'DROP TYPE "billing"."BillingPlanFeatureIdentifier"', "enum removal");
for (const forbidden of ["BillingPlan.createdAt", "BillingPlan.shopifyUsageEventHandle", "MerchantPricingUsageEvent", "INSERT INTO \"billing\".\"ShopFeaturePreference\"", "Subscription", "BillingPlanFeature" + " bpf" + " JOIN"]) forbidText(migration, forbidden, "migration inference");
for (const key of ["checkout_recovery", "product_search", "ai_conversations", "order_support"]) requireText(seed, key, "seed feature key");
for (const value of ["active: true", "defaultOutboundSoftLimit: 1000", "defaultOutboundHardLimit: 2000", "terminalMessageReservedSlots: 1", "absoluteOutboundHardLimit: 2000"]) requireText(seed, value, "seed canonical default");
requireOrdered(migration, "CREATE TABLE \"billing\".\"Feature\"", "UPDATE \"billing\".\"BillingPlanFeature\"", "feature creation before enum mapping");
requireOrdered(migration, "ALTER TABLE \"billing\".\"PlatformBillingPolicy\"\n  ADD COLUMN", "ALTER TABLE \"billing\".\"BillingPlan\"\n  DROP COLUMN", "policy defaults before BillingPlan removal");
for (const value of [
  'DROP INDEX "billing"."BillingPlanFeature_planId_feature_key"',
  'BillingPlanFeature_featureId_fkey',
  'BillingPlanFeature_featureId_idx',
  'MerchantPricingPlan_free_recovery_usage_handle_null',
  'ShopBillingPolicyOverride_terminal_reserved_valid',
  'PlatformBillingPolicy_default_soft_positive',
  'PlatformBillingPolicy_default_hard_minimum',
  'PlatformBillingPolicy_default_soft_le_hard',
  'PlatformBillingPolicy_default_hard_le_absolute',
  'PlatformBillingPolicy_terminal_reserved_valid',
]) requireText(migration, value, "migration constraint/index");
requireText(migration, 'WHERE f."key" = \'checkout_recovery\'', "mandatory checkout recovery mapping");
if (readdirSync(resolve(root, "prisma/migrations")).filter((name) => name.includes("arch017")).length !== 1) throw new Error("migration: expected exactly one ARCH-017 migration");
console.log("ARCH-017 billing materialisation schema validated");
