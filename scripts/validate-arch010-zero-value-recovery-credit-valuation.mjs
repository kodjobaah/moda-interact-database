import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath =
  "prisma/migrations/20260919171500_arch010_zero_value_recovery_credit_valuation/migration.sql";
const migration = await readFile(migrationPath, "utf8");

assert.match(
  migration,
  /DROP CONSTRAINT IF EXISTS "RecoveryCreditPurchase_confirmed_valuation_complete"/,
);
assert.match(
  migration,
  /ADD CONSTRAINT "RecoveryCreditPurchase_confirmed_valuation_complete"/,
);

for (const condition of [
  '"status" = \'REQUESTED\'',
  '"providerUsageQuantityAfterSnapshot" IS NOT NULL',
  '"providerUsageQuantityAfterSnapshot" > "providerUsageQuantityBeforeSnapshot"',
  '"providerUsageCostAfterSnapshot" IS NOT NULL',
  '"providerUsageCostCurrencyAfterSnapshot" IS NOT NULL',
  '"providerPurchaseAmount" IS NOT NULL',
  '"providerPurchaseAmount" >= 0',
  '"providerPurchaseCurrency" IS NOT NULL',
  '"providerValuationConfirmedAt" IS NOT NULL',
  '"providerPriceSnapshot" IS NOT NULL',
  '"providerUsageCostCurrencyBeforeSnapshot" = "providerUsageCostCurrencyAfterSnapshot"',
  '"providerUsageCostCurrencyAfterSnapshot" = "providerPurchaseCurrency"',
  '"providerUsageCostAfterSnapshot" >= "providerUsageCostBeforeSnapshot"',
  '"providerPurchaseAmount" = "providerUsageCostAfterSnapshot" - "providerUsageCostBeforeSnapshot"',
]) {
  assert.ok(migration.includes(condition), `missing valuation condition ${condition}`);
}

assert.doesNotMatch(migration, /"providerPurchaseAmount"\s*>\s*0/);
assert.doesNotMatch(
  migration,
  /"providerUsageCostAfterSnapshot"\s*>\s*"providerUsageCostBeforeSnapshot"/,
);

// The migration must never depend on seeded/dev/test rows. In particular, it
// must not repair a known purchase by id or use data-migration DML.
assert.doesNotMatch(migration, /34e580f7-4625-4484-b029-a28d7e4a8d40/i);
assert.doesNotMatch(migration, /bronze-top-up-free/i);
assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/im);

console.log("ARCH-010 zero-value recovery-credit valuation migration validation passed.");
