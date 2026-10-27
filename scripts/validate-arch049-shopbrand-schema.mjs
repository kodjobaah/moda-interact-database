import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultSchema = new URL('../prisma/schema.prisma', import.meta.url);

// ARCH-049 has one existing ShopBrand row per Shop. Its columns and relation
// are intentionally frozen; the only additions are the JSONB field and mapping.
const expectedFields = new Map([
  ['id', 'String @id @default(cuid())'],
  ['shopId', 'String @unique'],
  ['shop', 'Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)'],
  ['brandName', 'String?'],
  ['logoUrl', 'String?'],
  ['logoAltText', 'String?'],
  ['logoWidth', 'Int?'],
  ['logoHeight', 'Int?'],
  ['squareLogoUrl', 'String?'],
  ['squareLogoAltText', 'String?'],
  ['coverImageUrl', 'String?'],
  ['whatsAppMedia', 'Json @default("{}") @db.JsonB'],
  ['fetchedAt', 'DateTime @default(now())'],
  ['lastRefreshedAt', 'DateTime @updatedAt'],
]);

function modelBlock(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...source.matchAll(new RegExp(`^model ${escaped} \\{([\\s\\S]*?)^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `Prisma ${name} must exist exactly once`);
  return matches[0][1];
}

export function validateSchemaText(source) {
  assert.equal([...source.matchAll(/^model\s+ShopBrand\w*\s*\{/gm)].length, 1,
    'Exactly one ShopBrand model is permitted; no ShopBrand media-asset model');
  const brand = modelBlock(source, 'ShopBrand');
  const parsed = new Map();
  const directives = [];
  for (const raw of brand.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('@@')) {
      directives.push(line.replace(/\s+/g, ' '));
      continue;
    }
    const declaration = /^([A-Za-z]\w*)\s+(.+)$/.exec(line);
    assert.ok(declaration, `Invalid ShopBrand declaration: ${line}`);
    assert.ok(!parsed.has(declaration[1]), `Duplicate ShopBrand.${declaration[1]}`);
    parsed.set(declaration[1], declaration[2].replace(/\s+/g, ' '));
  }
  assert.deepEqual([...parsed.keys()].sort(), [...expectedFields.keys()].sort(),
    'ShopBrand fields must preserve every original field and add only whatsAppMedia');
  for (const [field, expected] of expectedFields) {
    assert.equal(parsed.get(field), expected, `ShopBrand.${field} type/default/constraints changed`);
  }
  assert.deepEqual(directives, ['@@schema("commerce")'],
    'ShopBrand must map only to commerce, without new indexes, tables or mappings');

  const shop = modelBlock(source, 'Shop');
  const relations = [...shop.matchAll(/^\s*brand\s+(\S+)([^\r\n]*)$/gm)];
  assert.equal(relations.length, 1, 'Shop.brand must remain exactly one reverse relation');
  assert.equal(`${relations[0][1]}${relations[0][2]}`.trim(), 'ShopBrand?',
    'Shop.brand must remain ShopBrand? with no changed relation declaration');
  assert.match(shop, /^\s*@@schema\("commerce"\)\s*$/m,
    'Shop referenced by ShopBrand.shop must stay in commerce');
  assert.match(source, /schemas\s*=\s*\[[^\]]*"shopify"[^\]]*"commerce"/,
    'Existing Prisma datasource schema mappings must be preserved');
  return { fields: parsed.size, model: 'commerce.ShopBrand' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const flag = process.argv.indexOf('--schema');
  assert.ok(flag < 0 || process.argv[flag + 1], '--schema requires a path');
  const result = validateSchemaText(readFileSync(flag < 0 ? defaultSchema : process.argv[flag + 1], 'utf8'));
  console.log(`PASS ARCH-049 exact Prisma ${result.model} schema (${result.fields} fields, existing Shop.brand preserved)`);
}
