import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const target = "20261010170000_arch031_merchant_pricing_publication_lifecycle";
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url),
  "utf8",
);
const migrationNames = readdirSync(new URL("../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_.+$/.test(name))
  .sort();

function prismaBlock(kind, name) {
  const match = schema.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(match, `missing Prisma ${kind} ${name}`);
  return match[1];
}

assert.equal(
  migrationNames.at(-1),
  target,
  "ARCH-031 Merchant Pricing publication lifecycle migration must remain the latest ordered migration",
);

const publicationEnum = prismaBlock("enum", "MerchantPricingPlanPublicationStatus");
for (const value of ["TRANSLATING", "TRANSLATION_FAILED", "READY"]) {
  assert.match(publicationEnum, new RegExp(`^\\s*${value}\\s*$`, "m"));
}

const plan = prismaBlock("model", "MerchantPricingPlan");
assert.match(plan, /^\s*publicationStatus\s+MerchantPricingPlanPublicationStatus\s+@default\(READY\)/m);
assert.match(plan, /^\s*currentTranslationRunId\s+String\?\s+@unique/m);
assert.match(
  plan,
  /currentTranslationRun\s+MerchantPricingTranslationRun\?\s+@relation\("MerchantPricingPlanCurrentTranslationRun"[\s\S]*onDelete: Restrict[\s\S]*onUpdate: Restrict/,
);
assert.match(plan, /@@index\(\[publicationStatus, isActive, cataloguePosition\]/);

const run = prismaBlock("model", "MerchantPricingTranslationRun");
assert.match(run, /currentForPlan\s+MerchantPricingPlan\?\s+@relation\("MerchantPricingPlanCurrentTranslationRun"\)/);

for (const required of [
  'CREATE TYPE "billing"."MerchantPricingPlanPublicationStatus"',
  'ADD COLUMN "publicationStatus"',
  'ADD COLUMN "currentTranslationRunId" TEXT',
  'MerchantPricingPlan_current_translation_run_key',
  'MerchantPricingPlan_publication_active_position_idx',
  'MerchantPricingPlan_current_translation_run_fkey',
  'ck_arch031_merchant_pricing_publication_activation',
  'ck_arch031_merchant_pricing_publication_run',
  'ARCH031_MERCHANT_PRICING_INVALID:translation_run_handle',
  'ARCH031_MERCHANT_PRICING_INVALID:draft_translations',
  'ARCH031_PLAN_HIGHLIGHT_INVALID:draft_translations',
]) {
  assert.ok(migration.includes(required), `${required} missing from migration`);
}

assert.match(
  migration,
  /CHECK \(NOT "isActive" OR "publicationStatus" = 'READY'\)/,
  "draft or failed plans must never be active",
);
assert.match(
  migration,
  /CHECK \("publicationStatus" = 'READY' OR "currentTranslationRunId" IS NOT NULL\)/,
  "non-ready plans must remain associated with durable translation work",
);
assert.match(
  migration,
  /publicationStatus" = 'READY'[\s\S]*?translation_count <> 20[\s\S]*?translation_count <> 1[\s\S]*?"locale" = 'en'/,
  "plan translation validation must switch between complete and English-only lifecycle states",
);
assert.match(
  migration,
  /publication_status = 'READY'[\s\S]*?translation_count <> 20[\s\S]*?translation_count <> 1[\s\S]*?"locale" = 'en'/,
  "highlight translation validation must switch between complete and English-only lifecycle states",
);
assert.match(
  migration,
  /FOREIGN KEY \("currentTranslationRunId"\)[\s\S]*REFERENCES "billing"\."MerchantPricingTranslationRun"\("id"\)[\s\S]*ON DELETE RESTRICT ON UPDATE RESTRICT/,
);
assert.doesNotMatch(
  migration,
  /DROP\s+(?:TABLE|TYPE|TRIGGER|FUNCTION|CONSTRAINT)/i,
  "publication lifecycle migration must evolve ARCH-014 invariants rather than dropping them",
);
assert.doesNotMatch(
  migration,
  /UPDATE\s+"billing"\."MerchantPricingPlan"/i,
  "existing complete plans should converge through the READY default without a data rewrite",
);

console.log("ARCH-031 Merchant Pricing publication lifecycle validation passed.");
