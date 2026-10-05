import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const seed = readFileSync(resolve(root, "prisma/seed.mjs"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20261005143000_ai_conversations_required/migration.sql",
  ),
  "utf8",
);

function requireText(text, value, label) {
  if (!text.includes(value)) throw new Error(`${label}: missing ${value}`);
}

function requirePattern(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: pattern did not match`);
}

requirePattern(
  seed,
  /key: "ai_conversations", displayName: "AI Conversations", activationMode: "ALWAYS_ENABLED", systemRequired: true, active: true/,
  "canonical seed",
);

for (const value of [
  '"key" = \'ai_conversations\'',
  '"activationMode" = \'ALWAYS_ENABLED\'',
  '"systemRequired" = true',
  '"active" = true',
  'INSERT INTO "billing"."MerchantPricingPlanFeature"',
  'INSERT INTO "billing"."BillingPlanFeature"',
  'ON CONFLICT ("planId", "featureId") DO UPDATE',
  'SET "enabled" = true',
  'DELETE FROM "billing"."ShopFeaturePreference"',
]) {
  requireText(migration, value, "required AI Conversations migration behaviour");
}

for (const invariant of [
  "A MerchantPricingPlan is missing required AI Conversations support",
  "A BillingPlan is missing enabled AI Conversations support",
  "AI Conversations merchant preferences remain after conversion to a core feature",
]) {
  requireText(migration, invariant, "post-migration invariant");
}

console.log("ARCH-017 AI Conversations required-feature migration validated");
