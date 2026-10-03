import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const erd = read('docs/generated/prisma-erd.puml');
const block = (source, kind, name) => source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const model = name => block(schema, 'model', name);
const shop = model('Shop');
const shopSettings = model('ShopSettings');

for (const [name, prismaType, dbType] of [
  ['storeLocale', 'String?', 'VarChar(128)'],
  ['defaultLanguageTag', 'String?', 'VarChar(64)'],
  ['defaultTimeZone', 'String?', 'VarChar(255)'],
  ['defaultCountryCode', 'String?', 'VarChar(2)'],
]) {
  assert.match(shop, new RegExp(`^\\s*${name}\\s+${prismaType.replace('?', '\\?')}\\s+@db\\.${dbType.replace(/[()]/g, '\\$&')}$`, 'm'),
    `Shop.${name} must be nullable with bounded ${dbType} storage`);
}

for (const name of ['defaultLanguageTag', 'defaultTimeZone', 'defaultCountryCode']) {
  assert.match(shopSettings, new RegExp(`^\\s*${name}\\s+String\\?\\s*$`, 'm'), `legacy ShopSettings.${name} must remain unchanged`);
}
assert.doesNotMatch(shopSettings, /^\s*storeLocale\s/m, 'No Woo/Shopify-specific locale duplicate may be added to ShopSettings');
assert.doesNotMatch(schema, /^enum\s+\w*(?:Locale|LanguageTag|TimeZone|CountryCode)\s*\{/im,
  'International-context values must not be represented by a closed enum');
assert.doesNotMatch(schema, /(?:locale|languageTag|timeZone|countryCode)\s+(?:String\s+)?@default\(\[|(?:SUPPORTED|ALLOWED)_\w*(?:LOCALE|LANGUAGE|TIMEZONE|COUNTRY)/i,
  'No locale allowlist/default catalogue may be introduced');

const erdShop = erd.match(/entity "Shop" as \w+ \{([\s\S]*?)\n\}/)?.[1] ?? '';
for (const [name, type] of [
  ['storeLocale', 'String'],
  ['defaultLanguageTag', 'String'],
  ['defaultTimeZone', 'String'],
  ['defaultCountryCode', 'String'],
]) assert.match(erdShop, new RegExp(`${name}\\s*:\\s*${type}`), `generated ERD missing Shop.${name}`);

console.log('ARCH-026 shared international-context schema and ERD checks passed.');