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
const cadenceMigrationPath = join(
  repositoryRoot,
  "prisma",
  "migrations",
  "20260916110000_arch014_background_runtime_lease_cadence",
  "migration.sql",
);
const erdPath = join(repositoryRoot, "docs", "generated", "prisma-erd.puml");
const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");
const cadenceMigration = readFileSync(cadenceMigrationPath, "utf8");
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
  "lastFinishedAt DateTime?",
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
const requiredCheckExpressions = {
  version: '"version" >= 0',
  billing_reconciliation_interval: '"billingReconciliationIntervalSeconds" BETWEEN 10 AND 3600',
  billing_reconciliation_batch: '"billingReconciliationShopBatchSize" BETWEEN 1 AND 200',
  shopify_usage_publish_batch: '"shopifyUsagePublishBatchSize" BETWEEN 1 AND 200',
  recovery_repair_interval: '"recoveryRepairIntervalSeconds" BETWEEN 30 AND 3600',
  recovery_repair_batch: '"recoveryRepairShopBatchSize" BETWEEN 1 AND 500',
  recovery_resume_batch: '"recoveryResumeBatchSize" BETWEEN 1 AND 100',
  translation_reconciliation_interval: '"translationReconciliationIntervalSeconds" BETWEEN 30 AND 3600',
  translation_batch_requests: '"translationBatchMaxRequests" BETWEEN 1 AND 500',
  conversation_quiet_window: '"conversationQuietWindowMs" BETWEEN 250 AND 10000',
  conversation_settle_window: '"conversationMaxSettleWindowMs" BETWEEN 1000 AND 30000',
  billing_frozen_recheck: '"billingFrozenRecheckSeconds" BETWEEN 300 AND 86400',
  billing_provider_retry: '"billingProviderRetrySeconds" BETWEEN 30 AND 3600',
  shopify_usage_retry_base: '"shopifyUsageRetryBaseSeconds" BETWEEN 10 AND 3600',
  shopify_usage_retry_max: '"shopifyUsageRetryMaxSeconds" BETWEEN 60 AND 86400',
  translation_page_size: '"translationReconciliationPageSize" BETWEEN 1 AND 500',
  translation_claim_timeout: '"translationClaimTimeoutSeconds" BETWEEN 60 AND 86400',
  translation_submit_retry: '"translationSubmitRetrySeconds" BETWEEN 30 AND 86400',
  translation_initial_poll: '"translationInitialPollSeconds" BETWEEN 30 AND 86400',
  translation_poll_interval: '"translationPollIntervalSeconds" BETWEEN 30 AND 86400',
  translation_result_retry: '"translationResultRetrySeconds" BETWEEN 30 AND 86400',
  translation_submit_attempts: '"translationSubmitMaxAttempts" BETWEEN 1 AND 10',
  translation_auto_retries: '"translationMaxAutoRetries" BETWEEN 0 AND 10',
  raw_sender_limit: '"rawSenderLimitPerMinute" BETWEEN 1 AND 10000',
  raw_global_limit: '"rawGlobalLimitPerMinute" BETWEEN 1 AND 1000000',
  turn_sender_minute_limit: '"turnSenderLimitPerMinute" BETWEEN 1 AND 10000',
  turn_sender_ten_minute_limit: '"turnSenderLimitPerTenMinutes" BETWEEN 1 AND 100000',
  turn_conversation_minute_limit: '"turnConversationLimitPerMinute" BETWEEN 1 AND 10000',
  turn_conversation_ten_minute_limit: '"turnConversationLimitPerTenMinutes" BETWEEN 1 AND 100000',
  turn_shop_limit: '"turnShopLimitPerMinute" BETWEEN 1 AND 100000',
  turn_global_limit: '"turnGlobalLimitPerMinute" BETWEEN 1 AND 1000000',
  discovery_sender_minute_limit: '"discoverySenderLimitPerMinute" BETWEEN 1 AND 10000',
  discovery_sender_ten_minute_limit: '"discoverySenderLimitPerTenMinutes" BETWEEN 1 AND 100000',
  discovery_conversation_minute_limit: '"discoveryConversationLimitPerMinute" BETWEEN 1 AND 10000',
  discovery_conversation_ten_minute_limit: '"discoveryConversationLimitPerTenMinutes" BETWEEN 1 AND 100000',
  checkout_queue_concurrency: '"checkoutQueueGlobalConcurrency" BETWEEN 1 AND 100',
  order_queue_concurrency: '"orderQueueGlobalConcurrency" BETWEEN 1 AND 100',
  pending_recovery_queue_concurrency: '"pendingRecoveryQueueGlobalConcurrency" BETWEEN 1 AND 100',
  recovery_resume_queue_concurrency: '"recoveryResumeQueueGlobalConcurrency" BETWEEN 1 AND 100',
  whatsapp_queue_concurrency: '"whatsappQueueGlobalConcurrency" BETWEEN 1 AND 100',
  merchant_communications_queue_concurrency: '"merchantCommunicationsQueueGlobalConcurrency" BETWEEN 1 AND 100',
  billing_subscription_queue_concurrency: '"billingSubscriptionQueueGlobalConcurrency" BETWEEN 1 AND 100',
  settle_window_order: '"conversationMaxSettleWindowMs" >= "conversationQuietWindowMs"',
  shopify_retry_order: '"shopifyUsageRetryMaxSeconds" >= "shopifyUsageRetryBaseSeconds"',
  raw_global_order: '"rawGlobalLimitPerMinute" >= "rawSenderLimitPerMinute"',
  turn_sender_window_order: '"turnSenderLimitPerTenMinutes" >= "turnSenderLimitPerMinute"',
  turn_conversation_window_order: '"turnConversationLimitPerTenMinutes" >= "turnConversationLimitPerMinute"',
  turn_global_order: '"turnGlobalLimitPerMinute" >= "turnShopLimitPerMinute"',
  turn_shop_order: '"turnShopLimitPerMinute" >= "turnSenderLimitPerMinute"',
  discovery_sender_window_order: '"discoverySenderLimitPerTenMinutes" >= "discoverySenderLimitPerMinute"',
  discovery_conversation_window_order: '"discoveryConversationLimitPerTenMinutes" >= "discoveryConversationLimitPerMinute"',
  discovery_sender_minute_cap: '"discoverySenderLimitPerMinute" <= "turnSenderLimitPerMinute"',
  discovery_sender_ten_minute_cap: '"discoverySenderLimitPerTenMinutes" <= "turnSenderLimitPerTenMinutes"',
  discovery_conversation_minute_cap: '"discoveryConversationLimitPerMinute" <= "turnConversationLimitPerMinute"',
  discovery_conversation_ten_minute_cap: '"discoveryConversationLimitPerTenMinutes" <= "turnConversationLimitPerTenMinutes"',
};
for (const [name, expression] of Object.entries(requiredCheckExpressions)) {
  expect(migration.includes(`CONSTRAINT "ck_arch014_background_runtime_config_${name}" CHECK (${expression})`), `CHECK ${name} has an unexpected expression`);
}
expect(migration.includes('CONSTRAINT "BackgroundRuntimeConfig_pkey"'), "config primary key is missing");
expect(migration.includes("INSERT INTO \"public\".\"BackgroundRuntimeConfig\""), "default config seed is missing");
const normalizedMigration = migration.replace(/\s+/g, " ");
expect(
  normalizedMigration.includes('"billingSubscriptionQueueGlobalConcurrency", "updatedAt" ) VALUES'),
  "default config seed does not supply updatedAt",
);
expect(
  normalizedMigration.includes("10, 5, 10, 10, 20, 10, 10, CURRENT_TIMESTAMP ) ON CONFLICT (\"id\") DO NOTHING"),
  "default config seed updatedAt value is not CURRENT_TIMESTAMP",
);
expect(migration.replace(/\s+/g, " ").includes("'default', 0, 60, 50, 50, 300, 100, 25, 300, 100, 3000, 10000, 3600, 300, 60, 3600, 100, 900, 300, 300, 300, 300, 3, 3, 60, 20000, 12, 60, 12, 60, 600, 5000, 4, 12, 4, 12, 10, 5, 10, 10, 20, 10, 10"), "default config seed values are not exact");
expect(migration.includes('ON CONFLICT ("id") DO NOTHING'), "default config seed is not idempotent");
expect(!migration.includes('INSERT INTO "public"."BackgroundRuntimeLease"'), "migration must not seed lease rows");
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
expect(
  cadenceMigration.replace(/\s+/g, " ").trim() ===
    'ALTER TABLE "public"."BackgroundRuntimeLease" ADD COLUMN "lastFinishedAt" TIMESTAMP(3);',
  "cadence migration must contain only the additive lease column change",
);
for (const table of [
  "BackgroundRuntimeConfig",
  "BackgroundRuntimeConfigAuditEvent",
  "BillingPlan",
  "Subscription",
  "UsageEvent",
  "Promotion",
  "PromotionCampaign",
  "PromotionCampaignTranslation",
  "MerchantPricing",
  "MerchantPricingPlan",
  "Support",
  "Shop",
  "WhatsApp",
]) {
  expect(!cadenceMigration.includes(`\"${table}\"`), `cadence migration must not alter ${table}`);
}
expect(!/DEFAULT|NOT NULL|INSERT|UPDATE|CREATE INDEX|CREATE UNIQUE INDEX|SEED|BACKFILL/i.test(cadenceMigration), "cadence migration must not add defaults, backfills, seeds, or indexes");
expect(erd.includes("lastFinishedAt : DateTime"), "ERD is missing BackgroundRuntimeLease.lastFinishedAt");

const baseline = execFileSync("git", ["show", "HEAD:prisma/schema.prisma"], { cwd: repositoryRoot, encoding: "utf8" });
for (const match of baseline.matchAll(/\b(model|enum)\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, kind, name, originalBlock] = match;
  const currentBlock = block(schema, kind, name);
  const comparableBlock = name === "BackgroundRuntimeLease"
    ? currentBlock.replace(/\n\s*lastFinishedAt DateTime\?\s*/, "\n")
    : currentBlock;
  expect(normalizeSchema(comparableBlock) === normalizeSchema(originalBlock), `pre-existing ${kind} ${name} changed`);
}

const changedFiles = execFileSync("git", ["status", "--short"], { cwd: repositoryRoot, encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.slice(3));
const allowedFiles = new Set([
  "prisma/schema.prisma",
  "prisma/migrations/20260916000000_arch014_background_runtime_config_and_leases/migration.sql",
  "prisma/migrations/20260916110000_arch014_background_runtime_lease_cadence/migration.sql",
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