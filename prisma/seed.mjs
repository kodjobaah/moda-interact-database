import { PrismaClient } from "@prisma/client";
import process from "node:process";

const prisma = new PrismaClient();

const plans = [
  {
    handle: "starter",
    name: "Starter",

    entitlements: {
      checkout_recovery: true,
      product_search: true,
      ai_conversations: true,
      order_support: false,
    },

    limits: {
      monthly_conversations: 500,
      monthly_recoveries: 1000,
      monthly_messages: 5000,
    },
  },

  {
    handle: "growth",
    name: "Growth",

    entitlements: {
      checkout_recovery: true,
      product_search: true,
      ai_conversations: true,
      order_support: true,
    },

    limits: {
      monthly_conversations: 5000,
      monthly_recoveries: 10000,
      monthly_messages: 50000,
    },
  },

  {
    handle: "pro",
    name: "Pro",

    entitlements: {
      checkout_recovery: true,
      product_search: true,
      ai_conversations: true,
      order_support: true,
    },

    limits: {
      monthly_conversations: null,
      monthly_recoveries: null,
      monthly_messages: null,
    },
  },
];

const demoRecoveries = [
  { id: "demo-recovery-01", customerKey: "ama-mensah", status: "COMPLETED", totalPrice: "129.99", firstName: "Ama", lastName: "Mensah", email: "ama@example.com", detectedAt: "2026-07-18T09:15:00Z" },
  { id: "demo-recovery-02", customerKey: "ama-mensah", status: "COMPLETED", totalPrice: "84.50", firstName: "Ama", lastName: "Mensah", email: "ama@example.com", detectedAt: "2026-06-19T11:30:00Z" },
  { id: "demo-recovery-03", status: "COMPLETED", totalPrice: "249.00", firstName: "Nana", lastName: "Boateng", email: "nana@example.com", detectedAt: "2026-05-20T14:05:00Z" },
  { id: "demo-recovery-04", status: "COMPLETED", totalPrice: "175.25", firstName: "Esi", lastName: "Addo", email: "esi@example.com", detectedAt: "2026-04-21T08:45:00Z" },
  { id: "demo-recovery-05", status: "MESSAGE_SENT", totalPrice: "64.00", firstName: "Yaw", lastName: "Asare", email: "yaw@example.com", detectedAt: "2026-08-21T16:20:00Z" },
  { id: "demo-recovery-06", status: "MESSAGE_SENT", totalPrice: "91.75", firstName: "Akua", lastName: "Osei", email: "akua@example.com", detectedAt: "2026-08-22T10:10:00Z" },
  { id: "demo-recovery-07", status: "DETECTED", totalPrice: "42.50", firstName: "Kofi", lastName: "Adjei", email: "kofi@example.com", detectedAt: "2026-08-22T13:40:00Z" },
  { id: "demo-recovery-08", status: "EXPIRED", totalPrice: "118.00", firstName: "Abena", lastName: "Darko", email: "abena@example.com", detectedAt: "2026-08-23T09:00:00Z" },
];

const additionalHistoricalRecoveries = Array.from({ length: 12 }, (_, index) => {
  const month = ["07", "06", "05", "04"][index % 4];
  const customerNumber = index + 1;
  return {
    id: `demo-historical-recovery-${String(customerNumber).padStart(2, "0")}`,
    status: "COMPLETED",
    totalPrice: String(70 + customerNumber * 11.25),
    firstName: "Demo",
    lastName: `Customer ${customerNumber}`,
    email: `demo.customer${customerNumber}@example.com`,
    detectedAt: `2026-${month}-${String(10 + (index % 3) * 5).padStart(2, "0")}T12:00:00Z`,
  };
});

const seededRecoveries = [...demoRecoveries, ...additionalHistoricalRecoveries];

async function main() {
  console.log("Seeding billing plans...");

  for (const plan of plans) {
    await prisma.billingPlan.upsert({
      where: {
        handle: plan.handle,
      },

      create: {
        ...plan,
        active: true,
      },

      update: {
        name: plan.name,
        entitlements: plan.entitlements,
        limits: plan.limits,
        active: true,
      },
    });

    console.log(`✓ ${plan.handle}`);
  }

  console.log("Billing plans seeded.");

  const session = await prisma.session.findFirst({
    orderBy: { expires: "desc" },
  });

  if (!session?.shop) {
    throw new Error("Cannot seed dashboard data: no Shopify session was found.");
  }

  const demoShopDomain = session.shop.trim().toLowerCase();
  const demoShopifyShopId = "gid://shopify/Shop/101762498853";

  const existingShop = await prisma.shop.findUnique({
    where: { domain: demoShopDomain },
    select: { id: true },
  });

  if (existingShop) {
    await prisma.usageEvent.deleteMany({ where: { shopId: existingShop.id } });
    await prisma.billingPeriod.deleteMany({ where: { shopId: existingShop.id } });
    await prisma.checkoutRecovery.deleteMany({ where: { shopId: existingShop.id } });
    await prisma.customer.deleteMany({ where: { shopId: existingShop.id } });
    await prisma.shopSettings.deleteMany({ where: { shopId: existingShop.id } });
    await prisma.subscription.deleteMany({ where: { shopId: existingShop.id } });
    console.log(`Cleared existing demo data for ${demoShopDomain}.`);
  }

  const shop = await prisma.shop.upsert({ where: { domain: demoShopDomain }, create: { domain: demoShopDomain, shopifyShopId: demoShopifyShopId, status: "ACTIVE" }, update: { shopifyShopId: demoShopifyShopId, status: "ACTIVE" } });
  const currentPeriod = await prisma.billingPeriod.create({ data: { id: "demo-billing-period-current", shopId: shop.id, periodStart: new Date("2026-08-01T00:00:00Z"), periodEnd: new Date("2026-09-01T00:00:00Z"), status: "OPEN" } });
  const pastPeriods = await Promise.all([
    ["demo-billing-period-july", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"],
    ["demo-billing-period-june", "2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"],
    ["demo-billing-period-may", "2026-05-01T00:00:00Z", "2026-06-01T00:00:00Z"],
    ["demo-billing-period-april", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z"],
  ].map(([id, periodStart, periodEnd]) => prisma.billingPeriod.create({ data: { id, shopId: shop.id, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), status: "PAID" } })));
  const growthPlan = await prisma.billingPlan.findUniqueOrThrow({ where: { handle: "growth" } });
  await prisma.shopSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, onboardingCompleted: true, plan: "growth" }, update: { onboardingCompleted: true, plan: "growth" } });
  await prisma.subscription.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, planId: growthPlan.id, planHandle: "growth", status: "ACTIVE" }, update: { planId: growthPlan.id, planHandle: "growth", status: "ACTIVE" } });

  for (const [recoveryIndex, recovery] of seededRecoveries.entries()) {
    const customerKey = recovery.customerKey ?? recovery.id;
    const customer = await prisma.customer.upsert({
      where: { shopId_shopifyCustomerId: { shopId: shop.id, shopifyCustomerId: `demo-${customerKey}` } },
      create: { shopId: shop.id, shopifyCustomerId: `demo-${customerKey}`, firstName: recovery.firstName, lastName: recovery.lastName, email: recovery.email },
      update: { firstName: recovery.firstName, lastName: recovery.lastName, email: recovery.email },
    });
    await prisma.checkoutRecovery.upsert({
      where: { id: recovery.id },
      create: { id: recovery.id, shopId: shop.id, checkoutToken: `demo-token-${recovery.id}`, customerId: customer.id, status: recovery.status, currency: "GBP", totalPrice: recovery.totalPrice, checkoutUrl: `https://${demoShopDomain}/checkouts/${recovery.id}`, detectedAt: new Date(recovery.detectedAt), messageSentAt: ["MESSAGE_SENT", "ENGAGED", "COMPLETED"].includes(recovery.status) ? new Date(recovery.detectedAt) : null, engagedAt: ["ENGAGED", "COMPLETED"].includes(recovery.status) ? new Date(recovery.detectedAt) : null, completedAt: recovery.status === "COMPLETED" ? new Date(recovery.detectedAt) : null, expiredAt: recovery.status === "EXPIRED" ? new Date(recovery.detectedAt) : null },
      update: { status: recovery.status, totalPrice: recovery.totalPrice },
    });

    const conversationId = `demo-conversation-${recovery.id}`;
    const firstMessageId = `demo-message-${recovery.id}-01`;
    const secondMessageId = `demo-message-${recovery.id}-02`;
    const conversation = await prisma.conversation.upsert({
      where: { id: conversationId },
      create: { id: conversationId, checkoutRecoveryId: recovery.id, type: "RECOVERY", summary: "Demo recovery conversation" },
      update: { summary: "Demo recovery conversation" },
    });
    await prisma.conversationMessage.upsert({
      where: { id: firstMessageId },
      create: { id: firstMessageId, conversationId: conversation.id, direction: "OUTBOUND", senderType: "AGENT", status: "SENT", content: "Hi! We saved your items in case you would like to complete your order.", createdAt: new Date(recovery.detectedAt), sentAt: new Date(recovery.detectedAt) },
      update: { conversationId: conversation.id, status: "SENT" },
    });
    await prisma.conversationMessage.upsert({
      where: { id: secondMessageId },
      create: { id: secondMessageId, conversationId: conversation.id, direction: "OUTBOUND", senderType: "AUTOMATION", status: "DELIVERED", content: "Your checkout link is ready whenever you are.", createdAt: new Date(new Date(recovery.detectedAt).getTime() + 15 * 60 * 1000), sentAt: new Date(new Date(recovery.detectedAt).getTime() + 15 * 60 * 1000), deliveredAt: new Date(new Date(recovery.detectedAt).getTime() + 15 * 60 * 1000) },
      update: { conversationId: conversation.id, status: "DELIVERED" },
    });
    const usageEvents = [
      { metric: "checkout_recovery", idempotencyKey: `checkout-recovery:${recovery.id}`, sourceType: "CheckoutRecovery", sourceId: recovery.id },
      { metric: "conversation", idempotencyKey: `conversation:${conversationId}`, sourceType: "Conversation", sourceId: conversationId },
      { metric: "agent_message", idempotencyKey: `agent-message:${firstMessageId}`, sourceType: "ConversationMessage", sourceId: firstMessageId },
      { metric: "whatsapp_message", idempotencyKey: `whatsapp-message:${secondMessageId}`, sourceType: "ConversationMessage", sourceId: secondMessageId },
    ];

    for (const event of usageEvents) {
      const billingPeriod = recovery.status === "COMPLETED" ? pastPeriods[recoveryIndex % pastPeriods.length] : currentPeriod;
      await prisma.usageEvent.upsert({
        where: { idempotencyKey: event.idempotencyKey },
        create: { shopId: shop.id, billingPeriodId: billingPeriod.id, metric: event.metric, quantity: 1, idempotencyKey: event.idempotencyKey, sourceType: event.sourceType, sourceId: event.sourceId, occurredAt: new Date(recovery.detectedAt), reportedAt: recovery.status === "COMPLETED" ? new Date(new Date(recovery.detectedAt).getTime() + 24 * 60 * 60 * 1000) : null },
        update: { billingPeriodId: billingPeriod.id, metric: event.metric, quantity: 1, sourceType: event.sourceType, sourceId: event.sourceId, occurredAt: new Date(recovery.detectedAt), reportedAt: recovery.status === "COMPLETED" ? new Date(new Date(recovery.detectedAt).getTime() + 24 * 60 * 60 * 1000) : null },
      });
    }
  }

  console.log(`Demo dashboard data seeded with ${seededRecoveries.length * 4} usage events.`);
}

main()
  .catch((error) => {
    console.error("Failed to seed database:");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });