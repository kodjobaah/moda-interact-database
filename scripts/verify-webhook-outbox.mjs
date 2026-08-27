// Verification script for the Shopify webhook receipt/outbox contract.
//
// This repository has no configured test runner (`npm test` is a stub), so
// invariants are verified here against a real Postgres instance instead.
//
// Usage:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/moda_interact" \
//     node scripts/verify-webhook-outbox.mjs
//
// Only run this against a local/disposable database — it creates and deletes
// Shop, ShopifyWebhookReceipt, and ShopifyWebhookOutbox rows.

import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import process from "node:process";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const results = [];

function unique(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`FAIL: ${name}`);
    console.error(error);
  }
}

async function makeShop() {
  return prisma.shop.create({
    data: {
      domain: unique("shop") + ".myshopify.com",
    },
  });
}

async function main() {
  await check(
    "duplicate [appKey, deliveryId] is rejected",
    async () => {
      const shop = await makeShop();
      const deliveryId = unique("delivery");

      await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-a",
          deliveryId,
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      await assert.rejects(() =>
        prisma.shopifyWebhookReceipt.create({
          data: {
            appKey: "app-a",
            deliveryId,
            shopId: shop.id,
            shopDomain: shop.domain,
            topic: "orders/create",
            disposition: "ACCEPTED",
          },
        }),
      );
    },
  );

  await check(
    "same eventId with different delivery IDs is accepted",
    async () => {
      const shop = await makeShop();
      const eventId = unique("event");

      const first = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-b",
          deliveryId: unique("delivery"),
          eventId,
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "checkouts/update",
          disposition: "ACCEPTED",
        },
      });

      const second = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-b",
          deliveryId: unique("delivery"),
          eventId,
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "checkouts/update",
          disposition: "ACCEPTED",
        },
      });

      assert.notEqual(first.id, second.id);
      assert.equal(first.eventId, second.eventId);
    },
  );

  await check(
    "same deliveryId under different app keys is accepted",
    async () => {
      const shop = await makeShop();
      const deliveryId = unique("delivery");

      const first = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-c",
          deliveryId,
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      const second = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-d",
          deliveryId,
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      assert.notEqual(first.id, second.id);
    },
  );

  await check(
    "receipt deletion cascades to outbox",
    async () => {
      const shop = await makeShop();

      const receipt = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-e",
          deliveryId: unique("delivery"),
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      const outbox = await prisma.shopifyWebhookOutbox.create({
        data: {
          receiptId: receipt.id,
          destination: "ORDER_EVENTS",
          jobName: "publish-order-event",
          jobId: unique("job"),
          payload: { hello: "world" },
        },
      });

      await prisma.shopifyWebhookReceipt.delete({ where: { id: receipt.id } });

      const outboxAfterDelete = await prisma.shopifyWebhookOutbox.findUnique({
        where: { id: outbox.id },
      });

      assert.equal(outboxAfterDelete, null);
    },
  );

  await check(
    "shop deletion sets receipt shopId to null",
    async () => {
      const shop = await makeShop();

      const receipt = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-f",
          deliveryId: unique("delivery"),
          shopId: shop.id,
          shopDomain: shop.domain,
          topic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      await prisma.shop.delete({ where: { id: shop.id } });

      const receiptAfterShopDelete = await prisma.shopifyWebhookReceipt.findUnique({
        where: { id: receipt.id },
      });

      assert.notEqual(receiptAfterShopDelete, null);
      assert.equal(receiptAfterShopDelete.shopId, null);

      // Clean up now that the shop FK no longer references this row.
      await prisma.shopifyWebhookReceipt.delete({ where: { id: receipt.id } });
    },
  );

  await check(
    "partial index exists and targets pending rows",
    async () => {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'shopify'
          AND indexname = 'ShopifyWebhookOutbox_due'
      `);

      assert.equal(rows.length, 1);
      const indexdef = rows[0].indexdef;
      assert.match(indexdef, /WHERE \(state = 'PENDING'::"?shopify"?\."?WebhookOutboxState"?\)/i);
    },
  );

  const failed = results.filter((r) => !r.ok);

  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
