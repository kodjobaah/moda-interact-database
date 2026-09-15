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
  "20260916000000_arch014_background_runtime_config_and_leases",
  "migration.sql",
);
const erdPath = join(repositoryRoot, "docs", "generated", "prisma-erd.puml");
const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");
const erd = readFileSync(erdPath, "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const block = (source, kind, name) =>
  source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const normalize = (value) => value.replace(/\s+/g, " ").trim();
const normalizeSchema = (value) => normalize(value).replace(/\s*([:[\],()])\s*/g, "$1");
const containsNormalized = (source, requirement) => normalizeSchema(source).includes(normalizeSchema(requirement));

const configFields = {
  id: 'String @id @default("default")',
  version: "Int @default(0)",
  billingReconciliationIntervalSeconds: "Int @default(60)",
  billingReconciliationShopBatchSize: "Int @default(50)",
  shopifyUsagePublishBatchSize: "Int @default(50)",
  recoveryRepairIntervalSeconds: "Int @default(300)",
  recoveryRepairShopBatchSize: "Int @default(100)",
  recoveryResumeBatchSize: "Int @default(25)",
  translationReconciliationIntervalSeconds: "Int @default(300)",
  translationBatchMaxRequests: "Int @default(100)",
  conversationQuietWindowMs: "Int @default(3000)",
  conversationMaxSettleWindowMs: "Int @default(10000)",
  billingFrozenRecheckSeconds: "Int @default(3600)",
  billingProviderRetrySeconds: "Int @default(300)",
  shopifyUsageRetryBaseSeconds: "Int @default(60)",
  shopifyUsageRetryMaxSeconds: "Int @default(3600)",
  translationReconciliationPageSize: "Int @default(100)",
  translationClaimTimeoutSeconds: "Int @default(900)",
  translationSubmitRetrySeconds: "Int @default(300)",
  translationInitialPollSeconds: "Int @default(300)",
  translationPollIntervalSeconds: "Int @default(300)",
  translationResultRetrySeconds: "Int @default(300)",
  translationSubmitMaxAttempts: "Int @default(3)",
  translationMaxAutoRetries: "Int @default(3)",
  rawSenderLimitPerMinute: "Int @default(60)",
  rawGlobalLimitPerMinute: "Int @default(20000)",
  turnSenderLimitPerMinute: "Int @default(12)",
  turnSenderLimitPerTenMinutes: "Int @default(60)",
  turnConversationLimitPerMinute: "Int @default(12)",
  turnConversationLimitPerTenMinutes: "Int @default(60)",
  turnShopLimitPerMinute: "Int @default(600)",
  turnGlobalLimitPerMinute: "Int @default(5000)",
  discoverySenderLimitPerMinute: "Int @default(4)",
  discoverySenderLimitPerTenMinutes: "Int @default(12)",
  discoveryConversationLimitPerMinute: "Int @default(4)",
  discoveryConversationLimitPerTenMinutes: "Int @default(12)",
  checkoutQueueGlobalConcurrency: "Int @default(10)",
  orderQueueGlobalConcurrency: "Int @default(5)",
  pendingRecoveryQueueGlobalConcurrency: "Int @default(10)",
  recoveryResumeQueueGlobalConcurrency: "Int @default(10)",
  whatsappQueueGlobalConcurrency: "Int @default(20)",
  merchantCommunicationsQueueGlobalConcurrency: "Int @default(10)",
  billingSubscriptionQueueGlobalConcurrency: "Int @default(10)",
  createdAt: "DateTime @default(now())",
  updatedAt: "DateTime @updatedAt",
};

const configModel = block(schema, "model", "BackgroundRuntimeConfig");
expect(configModel, "BackgroundRuntimeConfig model is missing");
for (const [field, definition] of Object.entries(configFields)) {
  expect(
    configModel.split("\n").some((line) => normalize(line) === `${field} ${definition}`),
    `BackgroundRuntimeConfig field ${field} does not have the exact type/default`,
  );
}
expect(configModel.includes("auditEvents BackgroundRuntimeConfigAuditEvent[]"), "config audit relation is missing");
expect(configModel.includes('@@schema("public")'), "config model is not in public schema");

const auditModel = block(schema, "model", "BackgroundRuntimeConfigAuditEvent");
const leaseModel = block(schema, "model", "BackgroundRuntimeLease");
expect(auditModel, "BackgroundRuntimeConfigAuditEvent model is missing");
expect(leaseModel, "BackgroundRuntimeLease model is missing");
for (const requirement of [
  "id String @id @default(cuid())",
  "configId String",
  "config   BackgroundRuntimeConfig @relation(fields: [configId], references: [id], onDelete: Restrict)",
  "section          BackgroundRuntimeConfigSection",
  "expectedVersion  Int",
  "resultingVersion Int",
  "platformAdminId String",
  "reason          String @db.VarChar(1000)",
  "beforeValue Json",
  "afterValue  Json",
  "createdAt DateTime @default(now())",
  "@@index([configId, createdAt])",
  "@@index([platformAdminId, createdAt])",
  '@@schema("public")',
]) expect(containsNormalized(auditModel, requirement), `audit model missing ${requirement}`);
for (const requirement of [
  "name BackgroundRuntimeLeaseName @id",
  "ownerToken String",
  "generation Int @default(0)",
  "acquiredAt  DateTime",
  "heartbeatAt DateTime",
  "leaseUntil  DateTime",
  "updatedAt   DateTime @updatedAt",
  "@@index([leaseUntil])",
  '@@schema("public")',
]) expect(containsNormalized(leaseModel, requirement), `lease model missing ${requirement}`);

expect(
  normalize(block(schema, "enum", "BackgroundRuntimeConfigSection")) ===
    "OPERATIONAL ADVANCED ABUSE_PROTECTION WORKER_THROUGHPUT @@schema(\"public\")",
  "BackgroundRuntimeConfigSection enum values are not exact",
);
expect(
  normalize(block(schema, "enum", "BackgroundRuntimeLeaseName")) ===
    "BILLING_RECONCILIATION RECOVERY_CAPACITY_REPAIR TRANSLATION_RECONCILIATION QUEUE_CONCURRENCY_RECONCILIATION @@schema(\"public\")",
  "BackgroundRuntimeLeaseName enum values are not exact",
);

const checkNames = [
  "version", "billing_reconciliation_interval", "billing_reconciliation_batch", "shopify_usage_publish_batch",
  "recovery_repair_interval", "recovery_repair_batch", "recovery_resume_batch", "translation_reconciliation_interval",
  "translation_batch_requests", "conversation_quiet_window", "conversation_settle_window", "billing_frozen_recheck",
  "billing_provider_retry", "shopify_usage_retry_base", "shopify_usage_retry_max", "translation_page_size",
  "translation_claim_timeout", "translation_submit_retry", "translation_initial_poll", "translation_poll_interval",
  "translation_result_retry", "translation_submit_attempts", "translation_auto_retries", "raw_sender_limit",
  "raw_global_limit", "turn_sender_minute_limit", "turn_sender_ten_minute_limit", "turn_conversation_minute_limit",
  "turn_conversation_ten_minute_limit", "turn_shop_limit", "turn_global_limit", "discovery_sender_minute_limit",
  "discovery_sender_ten_minute_limit", "discovery_conversation_minute_limit", "discovery_conversation_ten_minute_limit",
  "checkout_queue_concurrency", "order_queue_concurrency", "pending_recovery_queue_concurrency",
  "recovery_resume_queue_concurrency", "whatsapp_queue_concurrency", "merchant_communications_queue_concurrency",
  "billing_subscription_queue_concurrency", "settle_window_order", "shopify_retry_order", "raw_global_order",
  "turn_sender_window_order", "turn_conversation_window_order", "turn_global_order", "turn_shop_order",
  "discovery_sender_window_order", "discovery_conversation_window_order", "discovery_sender_minute_cap",
  "discovery_sender_ten_minute_cap", "discovery_conversation_minute_cap", "discovery_conversation_ten_minute_cap",
];
for (const name of checkNames) expect(migration.includes(`CONSTRAINT "ck_arch014_background_runtime_config_${name}" CHECK`), `missing named CHECK ${name}`);
expect(migration.includes('CONSTRAINT "BackgroundRuntimeConfig_pkey"'), "config primary key is missing");
expect(migration.includes("INSERT INTO \"public\".\"BackgroundRuntimeConfig\""), "default config seed is missing");
expect(migration.includes("'default', 0, 60, 50, 50, 300, 100, 25"), "default config seed values are not exact");
expect(migration.includes('ON CONFLICT ("id") DO NOTHING'), "default config seed is not idempotent");
expect(!/ALTER TABLE\s+"(?:public|shopify|commerce|whatsapp|billing|support)"/i.test(migration), "migration alters a pre-existing table");
expect(!migration.includes('"PlatformAdmin"'), "migration must not alter or reference PlatformAdmin");
for (const field of Object.keys(configFields).filter((field) => field.endsWith("QueueGlobalConcurrency"))) {
  expect(migration.includes(`"${field}" INTEGER`), `queue concurrency field ${field} is missing from migration`);
}
expect(configModel.includes("translationResultRetrySeconds") && configModel.includes("translationPollIntervalSeconds"), "translation retry/poll fields are missing");
expect(configModel.indexOf("translationResultRetrySeconds") !== configModel.indexOf("translationPollIntervalSeconds"), "translation retry/poll fields are not distinct");
for (const model of ["BackgroundRuntimeConfig", "BackgroundRuntimeConfigAuditEvent", "BackgroundRuntimeLease"]) {
  expect(erd.includes(`entity \"${model}\"`), `ERD is missing ${model}`);
}

const baseline = execFileSync("git", ["show", "HEAD:prisma/schema.prisma"], { cwd: repositoryRoot, encoding: "utf8" });
for (const match of baseline.matchAll(/\b(model|enum)\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, kind, name, originalBlock] = match;
  expect(normalizeSchema(block(schema, kind, name)) === normalizeSchema(originalBlock), `pre-existing ${kind} ${name} changed`);
}

const changedFiles = execFileSync("git", ["status", "--short"], { cwd: repositoryRoot, encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.slice(3));
const allowedFiles = new Set([
  "prisma/schema.prisma",
  "prisma/migrations/20260916000000_arch014_background_runtime_config_and_leases/migration.sql",
  "scripts/validate-arch014-background-runtime-config.mjs",
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
console.log("ARCH-014 background runtime config static validation passed.");