import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260911130000_add_purchased_credit_lot_accounting/migration.sql",
  "utf8",
);

const model = (name) => schema.match(new RegExp(`model ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
const enumBlock = (name) => schema.match(new RegExp(`enum ${name}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
const purchase = model("RecoveryCreditPurchase");
const reservation = model("UsageReservation");
const refund = model("RecoveryCreditRefund");

for (const field of [
  "committedQuantity\\s+Int\\s+@default\\(0\\)",
  "reservedQuantity\\s+Int\\s+@default\\(0\\)",
  "refundingQuantity\\s+Int\\s+@default\\(0\\)",
  "refundedQuantity\\s+Int\\s+@default\\(0\\)",
  "version\\s+Int\\s+@default\\(0\\)",
]) {
  assert.match(purchase, new RegExp(field));
}
assert.doesNotMatch(purchase, /availableQuantity/);
assert.match(purchase, /refunds\s+RecoveryCreditRefund\[\]/);
assert.match(purchase, /purchasedReservations\s+UsageReservation\[\]/);
assert.match(reservation, /purchasedCreditPurchaseId\s+String\?/);
assert.match(reservation, /purchasedCreditPurchase\s+RecoveryCreditPurchase\?/);
assert.match(reservation, /@@index\(\[purchasedCreditPurchaseId, status\]\)/);
assert.doesNotMatch(refund, /purchaseId\s+String\s+@unique/);
for (const field of ["purchaseCreditsGrantedSnapshot", "creditsRequested", "creditsApproved", "creditsRefunded", "providerActionKind", "providerReference", "providerAmount", "providerCurrency", "providerConfirmedAt"]) {
  assert.match(refund, new RegExp(`\\b${field}\\b`));
}
assert.match(enumBlock("RecoveryCreditProviderActionKind"), /REFUND[\s\S]*CREDIT/);

for (const fragment of [
  'CREATE TYPE "billing"."RecoveryCreditProviderActionKind" AS ENUM',
  'DROP INDEX "billing"."RecoveryCreditRefund_purchaseId_key"',
  'CREATE TEMP TABLE "_purchased_credit_lots"',
  'activatedAt" ASC NULLS LAST',
  'createdAt" ASC, purchase.id ASC',
  'reservation."createdAt" ASC, reservation.id ASC',
  "Cannot deterministically allocate purchased-credit reservation",
  "Cannot reconcile purchased-credit aggregate",
  'RecoveryCreditPurchase_lot_quantities_non_negative',
  'RecoveryCreditPurchase_lot_quantities_within_grant',
  'RecoveryCreditRefund_quantities_positive',
  'RecoveryCreditRefund_purchaseId_status_createdAt_idx',
  'UsageReservation_purchasedCreditPurchaseId_status_idx',
  'purchasedCreditPurchaseId") REFERENCES "billing"."RecoveryCreditPurchase"',
]) {
  assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(migration, /status = 'COMMITTED'|status = 'COMMITTED'/);
assert.match(migration, /status IN \('RESERVED', 'AMBIGUOUS'\)/);
assert.match(migration, /status = 'RELEASED'/);
assert.match(migration, /status.*IN \('ACTIVE', 'REFUNDED'\)/);
assert.match(migration, /creditsGranted.*refundedQuantity.*refundingQuantity/);
assert.match(migration, /\."status"::text NOT IN \('REJECTED', 'WITHDRAWN', 'COMPLETED'\)/);
assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|BillingPeriod/);
assert.doesNotMatch(migration, /availableQuantity/);
assert.doesNotMatch(migration, /UPDATE\s+"billing"\."ShopEntitlementCounter"/);

const generatedPurchase = Prisma.dmmf.datamodel.models.find(({ name }) => name === "RecoveryCreditPurchase");
const generatedReservation = Prisma.dmmf.datamodel.models.find(({ name }) => name === "UsageReservation");
assert.ok(generatedPurchase?.fields.some(({ name, type, isRequired }) => name === "committedQuantity" && type === "Int" && isRequired));
assert.ok(generatedPurchase?.fields.some(({ name }) => name === "refunds"));
assert.ok(generatedReservation?.fields.some(({ name }) => name === "purchasedCreditPurchase"));

const allocateFifo = (purchases, reservations) => {
  const remaining = purchases
    .filter(({ status }) => ["ACTIVE", "REFUNDED"].includes(status))
    .map((purchase) => ({
      ...purchase,
      remaining: purchase.creditsGranted - purchase.refundedQuantity - purchase.refundingQuantity,
    }));
  return reservations.map((reservation) => {
    const lot = remaining.find((candidate) => candidate.remaining > 0);
    if (!lot) throw new Error("ambiguous allocation");
    if (lot.remaining < reservation.quantity) throw new Error("ambiguous allocation");
    if (reservation.status !== "RELEASED") lot.remaining -= reservation.quantity;
    return { ...reservation, purchaseId: lot.id };
  });
};
const fixture = allocateFifo(
  [
    { id: "purchase-a", status: "ACTIVE", creditsGranted: 8, refundedQuantity: 2, refundingQuantity: 1 },
    { id: "purchase-b", status: "ACTIVE", creditsGranted: 8, refundedQuantity: 0, refundingQuantity: 0 },
    { id: "purchase-needs-attention", status: "NEEDS_ATTENTION", creditsGranted: 20, refundedQuantity: 0, refundingQuantity: 0 },
  ],
  [
    { id: "reservation-released", quantity: 2, status: "RELEASED" },
    { id: "reservation-a", quantity: 2, status: "COMMITTED" },
    { id: "reservation-b", quantity: 3, status: "RESERVED" },
  ],
);
assert.deepEqual(fixture.map(({ purchaseId }) => purchaseId), ["purchase-a", "purchase-a", "purchase-a"]);
assert.equal(fixture.filter(({ status }) => status === "COMMITTED").reduce((sum, row) => sum + row.quantity, 0), 2);
assert.equal(fixture.filter(({ status }) => status === "RESERVED").reduce((sum, row) => sum + row.quantity, 0), 3);
assert.equal(fixture.filter(({ status }) => status === "RELEASED").reduce((sum, row) => sum + row.quantity, 0), 2);
assert.throws(() => allocateFifo([{ id: "purchase-a", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 0, refundingQuantity: 0 }], [{ id: "reservation-a", quantity: 6, status: "RESERVED" }]), /ambiguous allocation/);
assert.throws(() => allocateFifo([{ id: "purchase-a", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 4, refundingQuantity: 1 }], [{ id: "reservation-a", quantity: 1, status: "RESERVED" }]), /ambiguous allocation/);
assert.throws(() => allocateFifo([
  { id: "purchase-a", status: "ACTIVE", creditsGranted: 2, refundedQuantity: 0, refundingQuantity: 0 },
  { id: "purchase-b", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 0, refundingQuantity: 0 },
], [{ id: "reservation-a", quantity: 3, status: "RESERVED" }]), /ambiguous allocation/);
assert.throws(() => allocateFifo([
  { id: "purchase-needs-attention", status: "NEEDS_ATTENTION", creditsGranted: 20, refundedQuantity: 0, refundingQuantity: 0 },
], [{ id: "reservation-a", quantity: 1, status: "RESERVED" }]), /ambiguous allocation/);
assert.equal(allocateFifo([
  { id: "purchase-refunded", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 5, refundingQuantity: 0 },
  { id: "purchase-later", status: "ACTIVE", creditsGranted: 3, refundedQuantity: 0, refundingQuantity: 0 },
], [{ id: "reservation-a", quantity: 3, status: "COMMITTED" }])[0].purchaseId, "purchase-later");
assert.throws(() => allocateFifo([
  { id: "purchase-partially-reduced", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 3, refundingQuantity: 0 },
  { id: "purchase-later", status: "ACTIVE", creditsGranted: 5, refundedQuantity: 0, refundingQuantity: 0 },
], [{ id: "reservation-a", quantity: 3, status: "COMMITTED" }]), /ambiguous allocation/);

const legacyRefunds = [
  { status: "COMPLETED", creditsSnapshot: 5, holdAppliedAt: "2026-01-01" },
  { status: "PROVIDER_PENDING", creditsSnapshot: 2, holdAppliedAt: "2026-01-02" },
  { status: "REJECTED", creditsSnapshot: 7, holdAppliedAt: "2026-01-03" },
  { status: "WITHDRAWN", creditsSnapshot: 9, holdAppliedAt: "2026-01-04" },
];
assert.equal(legacyRefunds.filter(({ status }) => status === "COMPLETED").reduce((sum, row) => sum + row.creditsSnapshot, 0), 5);
assert.equal(legacyRefunds.filter(({ status, holdAppliedAt }) => holdAppliedAt && !["REJECTED", "WITHDRAWN", "COMPLETED"].includes(status)).reduce((sum, row) => sum + row.creditsSnapshot, 0), 2);

const reconcileAggregate = (purchases, aggregate) => {
  const reconstructed = purchases.reduce((totals, purchase) => ({
    granted: totals.granted + purchase.creditsGranted - purchase.refundedQuantity,
    committed: totals.committed + purchase.committedQuantity,
    reserved: totals.reserved + purchase.reservedQuantity,
    refunding: totals.refunding + purchase.refundingQuantity,
  }), { granted: 0, committed: 0, reserved: 0, refunding: 0 });
  assert.deepEqual(reconstructed, aggregate);
};
reconcileAggregate([
  { creditsGranted: 8, refundedQuantity: 2, committedQuantity: 2, reservedQuantity: 3, refundingQuantity: 1 },
], { granted: 6, committed: 2, reserved: 3, refunding: 1 });
assert.throws(() => reconcileAggregate([
  { creditsGranted: 8, refundedQuantity: 2, committedQuantity: 2, reservedQuantity: 3, refundingQuantity: 1 },
], { granted: 8, committed: 2, reserved: 3, refunding: 1 }), assert.AssertionError);

console.log("Purchased credit lot schema assertions passed.");