import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260916083000_arch015_refund_correction_evidence/migration.sql",
  "utf8",
);

const model = (name) => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[1];
};

const refund = model("RecoveryCreditRefund");
const usageEvent = model("UsageEvent");
const requiredRefundFields = [
  ["automaticCorrectionUsageEventId", "String?"],
  ["providerUsageQuantityBeforeCorrection", "Decimal?"],
  ["providerUsageCostBeforeCorrection", "Decimal?"],
  ["expectedProviderUsageQuantityAfterCorrection", "Decimal?"],
  ["expectedProviderUsageCostAfterCorrection", "Decimal?"],
];

for (const [name, type] of requiredRefundFields) {
  assert.match(refund, new RegExp(`\\b${name}\\s+${type.replace("?", "\\?")}(?=\\s|$)`));
}
assert.match(refund, /automaticCorrectionUsageEventId\s+String\?\s+@unique/);
assert.match(
  refund,
  /automaticCorrectionUsageEvent\s+UsageEvent\?\s+@relation\("RecoveryCreditRefundAutomaticCorrection", fields: \[automaticCorrectionUsageEventId\], references: \[id\], onDelete: Restrict\)/,
);
assert.match(
  usageEvent,
  /automaticRecoveryCreditRefund\s+RecoveryCreditRefund\?\s+@relation\("RecoveryCreditRefundAutomaticCorrection"\)/,
);
assert.match(usageEvent, /quantity\s+Decimal/);
assert.doesNotMatch(usageEvent, /metadata\s+Json/);
for (const field of [
  "billingPeriodIdSnapshot",
  "providerSubscriptionIdSnapshot",
  "planHandleSnapshot",
  "eventHandleSnapshot",
  "purchaseProviderAmountSnapshot",
  "purchaseProviderCurrencySnapshot",
]) {
  assert.match(refund, new RegExp(`\\b${field}\\s+`));
}
assert.match(refund, /finalCreditQuantity\s+Int\?/);
assert.match(refund, /expectedProviderAmount\s+Decimal\?/);
assert.match(refund, /expectedProviderCurrency\s+String\?/);
for (const field of [
  "providerUsageQuantityBeforeCorrection",
  "providerUsageCostBeforeCorrection",
  "expectedProviderUsageQuantityAfterCorrection",
  "expectedProviderUsageCostAfterCorrection",
  "automaticCorrectionUsageEventId",
]) {
  assert.doesNotMatch(usageEvent, new RegExp(`\\b${field}\\b`));
}
assert.doesNotMatch(schema, /providerUsageQuantityBeforeCorrectionSnapshot|expectedProviderUsageQuantityAfterCorrectionSnapshot/);

assert.match(migration, /ADD COLUMN "automaticCorrectionUsageEventId" TEXT/);
for (const [name] of requiredRefundFields.slice(1)) {
  assert.match(migration, new RegExp(`ADD COLUMN "${name}" DECIMAL\\(65,30\\)`));
}
assert.match(migration, /CREATE UNIQUE INDEX "RecoveryCreditRefund_automaticCorrectionUsageEventId_key"/);
assert.match(
  migration,
  /FOREIGN KEY \("automaticCorrectionUsageEventId"\) REFERENCES "billing"\."UsageEvent"\("id"\)\s+ON DELETE RESTRICT/,
);
assert.match(migration, /ck_arch015_refund_automatic_correction_evidence_group/);
assert.match(migration, /ck_arch015_refund_automatic_correction_nonnegative/);
assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT)\s/im);

const evidenceFields = [
  "automaticCorrectionUsageEventId",
  "providerUsageQuantityBeforeCorrection",
  "providerUsageCostBeforeCorrection",
  "expectedProviderUsageQuantityAfterCorrection",
  "expectedProviderUsageCostAfterCorrection",
];
const automaticFields = [...evidenceFields, "finalCreditQuantity", "expectedProviderAmount", "expectedProviderCurrency"];
const evidenceGroupValid = (row) => {
  const allNull = evidenceFields.every((field) => row[field] == null);
  const allPresent = automaticFields.every((field) => row[field] != null);
  return allNull || allPresent;
};
const automaticNumbersValid = (row) =>
  row.automaticCorrectionUsageEventId == null ||
  (row.providerUsageQuantityBeforeCorrection >= 0 &&
    row.providerUsageCostBeforeCorrection >= 0 &&
    row.expectedProviderUsageQuantityAfterCorrection >= 0 &&
    row.expectedProviderUsageCostAfterCorrection >= 0 &&
    row.finalCreditQuantity > 0 &&
    row.expectedProviderAmount >= 0);

const manualFallback = {
  automaticCorrectionUsageEventId: null,
  providerUsageQuantityBeforeCorrection: null,
  providerUsageCostBeforeCorrection: null,
  expectedProviderUsageQuantityAfterCorrection: null,
  expectedProviderUsageCostAfterCorrection: null,
  finalCreditQuantity: 3,
  expectedProviderAmount: 17.5,
  expectedProviderCurrency: "USD",
};
const completeAutomatic = {
  ...manualFallback,
  automaticCorrectionUsageEventId: "usage-event-id",
  providerUsageQuantityBeforeCorrection: 4,
  providerUsageCostBeforeCorrection: 20,
  expectedProviderUsageQuantityAfterCorrection: 0.25,
  expectedProviderUsageCostAfterCorrection: 1.25,
};

assert.equal(evidenceGroupValid({ ...manualFallback, finalCreditQuantity: null, expectedProviderAmount: null, expectedProviderCurrency: null }), true);
assert.equal(evidenceGroupValid(completeAutomatic), true);
assert.equal(evidenceGroupValid({ ...completeAutomatic, providerUsageCostBeforeCorrection: null }), false);
assert.equal(automaticNumbersValid({ ...completeAutomatic, providerUsageCostBeforeCorrection: -1 }), false);
assert.equal(automaticNumbersValid({ ...completeAutomatic, finalCreditQuantity: 0 }), false);
assert.equal(automaticNumbersValid(manualFallback), true);

console.log("ARCH-015 refund correction evidence schema validated");