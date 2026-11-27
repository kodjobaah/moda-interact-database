import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
assert.ok(
  args.length === 2 &&
    args[0] === "--mode" &&
    ["fresh", "upgrade"].includes(args[1]),
  "Usage: --mode fresh|upgrade",
);
const mode = args[1];
const target = "20261122023000_arch078_unmapped_shopify_usage_event_handles";
const migrationsDirectory = new URL("../prisma/migrations/", import.meta.url);
const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  `../prisma/migrations/${target}/migration.sql`,
  import.meta.url,
);
const container = `moda-arch078-unmapped-usage-events-${randomUUID()}`;
const database = "arch078_unmapped_usage_events_fixture";
const subscriptionId = "arch078-existing-subscription";
const newSubscriptionId = "arch078-new-subscription";
let started = false;

function docker(command, options = {}) {
  try {
    return execFileSync("docker", command, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Docker command failed: ${detail}`, { cause: error });
  }
}

function sql(statement, capture = false) {
  return docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      ...(capture ? ["-A", "-t"] : []),
      "-U",
      "postgres",
      "-d",
      database,
    ],
    { input: statement },
  ).trim();
}

function scalar(statement) {
  return sql(statement, true).split("\n").at(-1)?.trim() ?? "";
}

function jsonQuery(statement) {
  return JSON.parse(scalar(statement));
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      docker(
        ["exec", container, "pg_isready", "-U", "postgres", "-d", database],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(
    "Invocation-owned PostgreSQL container did not become ready.",
  );
}

function migrationNames() {
  return readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
}

function applyMigration(name) {
  const source = readFileSync(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    "utf8",
  );
  sql(source);
  console.log(`APPLIED ${name} sha256=${sha(source)}`);
}

function seedSubscription(id, shopId, domain, withExistingSyncError) {
  const errorCode = withExistingSyncError ? "'LEGACY_PROVIDER_ERROR'" : "NULL";
  const errorAt = withExistingSyncError ? "'2026-11-21T12:00:00.000Z'" : "NULL";
  sql(`
    INSERT INTO commerce."Shop" ("id", "domain", "updatedAt")
    VALUES (${quote(shopId)}, ${quote(domain)}, CURRENT_TIMESTAMP);

    INSERT INTO billing."Subscription" (
      "id", "shopId", "status", "observedShopifyPlanHandle",
      "lastSyncErrorCode", "lastSyncErrorAt", "createdAt", "updatedAt"
    ) VALUES (
      ${quote(id)}, ${quote(shopId)}, 'ACTIVE', 'starter',
      ${errorCode}, ${errorAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);
}

function subscriptionCore(id) {
  return jsonQuery(`
    SELECT jsonb_build_object(
      'id', "id",
      'shopId', "shopId",
      'status', "status"::text,
      'observedShopifyPlanHandle', "observedShopifyPlanHandle",
      'lastSyncErrorCode', "lastSyncErrorCode",
      'lastSyncErrorAt', "lastSyncErrorAt"
    )::text
    FROM billing."Subscription"
    WHERE "id" = ${quote(id)};
  `);
}

function subscriptionArray(id) {
  return jsonQuery(`
    SELECT to_json("unmappedShopifyUsageEventHandles")::text
    FROM billing."Subscription"
    WHERE "id" = ${quote(id)};
  `);
}

function subscriptionStructureCounts() {
  return jsonQuery(`
    SELECT jsonb_build_object(
      'indexes', (
        SELECT count(*)::int FROM pg_indexes
        WHERE schemaname = 'billing' AND tablename = 'Subscription'
      ),
      'constraints', (
        SELECT count(*)::int FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'billing' AND t.relname = 'Subscription'
      ),
      'triggers', (
        SELECT count(*)::int FROM pg_trigger g
        JOIN pg_class t ON t.oid = g.tgrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'billing' AND t.relname = 'Subscription'
          AND NOT g.tgisinternal
      )
    )::text;
  `);
}

function assertColumnMetadata() {
  const metadata = jsonQuery(`
    SELECT jsonb_build_object(
      'dataType', "data_type",
      'udtName', "udt_name",
      'nullable', "is_nullable",
      'defaultValue', "column_default"
    )::text
    FROM information_schema.columns
    WHERE table_schema = 'billing'
      AND table_name = 'Subscription'
      AND column_name = 'unmappedShopifyUsageEventHandles';
  `);

  assert.equal(metadata.dataType, "ARRAY");
  assert.equal(metadata.udtName, "_text");
  assert.equal(metadata.nullable, "NO");
  assert.match(metadata.defaultValue ?? "", /ARRAY\[\]::text\[\]/i);
  console.log(
    "PASS Subscription array column is TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
  );
}

function assertSchemaAndMigrationContract() {
  const schema = readFileSync(schemaPath, "utf8");
  const subscriptionModel = schema.match(
    /model Subscription\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(subscriptionModel, "Prisma Subscription model must exist.");
  assert.match(
    subscriptionModel,
    /\bunmappedShopifyUsageEventHandles\s+String\[\]\s+@default\(\[\]\)/,
    "Prisma Subscription must define the exact non-null String[] field with empty default.",
  );
  assert.equal(
    (subscriptionModel.match(/\bunmappedShopifyUsageEventHandles\b/g) ?? [])
      .length,
    1,
    "The Prisma field must be declared exactly once.",
  );

  const migration = readFileSync(migrationPath, "utf8");
  assert.match(
    migration,
    /ALTER TABLE "billing"\."Subscription"\s+ADD COLUMN "unmappedShopifyUsageEventHandles" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\];/i,
  );
  assert.equal((migration.match(/\bALTER TABLE\b/gi) ?? []).length, 1);
  assert.doesNotMatch(
    migration,
    /\b(?:CREATE|DROP|TRUNCATE|DELETE|UPDATE|RENAME)\b/i,
    "The migration must be additive and must not rewrite or remove existing data/objects.",
  );
  console.log("PASS Prisma and forward-migration contracts");
}

async function main() {
  assertSchemaAndMigrationContract();

  try {
    docker([
      "run",
      "--detach",
      "--name",
      container,
      "--network",
      "none",
      "--env",
      "POSTGRES_PASSWORD=fixture-only",
      "--env",
      `POSTGRES_DB=${database}`,
      "pgvector/pgvector:pg17",
    ]);
    started = true;
    await waitForPostgres();

    const migrations = migrationNames();
    const targetIndex = migrations.indexOf(target);
    assert.ok(targetIndex >= 0, `Target migration ${target} must exist.`);

    for (const name of migrations.slice(0, targetIndex)) {
      applyMigration(name);
    }

    const beforeObjects = subscriptionStructureCounts();
    let beforeExistingRow = null;

    if (mode === "upgrade") {
      seedSubscription(
        subscriptionId,
        "arch078-existing-shop",
        "arch078-existing.example.invalid",
        true,
      );
      beforeExistingRow = subscriptionCore(subscriptionId);
      console.log(
        "SEEDED pre-migration Subscription row for upgrade preservation.",
      );
    }

    applyMigration(target);

    assertColumnMetadata();
    assert.deepEqual(
      subscriptionStructureCounts(),
      beforeObjects,
      "The migration must not add Subscription indexes, constraints or triggers.",
    );
    console.log("PASS migration adds no index, constraint or trigger");

    if (mode === "upgrade") {
      assert.deepEqual(
        subscriptionCore(subscriptionId),
        beforeExistingRow,
        "Existing subscription status, observed handle and sync-error history must remain unchanged.",
      );
      assert.deepEqual(
        subscriptionArray(subscriptionId),
        [],
        "Existing subscriptions must receive the empty-array default.",
      );
      console.log(
        "PASS upgrade preserves existing Subscription and initializes its new array to []",
      );
    } else {
      seedSubscription(
        subscriptionId,
        "arch078-fresh-shop",
        "arch078-fresh.example.invalid",
        false,
      );
      assert.deepEqual(
        subscriptionArray(subscriptionId),
        [],
        "New subscriptions must receive the empty-array default.",
      );
      console.log("PASS fresh install new Subscription receives [] by default");
    }

    seedSubscription(
      newSubscriptionId,
      "arch078-new-shop",
      "arch078-new.example.invalid",
      false,
    );
    assert.deepEqual(subscriptionArray(newSubscriptionId), []);
    console.log("PASS post-migration Subscription receives [] by default");

    const beforeArrayWrites = subscriptionCore(subscriptionId);
    sql(`
      UPDATE billing."Subscription"
      SET "unmappedShopifyUsageEventHandles" =
        ARRAY['gold-top-up', 'premium-top-up']::TEXT[]
      WHERE "id" = ${quote(subscriptionId)};
    `);
    assert.deepEqual(
      subscriptionArray(subscriptionId),
      ["gold-top-up", "premium-top-up"],
      "Exact provider-returned handles and their stable order must persist.",
    );
    assert.deepEqual(
      subscriptionCore(subscriptionId),
      beforeArrayWrites,
      "Writing the mapping array must not change status, observed plan handle or sync-error history.",
    );
    console.log(
      "PASS exact unmapped handles persist without changing subscription lifecycle or sync-error fields",
    );

    sql(`
      UPDATE billing."Subscription"
      SET "unmappedShopifyUsageEventHandles" = ARRAY[]::TEXT[]
      WHERE "id" = ${quote(subscriptionId)};
    `);
    assert.deepEqual(subscriptionArray(subscriptionId), []);
    assert.deepEqual(
      subscriptionCore(subscriptionId),
      beforeArrayWrites,
      "Clearing the mapping array must not change unrelated subscription state.",
    );
    console.log(
      "PASS unmapped handles clear to [] without changing subscription lifecycle or sync-error fields",
    );

    console.log(`PASS ARCH-078 DATABASE-001 PostgreSQL ${mode}`);
  } finally {
    if (started) {
      docker(["rm", "--force", "--volumes", container]);
      console.log(`CLEANUP ${container}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
