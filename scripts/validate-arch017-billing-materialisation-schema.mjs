import { readFileSync } from "node:fs";
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
function model(name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

forbidText(schema, "BillingPlanFeatureIdentifier", "schema enum");
requireText(schema, "enum FeatureActivationMode", "activation enum");
requireText(schema, "ALWAYS_ENABLED", "activation mode");
requireText(schema, "MERCHANT_OPT_IN", "activation mode");
for (const key of ["checkout_recovery", "ai_conversations", "product_search", "order_support"]) requireText(migration, key, "feature seed");
for (const name of ["Feature", "MerchantPricingPlanFeature", "ShopFeaturePreference"]) model(name);
requireText(model("Feature"), "key            String                @unique", "Feature key");
requireText(model("MerchantPricingPlan"), "shopifyRecoveryUsageEventHandle", "MerchantPricingPlan meter");
requireText(model("MerchantPricingPlan"), "materializedAt", "MerchantPricingPlan materializedAt");
requireText(model("MerchantPricingPlan"), "features     MerchantPricingPlanFeature[]", "MerchantPricingPlan features");
requireText(model("BillingPlanFeature"), "featureId", "BillingPlanFeature FK");
requireText(model("BillingPlanFeature"), "@@unique([planId, featureId])", "BillingPlanFeature identity");
requireText(model("ShopFeaturePreference"), "@@unique([shopId, featureId])", "Shop preference identity");
for (const field of ["defaultOutboundSoftLimit", "defaultOutboundHardLimit", "terminalMessageReservedSlots"]) {
  forbidText(model("BillingPlan"), field, "BillingPlan moved field");
  requireText(model("PlatformBillingPolicy"), field, "PlatformBillingPolicy field");
}
requireText(model("ShopBillingPolicyOverride"), "terminalMessageReservedSlots", "Shop override field");
requireText(migration, 'DROP TYPE "billing"."BillingPlanFeatureIdentifier"', "enum removal");
for (const forbidden of ["BillingPlan.createdAt", "BillingPlan.shopifyUsageEventHandle", "MerchantPricingUsageEvent", "INSERT INTO \"billing\".\"ShopFeaturePreference\""]) forbidText(migration, forbidden, "migration inference");
for (const key of ["checkout_recovery", "product_search", "ai_conversations", "order_support"]) requireText(seed, key, "seed feature key");
requireText(seed, "defaultOutboundSoftLimit: 1000", "seed policy default");
console.log("ARCH-017 billing materialisation schema validated");
