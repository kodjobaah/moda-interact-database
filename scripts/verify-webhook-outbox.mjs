// Verification script for the Shopify webhook receipt/outbox contract.
//
// This repository has no configured test runner (`npm test` is a stub), so
// invariants are verified here against a real Postgres instance instead.
//
// Usage:
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/moda_interact"
//     node scripts/verify-webhook-outbox.mjs
//
// Only run this against a local/disposable database — it creates and deletes
// Shop, ShopifyWebhookReceipt, and ShopifyWebhookOutbox rows.

import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import process from "node:process";

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
      domain: `${unique("shop")}.myshopify.com`,
    },
  });
}

async function makeReceipt({
  appKey,
  shop,
  deliveryId = unique("delivery"),
  eventId = null,
  providerTopic = "orders/create",
  disposition = "ACCEPTED",
  shopId,
  shopDomain,
}) {
  return prisma.shopifyWebhookReceipt.create({
    data: {
      appKey,
      deliveryId,
      eventId,
      shopId: shopId ?? shop?.id ?? null,
      shopDomain: shopDomain ?? shop?.domain ?? `${unique("ignored-shop")}.myshopify.com`,
      providerTopic,
      disposition,
    },
  });
}

function makeEnvelope({ receipt, shop, eventType, traceId }) {
  return {
    schemaVersion: 1,
    receiptId: receipt.id,
    deliveryId: receipt.deliveryId,
    eventId: receipt.eventId,
    source: "shopify",
    eventType,
    providerTopic: receipt.providerTopic,
    tenant: {
      shopId: shop.id,
      shopDomain: shop.domain,
    },
    occurredAt: receipt.triggeredAtRaw ?? null,
    receivedAt: receipt.receivedAt.toISOString(),
    traceId,
    orderingKey: receipt.deliveryId,
    payload: {
      hello: "world",
    },
  };
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
          providerTopic: "orders/create",
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
            providerTopic: "orders/create",
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
          providerTopic: "checkouts/update",
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
          providerTopic: "checkouts/update",
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
          providerTopic: "orders/create",
          disposition: "ACCEPTED",
        },
      });

      const second = await prisma.shopifyWebhookReceipt.create({
        data: {
          appKey: "app-d",
          deliveryId,
          shopId: shop.id,
          shopDomain: shop.domain,
          providerTopic: "orders/create",
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

      const receipt = await makeReceipt({
        appKey: "app-e",
        shop,
      });

      const outbox = await prisma.shopifyWebhookOutbox.create({
        data: {
          receiptId: receipt.id,
          destination: "SHOPIFY_COMMERCE_EVENTS",
          jobId: unique("job"),
          orderingKey: receipt.deliveryId,
          envelope: makeEnvelope({
            receipt,
            shop,
            eventType: "order.completed",
            traceId: unique("trace"),
          }),
        },
      });

      const outboxCount = await prisma.shopifyWebhookOutbox.count({
        where: { receiptId: receipt.id },
      });

      assert.equal(outboxCount, 1);
      assert.equal(outbox.contractVersion, 1);
      assert.equal(outbox.envelope.schemaVersion, 1);

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

      const receipt = await makeReceipt({
        appKey: "app-f",
        shop,
      });

      await prisma.shop.delete({ where: { id: shop.id } });

      const receiptAfterShopDelete = await prisma.shopifyWebhookReceipt.findUnique({
        where: { id: receipt.id },
      });

      assert.notEqual(receiptAfterShopDelete, null);
      assert.equal(receiptAfterShopDelete.shopId, null);

      await prisma.shopifyWebhookReceipt.delete({ where: { id: receipt.id } });
    },
  );

  await check(
    "ignored receipts do not create outbox rows",
    async () => {
      const receipt = await makeReceipt({
        appKey: "app-g",
        disposition: "IGNORED",
        shopId: null,
        shopDomain: `${unique("ignored-shop")}.myshopify.com`,
        providerTopic: "orders/create",
      });

      const outboxCount = await prisma.shopifyWebhookOutbox.count({
        where: { receiptId: receipt.id },
      });

      assert.equal(outboxCount, 0);
    },
  );

  await check(
    "only SHOPIFY_COMMERCE_EVENTS is accepted",
    async () => {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = 'shopify."WebhookOutboxDestination"'::regtype
        ORDER BY enumsortorder
      `);

      assert.deepEqual(rows.map((row) => row.enumlabel), ["SHOPIFY_COMMERCE_EVENTS"]);
    },
  );

  await check(
    "contractVersion defaults to 1",
    async () => {
      const shop = await makeShop();
      const receipt = await makeReceipt({
        appKey: "app-h",
        shop,
      });

      const outbox = await prisma.shopifyWebhookOutbox.create({
        data: {
          receiptId: receipt.id,
          destination: "SHOPIFY_COMMERCE_EVENTS",
          jobId: unique("job"),
          orderingKey: receipt.deliveryId,
          envelope: makeEnvelope({
            receipt,
            shop,
            eventType: "checkout.observed",
            traceId: unique("trace"),
          }),
        },
      });

      assert.equal(outbox.contractVersion, 1);
      assert.equal(outbox.envelope.schemaVersion, 1);
    },
  );

  await check(
    "jobId remains unique",
    async () => {
      const shop = await makeShop();
      const jobId = unique("job");

      const receiptOne = await makeReceipt({
        appKey: "app-i",
        shop,
      });

      const receiptTwo = await makeReceipt({
        appKey: "app-i",
        shop,
      });

      await prisma.shopifyWebhookOutbox.create({
        data: {
          receiptId: receiptOne.id,
          destination: "SHOPIFY_COMMERCE_EVENTS",
          jobId,
          orderingKey: receiptOne.deliveryId,
          envelope: makeEnvelope({
            receipt: receiptOne,
            shop,
            eventType: "order.completed",
            traceId: unique("trace"),
          }),
        },
      });

      await assert.rejects(() =>
        prisma.shopifyWebhookOutbox.create({
          data: {
            receiptId: receiptTwo.id,
            destination: "SHOPIFY_COMMERCE_EVENTS",
            jobId,
            orderingKey: receiptTwo.deliveryId,
            envelope: makeEnvelope({
              receipt: receiptTwo,
              shop,
              eventType: "order.completed",
              traceId: unique("trace"),
            }),
          },
        }),
      );
    },
  );

  await check(
    "orderingKey is required",
    async () => {
      const shop = await makeShop();
      const receipt = await makeReceipt({
        appKey: "app-j",
        shop,
      });

      await assert.rejects(() =>
        prisma.shopifyWebhookOutbox.create({
          data: {
            receiptId: receipt.id,
            destination: "SHOPIFY_COMMERCE_EVENTS",
            jobId: unique("job"),
            envelope: makeEnvelope({
              receipt,
              shop,
              eventType: "checkout.observed",
              traceId: unique("trace"),
            }),
          },
        }),
      );
    },
  );

  await check(
    "delayMs and legacy queue fields do not exist",
    async () => {
      const columns = await prisma.$queryRawUnsafe(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'shopify'
          AND table_name = 'ShopifyWebhookOutbox'
        ORDER BY column_name
      `);

      const names = columns.map((row) => row.column_name);

      assert.ok(!names.includes("delayMs"));
      assert.ok(!names.includes("jobName"));
      assert.ok(!names.includes("payload"));
    },
  );

  await check(
    "pending partial index exists",
    async () => {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = 'shopify'
          AND indexname = 'ShopifyWebhookOutbox_due'
      `);

      assert.equal(rows.length, 1);
      assert.match(
        rows[0].indexdef,
        /WHERE \(state = 'PENDING'::"?shopify"?\."?WebhookOutboxState"?\)/i,
      );
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