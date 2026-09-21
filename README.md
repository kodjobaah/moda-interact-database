# Moda Interact Database

Shared database schema and migration history for the **Moda Interact** platform.

This repository is the source of truth for the PostgreSQL data model used by the Moda Interact services.

The schema is defined using **Prisma** and is consumed by the other Moda Interact applications as a Git submodule.

## Database Architecture

The current database model is shown below.

![Moda Interact Database ERD](docs/generated/erd.png)

The diagram is generated directly from the Prisma schema using PlantUML.

## Repository Structure

```text
moda-interact-database/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
│   └── generated/
│       ├── prisma-erd.puml
│       └── prisma-erd.png
├── scripts/
│   └── generate-erd.mjs
├── package.json
└── README.md
```

## Prisma Schema

The canonical Prisma schema is located at:

```text
prisma/schema.prisma
```

The schema currently contains the persistence model for areas including:

- customers
- checkout recovery workflows
- WhatsApp conversations
- conversation messages
- Shopify application data

## Shopify Webhook Contract

The durable Shopify webhook flow stores a receipt row and, for accepted deliveries, exactly one outbox row.

Receipt rows keep request-level metadata only. They record the `deliveryId` retry dedupe key, the optional `eventId` correlation metadata, the shop identity, the provider topic, and the disposition that determines whether an outbox row is created.

The outbox stores the versioned commerce event envelope in `ShopifyWebhookOutbox.envelope`. The current contract is:

```ts
type ShopifyWebhookJobV1<T> = {
   schemaVersion: 1;
   receiptId: string;
   deliveryId: string;
   eventId: string | null;
   source: "shopify";
   eventType: "checkout.observed" | "order.completed";
   providerTopic: string;
   tenant: {
      shopId: string;
      shopDomain: string;
   };
   occurredAt: string | null;
   receivedAt: string;
   traceId: string;
   orderingKey: string;
   payload: T;
};
```

Webhook dispatch is immediate. Recovery timing is derived later by background processing after the webhook has been durably applied.

Application repositories generate their Prisma clients from this shared schema.
The Commerce service's nested database submodule must run `npm run prisma:generate`
from this repository after updating the submodule pointer; consumers must not copy
the schema. Generated clients must match the migration commit before deploying
code that reads external connections. Prisma rollback is limited to rolling back
application usage; the external connection migration is additive and its immutable
revision/audit tables and triggers must remain in place, so destructive down
migrations are intentionally not provided.

## Migrations

Database migrations are stored under:

```text
prisma/migrations/
```

This repository owns the migration history for the Moda Interact database.

Application services should consume these migrations rather than maintaining independent copies of the database schema.

## Local Database Workflow

Start a local PostgreSQL instance and use this connection string for local
database commands:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/moda_interact"
```

Deploy the existing migrations:

```bash
npm install
npm run migrate:deploy
```

Check whether the database is up to date:

```bash
npm run status
```

The demo seed script is maintained by the Shopify application. Run it from the
`moda-interact` repository after the database is running and migrations have
been deployed:

```bash
cd ../moda-interact
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/moda_interact" npm run prisma:seed
```

The seed recreates the demo shop's billing plans and dashboard data. It deletes
existing demo-shop usage events, billing periods, recoveries, customers,
settings, and subscriptions before inserting the demo records.

Ordinary Shopify checkout and order webhooks are not persisted as receipts or
transactional outbox rows in this database. Those events are coordinated
transiently by Redis/BullMQ in the application layer.

`CheckoutRecovery` is created only after Shopify confirms a checkout is a real
recovery candidate. A checkout webhook's top-level `token` is required to create
that recovery record.

Orders without an existing recovery are not retained as purchases in this
schema.

Durable persistence remains for actual recoveries, conversations, messages,
billing, compliance, and other business-critical state.

## Generate the ERD

The ERD is generated from the Prisma schema.

Install the project dependencies:

```bash
npm install
```

Then run:

```bash
npm run erd
```

For the ARCH-020 external connection boundary, use isolated local databases only:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/arch020_connections_test_fresh" npm run test:arch020-external-connections:database -- --mode fresh
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/arch020_connections_test_upgrade" npm run test:arch020-external-connections:database -- --mode upgrade
```

This generates:

```text
docs/generated/prisma-erd.puml
docs/generated/prisma-erd.png
```

The generated PNG is the diagram displayed at the top of this README.

## Related Projects

Moda Interact is split across several services:

- [moda-interact](https://github.com/kodjobaah/moda-interact)  
  Shopify application and webhook ingestion.

- [moda-interact-background](https://github.com/kodjobaah/moda-interact-background)  
  Background workers, checkout recovery workflows and commerce agent.

- [moda-interact-messaging](https://github.com/kodjobaah/moda-interact-messaging)  
  WhatsApp webhook handling and messaging integration.

## Architecture

At a high level:

```text
Shopify
   │
   ▼
Webhooks
   │
   ▼
Redis / BullMQ
   │
   ▼
Background Workers
   │
   ▼
PostgreSQL
   │
   ├── Customers
   ├── Checkout Recoveries
   ├── Conversations
   └── Messages
```

The database acts as the durable source of truth for both commercial workflow state and conversation history.