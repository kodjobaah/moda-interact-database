import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSchemaText } from './validate-arch049-shopbrand-schema.mjs';
import { validateMigrationText } from './validate-arch049-shopbrand-migration.mjs';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../prisma/migrations/20261025170000_arch049_shopbrand_commerce_media/migration.sql', import.meta.url), 'utf8');

function replaceOnce(source, original, mutant) {
  assert.equal(source.split(original).length - 1, 1, `Mutation anchor missing/non-unique: ${original}`);
  return source.replace(original, mutant);
}
function replaceBrand(source, original, mutant) {
  const block = source.match(/^model ShopBrand \{[\s\S]*?^\}/m)?.[0];
  assert.ok(block, 'ShopBrand fixture missing');
  return source.replace(block, replaceOnce(block, original, mutant));
}
function rejects(label, validate, mutated) {
  assert.throws(() => validate(mutated), /ShopBrand|Shop\.brand|ARCH-049 migration|commerce/, label);
  console.log(`PASS rejects ${label}`);
}

validateSchemaText(schema);
validateMigrationText(migration);
for (const [label, before, after] of [
  ['nullable media', 'whatsAppMedia Json @default("{}") @db.JsonB', 'whatsAppMedia Json? @default("{}") @db.JsonB'],
  ['missing JSONB storage', 'whatsAppMedia Json @default("{}") @db.JsonB', 'whatsAppMedia Json @default("{}")'],
  ['wrong media default', 'whatsAppMedia Json @default("{}") @db.JsonB', 'whatsAppMedia Json @default("[]") @db.JsonB'],
  ['wrong media type', 'whatsAppMedia Json @default("{}") @db.JsonB', 'whatsAppMedia String @default("{}") @db.Text'],
  ['ShopBrand in original schema', '@@schema("commerce")', '@@schema("shopify")'],
  ['lost one-per-shop uniqueness', 'shopId String @unique', 'shopId String'],
  ['foreign key changed to Restrict', 'onDelete: Cascade)', 'onDelete: Restrict)'],
  ['extra ShopBrand field', 'brandName String?', 'brandName String?\n  customMediaAsset String?'],
  ['lost original source field', 'coverImageUrl String?', ''],
  ['wrong timestamps', 'lastRefreshedAt DateTime @updatedAt', 'lastRefreshedAt DateTime @default(now())'],
  ['new index', '@@schema("commerce")', '@@index([fetchedAt])\n  @@schema("commerce")'],
]) {
  rejects(label, validateSchemaText, replaceBrand(schema, before, after));
}
rejects('missing Shop.brand reverse relation', validateSchemaText,
  replaceOnce(schema, 'brand                              ShopBrand?', 'brand                              String?'));
rejects('invented ShopBrandMediaAsset model', validateSchemaText,
  `${schema}\nmodel ShopBrandMediaAsset {\n  id String @id\n  @@schema("commerce")\n}\n`);

for (const [label, before, after] of [
  ['wrong SET SCHEMA target', 'SET SCHEMA "commerce"', 'SET SCHEMA "shopify"'],
  ['recreates the ShopBrand table', 'ALTER TABLE "shopify"."ShopBrand" SET SCHEMA "commerce"', 'CREATE TABLE "commerce"."ShopBrand" ("id" TEXT PRIMARY KEY)'],
  ['wrong JSON column type', '"whatsAppMedia" JSONB', '"whatsAppMedia" TEXT'],
  ['nullable JSON column', 'JSONB NOT NULL DEFAULT', 'JSONB DEFAULT'],
  ['wrong JSON default', "DEFAULT '{}'::jsonb", "DEFAULT '[]'::jsonb"],
  ['missing JSON column', '  ADD COLUMN "whatsAppMedia" JSONB NOT NULL DEFAULT \'{}\'::jsonb;', '  ADD COLUMN "media" JSONB NOT NULL DEFAULT \'{}\'::jsonb;'],
  ['non-atomic migration', 'BEGIN;', ''],
  ['forbidden business rule constraint', 'COMMIT;', 'ALTER TABLE "commerce"."ShopBrand" ADD CONSTRAINT test CHECK (true);\nCOMMIT;'],
  ['forbidden trigger', 'COMMIT;', 'CREATE TRIGGER brand_change AFTER UPDATE ON "commerce"."ShopBrand" FOR EACH ROW EXECUTE FUNCTION test();\nCOMMIT;'],
]) {
  rejects(label, validateMigrationText, replaceOnce(migration, before, after));
}
console.log('PASS ARCH-049 schema and migration validator mutation suite');
