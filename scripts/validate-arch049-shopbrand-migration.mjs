import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = new URL('../prisma/migrations/20261025170000_arch049_shopbrand_commerce_media/migration.sql', import.meta.url);
const originalBaselinePath = new URL('../prisma/migrations/20260912000000_arch010_first_production_baseline/migration.sql', import.meta.url);

function normalise(source) {
  return source.replace(/--[^\r\n]*/g, '').split(';').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function validateMigrationText(migration, baseline = readFileSync(originalBaselinePath, 'utf8')) {
  // This is a move of an existing table. Check the historical table and its
  // technical constraints rather than accidentally treating a rebuild as a move.
  assert.match(baseline, /CREATE TABLE "shopify"\."ShopBrand"\s*\([\s\S]*?CONSTRAINT "ShopBrand_pkey" PRIMARY KEY \("id"\)/,
    'Original shopify.ShopBrand table/primary key is required');
  assert.match(baseline, /CREATE UNIQUE INDEX "ShopBrand_shopId_key" ON "shopify"\."ShopBrand"\("shopId"\)/,
    'Original one-per-shop unique index is required');
  assert.match(baseline, /ALTER TABLE "shopify"\."ShopBrand" ADD CONSTRAINT "ShopBrand_shopId_fkey" FOREIGN KEY \("shopId"\) REFERENCES "commerce"\."Shop"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
    'Original ShopBrand.shopId -> commerce.Shop foreign key/CASCADE is required');
  assert.deepEqual(normalise(migration), [
    'BEGIN',
    'ALTER TABLE "shopify"."ShopBrand" SET SCHEMA "commerce"',
    'ALTER TABLE "commerce"."ShopBrand" ADD COLUMN "whatsAppMedia" JSONB NOT NULL DEFAULT \'{}\'::jsonb',
    'COMMIT',
  ], 'ARCH-049 migration must contain only the atomic table schema move and exact non-null JSONB addition');
  return { ddlStatements: 2, default: '{}' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = process.argv.indexOf('--migration');
  assert.ok(flag < 0 || process.argv[flag + 1], '--migration requires a path');
  const result = validateMigrationText(readFileSync(flag < 0 ? migrationPath : process.argv[flag + 1], 'utf8'));
  console.log(`PASS ARCH-049 exact migration (${result.ddlStatements} DDL statements; default ${result.default})`);
}
