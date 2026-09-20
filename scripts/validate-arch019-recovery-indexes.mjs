import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const schema = read("prisma/schema.prisma");
const sql = read("prisma/migrations/20260920120000_arch019_merchant_recovery_read_indexes/migration.sql");
const contracts = [
  ["commerce", "CheckoutRecovery", ["shopId", "detectedAt", "id"]],
  ["commerce", "CheckoutRecovery", ["shopId", "status", "detectedAt", "id"]],
  ["commerce", "CheckoutRecovery", ["shopId", "customerId", "detectedAt", "id"]],
  ["whatsapp", "ConversationMessage", ["conversationId", "createdAt", "id"]],
];

// Restrict the entire migration grammar, not merely the presence of expected names:
// dropping data/indexes, changing uniqueness or adding a partial predicate must fail.
const statements = sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
assert.equal(statements.length, contracts.length, "exactly four additive indexes required");
for (const [namespace, model, fields] of contracts) {
  const name = `${model}_${fields.join("_")}_idx`;
  const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)^\\}`, "m"))?.[1];
  assert.ok(block, `${model} exists`);
  assert.ok(block.includes(`@@schema("${namespace}")`));
  const indexes = [...block.matchAll(/@@index\(\[([^\]]+)\]\)/g)].map((m) => m[1].replace(/\s/g, ""));
  assert.equal(indexes.filter((i) => i === fields.join(",")).length, 1, `${model}: one equivalent Prisma index`);
  const expected = `CREATE INDEX "${name}" ON "${namespace}"."${model}"(${fields.map((f) => `"${f}"`).join(", ")})`;
  assert.equal(statements.filter((s) => s.replace(/\s+/g, " ") === expected).length, 1, `${name}: exact non-unique, non-partial SQL definition`);
  assert.ok(Buffer.byteLength(name) <= 63, "index name must not be truncated by PostgreSQL");
}

// Existing query/uniqueness contracts must survive this additive change.
for (const [model, retained] of [
  ["CheckoutRecovery", ["@@unique([shopId, checkoutToken, generation])", "@@index([shopId, checkoutToken, generation])", "@@index([status, lastExternalActivityAt])", "@@index([customerId])", "@@index([shopId, admissionBlockReason, status, detectedAt])"]],
  ["ConversationMessage", ["@@index([conversationId, createdAt])", "@@index([inReplyToProviderId])"]],
]) {
  const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)^\\}`, "m"))[1];
  for (const marker of retained) assert.ok(block.includes(marker), `${model}: retain ${marker}`);
}
console.log("ARCH-019: four additive schema/SQL index contracts and existing indexes verified.");
