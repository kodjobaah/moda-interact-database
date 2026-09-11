import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient, Prisma } from "@prisma/client";

const schema = await readFile("prisma/schema.prisma", "utf8");
const migration = await readFile(
  "prisma/migrations/20260911020000_add_recovery_admission_block_state/migration.sql",
  "utf8",
);

const recoveryModel = schema.match(/model CheckoutRecovery\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
const statusBlock = schema.match(/enum CheckoutRecoveryStatus\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
const expectedStatuses = ["DETECTED", "MESSAGE_SENT", "ENGAGED", "COMPLETED", "EXPIRED", "CANCELLED"];
const statusValues = [...statusBlock.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*$/gm)].map((match) => match[1]);

assert.match(schema, /enum RecoveryAdmissionBlockReason\s*\{\s*RECOVERY_CAPACITY_EXHAUSTED/);
assert.match(recoveryModel, /admissionBlockedAt\s+DateTime\?/);
assert.match(recoveryModel, /admissionBlockReason\s+RecoveryAdmissionBlockReason\?/);
assert.match(recoveryModel, /@@index\(\[shopId, admissionBlockReason, status, detectedAt\]\)/);
assert.deepEqual(statusValues, expectedStatuses);

assert.match(migration, /CREATE TYPE "commerce"\."RecoveryAdmissionBlockReason" AS ENUM \('RECOVERY_CAPACITY_EXHAUSTED'\)/);
assert.match(migration, /ADD COLUMN "admissionBlockedAt" TIMESTAMP\(3\)/);
assert.match(migration, /ADD COLUMN "admissionBlockReason" "commerce"\."RecoveryAdmissionBlockReason"/);
assert.match(migration, /CREATE INDEX "CheckoutRecovery_shopId_admissionBlockReason_status_detectedAt_idx"/);
assert.match(
  migration,
  /ADD CONSTRAINT "CheckoutRecovery_admission_block_pair"[\s\S]*\("admissionBlockedAt" IS NULL AND "admissionBlockReason" IS NULL\)[\s\S]*\("admissionBlockedAt" IS NOT NULL AND "admissionBlockReason" IS NOT NULL\)/,
);

const generatedRecovery = Prisma.dmmf.datamodel.models.find(({ name }) => name === "CheckoutRecovery");
const generatedReason = Prisma.dmmf.datamodel.enums.find(({ name }) => name === "RecoveryAdmissionBlockReason");
const generatedFields = new Map(generatedRecovery?.fields.map((field) => [field.name, field]));
assert.equal(generatedReason?.values.some(({ name }) => name === "RECOVERY_CAPACITY_EXHAUSTED"), true);
assert.equal(generatedFields.get("admissionBlockedAt")?.type, "DateTime");
assert.equal(generatedFields.get("admissionBlockedAt")?.isRequired, false);
assert.equal(generatedFields.get("admissionBlockReason")?.type, "RecoveryAdmissionBlockReason");
assert.equal(generatedFields.get("admissionBlockReason")?.isRequired, false);

if (process.env.DATABASE_URL) {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`
        CREATE TEMP TABLE "CheckoutRecoveryCapacityValidation" (
          "status" TEXT NOT NULL DEFAULT 'DETECTED',
          "admissionBlockedAt" TIMESTAMP(3),
          "admissionBlockReason" TEXT,
          CONSTRAINT "CheckoutRecoveryCapacityValidation_pair" CHECK (
            ("admissionBlockedAt" IS NULL AND "admissionBlockReason" IS NULL)
            OR ("admissionBlockedAt" IS NOT NULL AND "admissionBlockReason" IS NOT NULL)
          )
        ) ON COMMIT DROP
      `);

      await transaction.$executeRawUnsafe(
        `INSERT INTO "CheckoutRecoveryCapacityValidation" ("status") VALUES ('DETECTED')`,
      );
      await transaction.$executeRawUnsafe(
        `INSERT INTO "CheckoutRecoveryCapacityValidation" ("status", "admissionBlockedAt", "admissionBlockReason") VALUES ('DETECTED', NOW(), 'RECOVERY_CAPACITY_EXHAUSTED')`,
      );
      await transaction.$executeRawUnsafe("SAVEPOINT invalid_reason_without_timestamp");
      await assert.rejects(
        transaction.$executeRawUnsafe(
          `INSERT INTO "CheckoutRecoveryCapacityValidation" ("admissionBlockReason") VALUES ('RECOVERY_CAPACITY_EXHAUSTED')`,
        ),
      );
      await transaction.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_reason_without_timestamp");
      await transaction.$executeRawUnsafe("SAVEPOINT invalid_timestamp_without_reason");
      await assert.rejects(
        transaction.$executeRawUnsafe(
          `INSERT INTO "CheckoutRecoveryCapacityValidation" ("admissionBlockedAt") VALUES (NOW())`,
        ),
      );
      await transaction.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_timestamp_without_reason");
      await transaction.$executeRawUnsafe(
        `UPDATE "CheckoutRecoveryCapacityValidation" SET "admissionBlockedAt" = NULL, "admissionBlockReason" = NULL WHERE "admissionBlockReason" = 'RECOVERY_CAPACITY_EXHAUSTED'`,
      );
    });
  } finally {
    await prisma.$disconnect();
  }
} else {
  console.warn("DATABASE_URL is not set; skipped live CHECK constraint assertions.");
}

console.log("Checkout recovery capacity schema assertions passed.");