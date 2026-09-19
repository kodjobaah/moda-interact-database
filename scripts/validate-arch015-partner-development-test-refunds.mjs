import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260919194500_arch015_partner_development_test_refunds/migration.sql",
  "utf8",
);

assert.match(
  schema,
  /shopifyPartnerDevelopmentSnapshot\s+Boolean\s+@default\(false\)/,
);

for (const fragment of [
  'ADD COLUMN "shopifyPartnerDevelopmentSnapshot" BOOLEAN NOT NULL DEFAULT false',
  'DROP CONSTRAINT IF EXISTS "RecoveryCreditRefund_snapshot_amounts"',
  '"purchaseProviderAmountSnapshot" >= 0',
  '"purchaseProviderAmountSnapshot" > 0',
  '"shopifyPartnerDevelopmentSnapshot" = true',
  '"availableAmountAtRequestSnapshot" > 0',
  '("expectedProviderAmount" IS NULL OR "expectedProviderAmount" >= 0)',
]) {
  assert.ok(
    migration.includes(fragment),
    `Expected partner-development refund migration to contain: ${fragment}`,
  );
}

assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\b/i);
assert.doesNotMatch(
  migration,
  /eugene-|myshopify\.com|34e580f7|344badd8|bronze-top-up-free/i,
);

console.log("ARCH-015 partner-development test refund schema validation passed.");
