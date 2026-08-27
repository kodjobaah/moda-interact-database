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

Application repositories generate their Prisma clients from this shared schema.

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

The Shopify application delays checkout-recovery processing using
`CHECKOUT_RECOVERY_DELAY_MS`. The default is 30 minutes (`1800000` ms).

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
BullMQ / Redis
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