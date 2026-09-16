import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260916150000_arch016_recovery_policy_discounts_outreach_generations/migration.sql");
const erd = read("docs/generated/prisma-erd.puml");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const required of [
  "enum RecoveryOfferMode",
  "model ShopRecoveryPolicyOverride",
  "model ShopRecoveryPolicyOverrideAuditEvent",
  "model ShopifyDiscountCatalogue",
  "model ShopifyDiscount",
  "model RecoveryOutreachAttempt",
]) {
  expect(schema.includes(required), `schema missing ${required}`);
}

for (const required of [
  "lastExternalActivityAt DateTime",
  "checkoutRecoveryLifetimeDays  Int @default(21)",
  "CHECKOUT_RECOVERY_EXPIRY",
  "recoveryOutreachAttempt RecoveryOutreachAttempt?",
  "@@unique([shopId, checkoutToken, generation])",
  "@@unique([checkoutRecoveryId, sequence])",
]) {
  expect(schema.includes(required), `schema missing ${required}`);
}

for (const required of [
  'UPDATE "commerce"."CheckoutRecovery"',
]) {
  expect(migration.includes(required), `migration missing ${required}`);
}
for (const required of [
  'CREATE UNIQUE INDEX "CheckoutRecovery_active_generation_key"',
  'WHERE "status" IN (\'DETECTED\', \'MESSAGE_SENT\', \'ENGAGED\')',
  'CONSTRAINT "ck_arch016_shop_settings_fixed_offer"',
  'CONSTRAINT "ck_arch016_policy_override_fixed_offer"',
  'CONSTRAINT "ck_arch016_discount_catalogue_syncing"',
  'CONSTRAINT "ck_arch016_discount_fixed_selectable"',
  'CONSTRAINT "ck_arch016_outreach_waiting_message"',
  'CONSTRAINT "ck_arch016_checkout_recovery_lifetime"',
  'CREATE UNIQUE INDEX "RecoveryOutreachAttempt_checkoutRecoveryId_sequence_key"',
]) {
  expect(migration.includes(required), `migration missing ${required}`);
}

for (const model of [
  "ShopRecoveryPolicyOverride",
  "ShopRecoveryPolicyOverrideAuditEvent",
  "ShopifyDiscountCatalogue",
  "ShopifyDiscount",
  "RecoveryOutreachAttempt",
]) {
  expect(erd.includes(`entity "${model}"`), `ERD missing ${model}`);
}

const changedFiles = execFileSync("git", ["status", "--short"], { cwd: new URL("..", import.meta.url), encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.slice(3));
const allowed = new Set([
  "prisma/schema.prisma",
  "prisma/migrations/20260916150000_arch016_recovery_policy_discounts_outreach_generations/migration.sql",
  "scripts/validate-arch016-recovery-schema.mjs",
  "docs/generated/prisma-erd.puml",
  "docs/generated/erd.png",
  "package.json",
]);
for (const file of changedFiles) {
  const normalizedFile = file.endsWith("/") ? `${file}migration.sql` : file;
  expect(allowed.has(normalizedFile), `unauthorized changed file ${file}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("ARCH-016 recovery schema static validation passed.");
