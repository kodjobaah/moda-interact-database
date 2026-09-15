import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260915140000_arch015_fractional_provider_usage_snapshots/migration.sql",
  "utf8",
);

const model = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[1];
};

const purchase = model("RecoveryCreditPurchase");
assert.match(purchase, /providerUsageQuantityBeforeSnapshot\s+Decimal\n/);
assert.match(purchase, /providerUsageQuantityAfterSnapshot\s+Decimal\?/);
assert.match(purchase, /creditsGranted\s+Int/);
assert.match(purchase, /currentAmount\s+Int/);
assert.match(purchase, /reservedAmount\s+Int/);
assert.match(model("BillingPeriodEntitlementCounter"), /grantedQuantity\s+Int/);
assert.match(model("RecoveryCreditRefund"), /finalCreditQuantity\s+Int\?/);

assert.match(
  migration,
  /ALTER COLUMN "providerUsageQuantityBeforeSnapshot" TYPE DECIMAL\(65, 30\)[\s\S]*USING "providerUsageQuantityBeforeSnapshot"::DECIMAL\(65, 30\)/,
);
assert.match(
  migration,
  /ALTER COLUMN "providerUsageQuantityAfterSnapshot" TYPE DECIMAL\(65, 30\)[\s\S]*USING "providerUsageQuantityAfterSnapshot"::DECIMAL\(65, 30\)/,
);
assert.doesNotMatch(migration, /ALTER COLUMN "creditsGranted"|ALTER COLUMN "currentAmount"|ALTER COLUMN "reservedAmount"/);

console.log("ARCH-015 fractional provider-usage snapshot schema validated");