import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(repositoryRoot, "prisma", "schema.prisma");
const migrationPath = join(repositoryRoot, "prisma", "migrations", "20260915090000_arch014_merchant_pricing_catalogue", "migration.sql");
const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");
const failures = [];

const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const enumBlock = (name) => schema.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const modelBlock = (name) => schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

const exactEnums = {
  MerchantPricingPlanKind: ["FREE", "PAID_METERED"],
  MerchantPricingAllowancePeriod: ["LIFETIME", "EVERY_30_DAYS"],
  MerchantPricingBillingPeriod: ["EVERY_30_DAYS"],
  MerchantPricingUsagePricingMode: ["FIXED", "GRADUATED", "VOLUME"],
};

for (const [name, literals] of Object.entries(exactEnums)) {
  const block = enumBlock(name);
  expect(block.length > 0, `missing enum ${name}`);
  expect(literals.every((literal) => new RegExp(`^\\s+${literal}\\s*$`, "m").test(block)), `enum ${name} literals do not match`);
  expect(/@@schema\("billing"\)/.test(block), `enum ${name} is not in billing schema`);
}

const modelRequirements = {
  MerchantPricingPlan: [
    "id String @id @default(cuid())", "shopifyPlanHandle String @unique", "displayName String", "planKind MerchantPricingPlanKind",
    "isActive Boolean @default(true)", "cataloguePosition Int", "featured Boolean @default(false)", "includedRecoveryCredits Int",
    "allowancePeriod MerchantPricingAllowancePeriod", "billingPeriod MerchantPricingBillingPeriod", "recurringAmountMinor Int", "currency String @db.Char(3)",
    "translations MerchantPricingPlanTranslation[]", "usageEvents MerchantPricingUsageEvent[]", "createdAt DateTime @default(now())", "updatedAt DateTime @updatedAt",
    "@@index([isActive, cataloguePosition])", "@@index([planKind, isActive])", "@@schema(\"billing\")",
  ],
  MerchantPricingPlanTranslation: [
    "id String @id @default(cuid())", "merchantPricingPlanId String", "merchantPricingPlan MerchantPricingPlan @relation(fields:[merchantPricingPlanId], references:[id], onDelete:Cascade)",
    "locale String @db.VarChar(16)", "merchantDescription String @db.Text", "createdAt DateTime @default(now())", "updatedAt DateTime @updatedAt",
    "@@unique([merchantPricingPlanId, locale])", "@@schema(\"billing\")",
  ],
  MerchantPricingUsageEvent: [
    "id String @id @default(cuid())", "merchantPricingPlanId String", "merchantPricingPlan MerchantPricingPlan @relation(fields:[merchantPricingPlanId], references:[id], onDelete:Cascade)",
    "eventHandle String", "adminLabel String", "creditsGrantedPerUnit Int", "position Int", "pricingMode MerchantPricingUsagePricingMode", "currency String @db.Char(3)",
    "fixedUnitAmountMinor Int?", "maximumUnitsPerBillingPeriod Int?", "tiers MerchantPricingUsageTier[]", "createdAt DateTime @default(now())", "updatedAt DateTime @updatedAt",
    "@@unique([merchantPricingPlanId, eventHandle])", "@@unique([merchantPricingPlanId, position])", "@@schema(\"billing\")",
  ],
  MerchantPricingUsageTier: [
    "id String @id @default(cuid())", "merchantPricingUsageEventId String", "merchantPricingUsageEvent MerchantPricingUsageEvent @relation(fields:[merchantPricingUsageEventId], references:[id], onDelete:Cascade)",
    "position Int", "upTo Int?", "amountPerUnitMinor Int", "flatAmountMinor Int", "@@unique([merchantPricingUsageEventId, position])", "@@schema(\"billing\")",
  ],
};

for (const [name, requirements] of Object.entries(modelRequirements)) {
  const block = modelBlock(name);
  expect(block.length > 0, `missing model ${name}`);
  for (const requirement of requirements) expect(block.includes(requirement), `model ${name} missing ${requirement}`);
}

const locales = ["cs", "da", "de", "en", "es", "fi", "fr", "it", "ja", "ko", "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "zh-Hans", "zh-Hant"];
expect(locales.every((locale) => migration.includes(`'${locale}'`)), "migration is missing a canonical locale literal");
expect(/ck_merchant_pricing_translation_locale[\s\S]*IN \('cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant'\)/.test(migration), "locale CHECK does not contain the exact canonical set");

const exactChecks = {
  ck_merchant_pricing_plan_handle_nonblank: `btrim("shopifyPlanHandle") <> ''`,
  ck_merchant_pricing_plan_display_name_nonblank: `btrim("displayName") <> ''`,
  ck_merchant_pricing_plan_catalogue_position: `"cataloguePosition" >= 0`,
  ck_merchant_pricing_plan_included_credits_nonnegative: `"includedRecoveryCredits" >= 0`,
  ck_merchant_pricing_plan_recurring_amount_nonnegative: `"recurringAmountMinor" >= 0`,
  ck_merchant_pricing_plan_currency: `"currency" ~ '^[A-Z]{3}$'`,
  ck_merchant_pricing_translation_locale: `"locale" IN ('cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'it', 'ja', 'ko', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv', 'th', 'tr', 'zh-Hans', 'zh-Hant')`,
  ck_merchant_pricing_translation_description: `btrim("merchantDescription") <> '' AND char_length("merchantDescription") <= 2000`,
  ck_merchant_pricing_usage_handle_nonblank: `btrim("eventHandle") <> ''`,
  ck_merchant_pricing_usage_admin_label: `btrim("adminLabel") <> '' AND char_length("adminLabel") <= 255`,
  ck_merchant_pricing_usage_credits_positive: `"creditsGrantedPerUnit" > 0`,
  ck_merchant_pricing_usage_position: `"position" BETWEEN 0 AND 4`,
  ck_merchant_pricing_usage_currency: `"currency" ~ '^[A-Z]{3}$'`,
  ck_merchant_pricing_usage_fixed_amount: `"fixedUnitAmountMinor" IS NULL OR "fixedUnitAmountMinor" >= 0`,
  ck_merchant_pricing_usage_maximum_units: `"maximumUnitsPerBillingPeriod" IS NULL OR "maximumUnitsPerBillingPeriod" > 0`,
  ck_merchant_pricing_tier_position: `"position" BETWEEN 0 AND 5`,
  ck_merchant_pricing_tier_up_to: `"upTo" IS NULL OR "upTo" > 0`,
  ck_merchant_pricing_tier_amounts: `"amountPerUnitMinor" >= 0 AND "flatAmountMinor" >= 0`,
};

for (const [name, expression] of Object.entries(exactChecks)) {
  expect(migration.includes(`CONSTRAINT "${name}" CHECK (${expression})`), `check ${name} does not have the exact required expression`);
}

const checkNames = Object.keys(exactChecks);
for (const name of checkNames) expect(migration.includes(`CONSTRAINT "${name}"`), `missing named check ${name}`);
expect(/CONSTRAINT "uq_merchant_pricing_plan_catalogue_position" UNIQUE \("cataloguePosition"\) DEFERRABLE INITIALLY DEFERRED/.test(migration), "missing deferred catalogue-position uniqueness");
expect(migration.includes("billing.validate_arch014_merchant_pricing_plan(plan_id text)"), "missing per-plan validation function");
expect(migration.includes("billing.validate_arch014_merchant_pricing_catalogue_positions()"), "missing global catalogue validation function");
expect(/CREATE CONSTRAINT TRIGGER[\s\S]*DEFERRABLE INITIALLY DEFERRED/.test(migration), "missing deferred constraint trigger");
expect(migration.includes("ARCH014_MERCHANT_PRICING_INVALID:"), "missing bounded ARCH-014 validation errors");

const allowedMigrationTargets = new Set(["MerchantPricingPlan", "MerchantPricingPlanTranslation", "MerchantPricingUsageEvent", "MerchantPricingUsageTier"]);
for (const match of migration.matchAll(/ALTER TABLE\s+"(?:billing|public|commerce|shopify|whatsapp|support)"\."([^"]+)"/g)) {
  expect(allowedMigrationTargets.has(match[1]), `migration alters non-ARCH-014 table ${match[1]}`);
}
for (const match of migration.matchAll(/CREATE TABLE\s+"(?:billing|public|commerce|shopify|whatsapp|support)"\."([^"]+)"/g)) {
  expect(allowedMigrationTargets.has(match[1]), `migration creates non-ARCH-014 table ${match[1]}`);
}
for (const match of migration.matchAll(/CREATE TYPE\s+"(?:billing|public|commerce|shopify|whatsapp|support)"\."([^"]+)"/g)) {
  expect(match[1].startsWith("MerchantPricing"), `migration creates non-ARCH-014 type ${match[1]}`);
}
for (const match of migration.matchAll(/CREATE(?: OR REPLACE)? FUNCTION\s+billing\.([a-zA-Z0-9_]+)\s*\(/g)) {
  expect(match[1].startsWith("validate_arch014_merchant_pricing_"), `migration creates non-ARCH-014 function ${match[1]}`);
}
for (const match of migration.matchAll(/ON\s+"billing"\."([^"]+)"\s+DEFERRABLE/g)) {
  expect(allowedMigrationTargets.has(match[1]), `migration creates a deferred trigger on non-ARCH-014 table ${match[1]}`);
}
for (const forbidden of ["BillingPlan", "BillingEconomicsSnapshot", "BillingUpgradeEconomicsEdge", "PlatformAdmin"]) {
  expect(!migration.includes(`"${forbidden}"`), `migration references pre-existing table ${forbidden}`);
}

for (const forbiddenModel of ["BillingPlan", "BillingEconomicsSnapshot", "BillingUpgradeEconomicsEdge", "PlatformAdmin"]) {
  const current = modelBlock(forbiddenModel);
  let original = "";
  try {
    let baselineRef;
    try {
      baselineRef = execFileSync("git", ["rev-parse", "--verify", "origin/main^{commit}"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    } catch {
      baselineRef = execFileSync("git", ["rev-parse", "--verify", "HEAD^"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    }
    original = execFileSync("git", ["show", `${baselineRef}:prisma/schema.prisma`], { cwd: repositoryRoot, encoding: "utf8" }).match(new RegExp(`model ${forbiddenModel} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  } catch {
    failures.push("unable to inspect baseline schema for additive-only model comparison");
  }
  expect(current === original, `pre-existing model ${forbiddenModel} changed`);
}

const changedFiles = execFileSync("git", ["status", "--short"], { cwd: repositoryRoot, encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.slice(3));
const allowedFiles = new Set([
  "prisma/schema.prisma",
  "prisma/migrations/20260915090000_arch014_merchant_pricing_catalogue/migration.sql",
  "scripts/validate-arch014-merchant-pricing-catalogue.mjs",
  "docs/generated/prisma-erd.puml",
]);
for (const file of changedFiles) {
  const normalizedFile = file.endsWith("/") ? `${file}migration.sql` : file;
  expect(allowedFiles.has(normalizedFile), `unauthorized changed file ${file}`);
}

try {
  const baselineRef = execFileSync("git", ["rev-parse", "--verify", "origin/main^{commit}"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const committedFiles = execFileSync("git", ["diff", "--name-only", `${baselineRef}...HEAD`], { cwd: repositoryRoot, encoding: "utf8" })
    .split("\n").filter(Boolean);
  for (const file of committedFiles) expect(allowedFiles.has(file), `unauthorized committed file ${file}`);
} catch {
  failures.push("unable to inspect committed diff for additive-only file scope");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}

console.log("ARCH-014 merchant pricing catalogue static validation passed.");