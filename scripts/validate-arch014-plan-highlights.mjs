import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const migrationPath = join(
  repositoryRoot,
  "prisma",
  "migrations",
  "20260915170000_arch014_merchant_pricing_plan_highlights",
  "migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const highlightTable = '"billing"."MerchantPricingPlanHighlight"';
const translationTable = '"billing"."MerchantPricingPlanHighlightTranslation"';
const exactLocales = [
  "cs", "da", "de", "en", "es", "fi", "fr", "it", "ja", "ko",
  "nb", "nl", "pl", "pt-BR", "pt-PT", "sv", "th", "tr", "zh-Hans", "zh-Hant",
];
const localeList = exactLocales.map((locale) => `'${locale}'`).join(", ");

expect(migration.includes(`CREATE TABLE ${highlightTable}`), "missing MerchantPricingPlanHighlight table");
expect(migration.includes(`CREATE TABLE ${translationTable}`), "missing MerchantPricingPlanHighlightTranslation table");
expect(
  new RegExp(`REFERENCES ${'"billing"\\."MerchantPricingPlan"'}\\(\\"id\\"\\)\\s+ON DELETE CASCADE`).test(migration),
  "missing highlight to MerchantPricingPlan ON DELETE CASCADE foreign key",
);
expect(
  new RegExp(`REFERENCES ${highlightTable.replaceAll(".", "\\.")}\\(\\"id\\"\\)\\s+ON DELETE CASCADE`).test(migration),
  "missing translation to highlight ON DELETE CASCADE foreign key",
);
expect(
  migration.includes('"contentKey" UUID NOT NULL'),
  "contentKey is not represented as a PostgreSQL UUID",
);
expect(
  migration.includes('CONSTRAINT "ck_arch014_plan_highlight_position" CHECK ("position" >= 0)'),
  "highlight position validation is missing",
);
expect(
  migration.includes('CONSTRAINT "uq_arch014_plan_highlight_position" UNIQUE ("merchantPricingPlanId", "position") DEFERRABLE INITIALLY DEFERRED'),
  "position uniqueness is not DEFERRABLE INITIALLY DEFERRED",
);
expect(
  migration.includes(`"locale" IN (${localeList})`),
  "locale validation does not contain the exact 20-locale set",
);
expect(
  migration.includes('btrim("merchantTitle") <> \'\' AND char_length("merchantTitle") <= 120'),
  "merchantTitle validation is missing",
);
expect(
  migration.includes('btrim("merchantDescription") <> \'\' AND char_length("merchantDescription") <= 500'),
  "merchantDescription validation is missing",
);
expect(
  migration.includes("billing.validate_arch014_plan_highlight_translation_state(highlight_id text)"),
  "missing highlight translation-completeness function",
);
expect(
  migration.includes("billing.validate_arch014_plan_highlight_position_state(plan_id text)"),
  "missing highlight contiguous-position function",
);
expect(
  migration.includes("billing.validate_arch014_plan_highlight_trigger()"),
  "missing highlight trigger adapter",
);
expect(
  migration.includes("billing.validate_arch014_plan_highlight_translation_trigger()"),
  "missing highlight translation trigger adapter",
);
expect(
  /CREATE CONSTRAINT TRIGGER[\s\S]*DEFERRABLE INITIALLY DEFERRED/.test(migration),
  "missing deferred highlight constraint trigger",
);
expect(
  migration.includes("translation_count <> 20") && migration.includes("ARCH014_PLAN_HIGHLIGHT_INVALID:translation_count"),
  "missing exact 20-translation validation",
);
expect(
  migration.includes("ARCH014_PLAN_HIGHLIGHT_INVALID:locale_set"),
  "missing exact locale-set validation",
);
expect(
  migration.includes("ARCH014_PLAN_HIGHLIGHT_INVALID:positions") && migration.includes("generate_series(0, highlight_count - 1)"),
  "missing contiguous-position validation",
);

for (const match of migration.matchAll(/ALTER TABLE\s+"(?:billing|public|commerce|shopify|whatsapp|support)"\."([^"]+)"/g)) {
  expect(
    match[1] === "MerchantPricingPlanHighlight" || match[1] === "MerchantPricingPlanHighlightTranslation",
    `migration alters existing table ${match[1]}`,
  );
}
for (const forbidden of [
  "MerchantPricingPlanTranslation",
  "MerchantPricingUsageEvent",
  "MerchantPricingUsageTier",
  "BillingPlan",
]) {
  expect(!migration.includes(`"${forbidden}"`), `migration references forbidden existing table ${forbidden}`);
}
expect(!/CREATE\s+(OR REPLACE\s+)?TYPE\s+/i.test(migration), "migration creates or alters an enum");
expect(!/DROP\s+(TABLE|TYPE|INDEX|CONSTRAINT)|RENAME\s+/i.test(migration), "migration drops or renames an existing object");
expect(!/\bUPDATE\s+"|\bINSERT\s+INTO\s+"billing"\./i.test(migration), "migration backfills existing data");

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}

console.log("ARCH-014 plan-card highlights migration isolation validation passed.");
