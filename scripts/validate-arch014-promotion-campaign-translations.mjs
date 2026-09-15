import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const schemaPath = join(repositoryRoot, "prisma", "schema.prisma");
const migrationPath = join(
  repositoryRoot,
  "prisma",
  "migrations",
  "20260915210000_arch014_promotion_campaign_translations",
  "migration.sql",
);
const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const modelBlock = (source, name) =>
  source.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const normalize = (value) =>
  value.replace(/^\s*translations\s+PromotionCampaignTranslation\[\]\s*$/m, "");

const translationModel = modelBlock(schema, "PromotionCampaignTranslation");
expect(
  (schema.match(/model PromotionCampaignTranslation \{/g) ?? []).length === 1,
  "PromotionCampaignTranslation model must exist exactly once",
);
for (const requirement of [
  "id                  String            @id @default(cuid())",
  "promotionCampaignId String",
  "promotionCampaign   PromotionCampaign @relation(fields: [promotionCampaignId], references: [id], onDelete: Cascade)",
  "locale              String @db.VarChar(16)",
  "merchantTitle       String @db.VarChar(255)",
  "merchantDescription String @db.Text",
  "createdAt DateTime @default(now())",
  "updatedAt DateTime @updatedAt",
  "@@unique([promotionCampaignId, locale])",
  "@@index([promotionCampaignId])",
  '@@schema("billing")',
]) {
  expect(translationModel.includes(requirement), `translation model missing ${requirement}`);
}
expect(
  (schema.match(/^\s+translations\s+PromotionCampaignTranslation\[\]\s*$/gm) ?? []).length === 1,
  "PromotionCampaign translations relation must exist exactly once",
);

const exactLocales = [
  "cs", "da", "de", "en", "es", "fi", "fr", "it", "ja", "ko",
  "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "zh-Hans", "zh-Hant",
];
const localeList = exactLocales.map((locale) => `'${locale}'`).join(", ");
expect(migration.includes(`CREATE TABLE "billing"."PromotionCampaignTranslation"`), "missing translation table");
expect(migration.includes(`"locale" IN (${localeList})`), "locale CHECK does not contain the exact 20-locale set");
expect(
  migration.includes('CONSTRAINT "ck_arch014_promotion_campaign_translation_title" CHECK (\n      char_length(btrim("merchantTitle")) BETWEEN 1 AND 255\n    )'),
  "title CHECK is not exact",
);
expect(
  migration.includes('CONSTRAINT "ck_arch014_promotion_campaign_translation_description" CHECK (\n      char_length(btrim("merchantDescription")) BETWEEN 1 AND 10000\n    )'),
  "description CHECK is not exact",
);
expect(
  migration.includes('CONSTRAINT "uq_arch014_promotion_campaign_translation_locale" UNIQUE ("promotionCampaignId", "locale")'),
  "translation uniqueness is missing",
);
expect(
  migration.includes('FOREIGN KEY ("promotionCampaignId")\n      REFERENCES "billing"."PromotionCampaign"("id")\n      ON DELETE CASCADE ON UPDATE CASCADE'),
  "campaign foreign key does not cascade",
);
expect(
  migration.includes('CREATE INDEX "PromotionCampaignTranslation_promotionCampaignId_idx"'),
  "campaign foreign-key index is missing",
);
expect(!/CREATE TRIGGER|CREATE CONSTRAINT TRIGGER|CREATE OR REPLACE FUNCTION/i.test(migration), "migration must not create triggers or functions");
expect(!/ALTER TABLE\s+"billing"\."(?!PromotionCampaignTranslation")/i.test(migration), "migration alters a pre-existing table");
expect((migration.match(/CREATE TABLE /g) ?? []).length === 1, "migration creates more than one table");

const forbiddenMigrationReferences = [
  '"BillingPlan"', '"PromotionCampaignEvent"', '"PromotionalCreditGrant"',
  '"PromotionCampaign"("merchantDescription")', "DROP COLUMN", "RENAME COLUMN",
];
for (const forbidden of forbiddenMigrationReferences) {
  expect(!migration.includes(forbidden), `migration contains forbidden reference ${forbidden}`);
}

const preservedModels = [
  "PromotionCampaign",
  "PromotionCampaignEvent",
  "PromotionalCreditGrant",
  "BillingPlan",
  "BillingPlanFeature",
  "BillingEconomicsSnapshot",
  "BillingUpgradeEconomicsEdge",
];
let baselineSchema;
try {
  baselineSchema = execFileSync("git", ["show", "f202931c58dba7f9fcc53c74333736e978e8b6de:prisma/schema.prisma"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
} catch {
  failures.push("unable to read the supplied database baseline schema");
}
if (baselineSchema) {
  for (const name of preservedModels) {
    const current = normalize(modelBlock(schema, name));
    const original = modelBlock(baselineSchema, name);
    expect(current === original, `pre-existing model ${name} changed`);
  }
  for (const name of ["PromotionTargetScope", "PromotionCampaignStatus", "PromotionCampaignEventType", "BillingPlanKind"]) {
    expect(modelBlock(schema, name) === modelBlock(baselineSchema, name), `pre-existing enum ${name} changed`);
  }
}

const changedFiles = execFileSync("git", ["status", "--short"], { cwd: repositoryRoot, encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.slice(3));
const allowedFiles = new Set([
  "package.json",
  "prisma/schema.prisma",
  "prisma/migrations/20260915210000_arch014_promotion_campaign_translations/migration.sql",
  "scripts/validate-arch014-promotion-campaign-translations.mjs",
  "docs/generated/prisma-erd.puml",
  "docs/generated/erd.png",
]);
for (const file of changedFiles) {
  const normalizedFile = file.endsWith("/") ? `${file}migration.sql` : file;
  expect(allowedFiles.has(normalizedFile), `unauthorized changed file ${file}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("ARCH-014 promotion campaign translations static validation passed.");