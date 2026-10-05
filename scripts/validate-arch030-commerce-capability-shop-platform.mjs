import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261005210000_arch030_commerce_capability_shop_platform/migration.sql');
const erd = read('docs/generated/prisma-erd.puml');
const model = name => schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

const capability = model('CommerceCapability');
assert.match(capability, /^\s*shopPlatform\s+ShopPlatform\?\s*$/m, 'CommerceCapability.shopPlatform must use the existing nullable ShopPlatform enum');
assert.doesNotMatch(model('CommerceTool'), /^\s*shopPlatform\s/m, 'Platform applicability belongs to CommerceCapability, not CommerceTool');

assert.match(migration, /ALTER TABLE commerce\."CommerceCapability"[\s\S]*ADD COLUMN "shopPlatform" commerce\."ShopPlatform";/);
assert.doesNotMatch(migration, /CREATE TYPE\s+commerce\."ShopPlatform"/i, 'The existing ShopPlatform enum must be reused');
assert.doesNotMatch(migration, /^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+/mi, 'The migration must not infer/backfill historical capability platform values');
assert.doesNotMatch(migration, /DROP\s+(TABLE|TYPE|SCHEMA|COLUMN)/i, 'The migration must remain additive');
assert.match(migration, /NEW\."shopPlatform"/);
assert.match(migration, /OLD\."shopPlatform"/);
assert.match(migration, /ARCH030 capability identity immutable/);

assert.match(erd, /entity "CommerceCapability"[\s\S]*shopPlatform : ShopPlatform/, 'ERD must show nullable CommerceCapability.shopPlatform');

console.log('ARCH-030 CommerceCapability shop-platform schema/migration/ERD checks passed.');
