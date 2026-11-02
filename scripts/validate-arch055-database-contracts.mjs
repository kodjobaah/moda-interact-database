import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const baseline = '7c377282aa5819b3008b7d7f3018f44f4161523e';
assert.equal(spawnSync('git', ['cat-file', '-e', `${baseline}^{commit}`], { cwd: root }).status, 0,
  `Recorded pre-ARCH-055 baseline is unavailable: ${baseline}`);
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], { cwd: root }).status, 0,
  `Recorded pre-ARCH-055 baseline must be an ancestor of HEAD: ${baseline}`);
const expected = [
  '20261102120000_arch055_rest_read_lifecycle',
  '20261102121000_arch055_human_follow_up_claim_identity',
  '20261102122000_arch055_upload_intake_identity',
];
const migrationDir = join(root, 'prisma/migrations');
const migrationNames = readdirSync(migrationDir).filter(name => /^\d{14}_/.test(name)).sort();
const targetIndexes = expected.map(name => migrationNames.indexOf(name));
assert.ok(targetIndexes.every(index => index >= 0), 'All ARCH-055 target migrations must exist');
assert.ok(targetIndexes.every((index, position) => position === 0 || targetIndexes[position - 1] < index),
  'ARCH-055 target migrations must remain in prescribed relative order');

const expectedFiles = new Set([
  'package.json', 'prisma/schema.prisma',
  'scripts/validate-arch040-human-prepared-schema.mjs',
  'scripts/test-arch040-human-prepared-postgres.mjs',
  ...expected.map(name => `prisma/migrations/${name}/migration.sql`),
  'scripts/test-arch055-database-contracts-postgres.mjs',
  'scripts/validate-arch055-database-contracts.mjs',
  'scripts/fixtures/arch055/legacy-fixtures.mjs',
  'scripts/fixtures/arch055/assertions.mjs',
]);
const changed = new Set([
  ...git('diff', '--name-only', baseline).split('\n'),
  ...git('diff', '--name-only', 'HEAD').split('\n'),
].filter(Boolean));
const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
for (const file of [...changed, ...untracked]) assert.ok(expectedFiles.has(file), `Unapproved implementation path changed: ${file}`);
for (const file of expectedFiles) assert.ok(changed.has(file) || untracked.includes(file), `Expected task file is absent: ${file}`);

let baselineSchema = git('show', `${baseline}:prisma/schema.prisma`);
const additions = [
  ['  idempotencyKey                      String                        @db.VarChar(128)\n', '  followUpClaimKey                    String?                       @db.VarChar(255)\n'],
  ['  dataFormatId     String                               @db.Text\n', '  intentPurposeKey String?                              @db.VarChar(64)\n'],
];
for (const [anchor, insertion] of additions) {
  assert.equal(baselineSchema.split(anchor).length - 1, 1, 'Prisma insertion anchor is unique in baseline');
  baselineSchema = baselineSchema.replace(anchor, anchor + insertion);
}
assert.equal(readFileSync(join(root, 'prisma/schema.prisma'), 'utf8'), baselineSchema,
  'Prisma schema differs only by the two exact nullable field insertions');

const packageBefore = JSON.parse(git('show', `${baseline}:package.json`));
const packageNow = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const additionsScripts = {
  'test:arch055-database-contracts': 'node scripts/validate-arch055-database-contracts.mjs',
  'test:arch055-database-contracts:postgres:fresh': 'node scripts/test-arch055-database-contracts-postgres.mjs --mode fresh',
  'test:arch055-database-contracts:postgres:upgrade': 'node scripts/test-arch055-database-contracts-postgres.mjs --mode upgrade',
};
for (const [name, command] of Object.entries(additionsScripts)) {
  assert.equal(packageBefore.scripts[name], undefined);
  assert.equal(packageNow.scripts[name], command);
  delete packageNow.scripts[name];
}
assert.deepEqual(packageNow, packageBefore, 'package.json contains only the three authorized script entries');

const migration = name => readFileSync(join(migrationDir, name, 'migration.sql'), 'utf8');
const m1 = migration(expected[0]);
assert.match(m1, /^BEGIN;[\s\S]*COMMIT;\s*$/);
assert.match(m1, /DROP CONSTRAINT "WooCommerceRestReadAttempt_consumption_time_check"/);
assert.match(m1, /"consumedAt" >= "createdAt" AND\s*\("status" = 'FAILED' OR "consumedAt" <= "expiresAt"\)/);
assert.match(m1, /IF NEW\."status" = 'FAILED' THEN[\s\S]*?NEW\."consumptionTransactionId" := txid_current\(\);\s*RETURN NEW;/);
assert.match(m1, /IF NOT FOUND OR shop_platform <> 'WOOCOMMERCE' OR current_status <> 'ACTIVE'/);
assert.doesNotMatch(m1, /arch026_rest_read_grant_guard|arch026_rest_read_attempt_commit_guard|CREATE TRIGGER|DROP TRIGGER|WooCommerceRestReadGrant/);

const m2 = migration(expected[1]);
assert.match(m2, /LOCK TABLE "whatsapp"\."MerchantConversationSendCommand" IN ACCESS EXCLUSIVE MODE/);
assert.match(m2, /tgname = 'arch040_command_guard'[\s\S]*?NOT tgisinternal AND tgenabled = 'O'/);
assert.equal((m2.match(/DISABLE TRIGGER/g) ?? []).length, 1);
assert.equal((m2.match(/ENABLE TRIGGER/g) ?? []).length, 1);
assert.match(m2, /DISABLE TRIGGER arch040_command_guard;[\s\S]*?SET "followUpClaimKey" = "idempotencyKey"\s+WHERE "kind" = 'RECOVERY_FOLLOW_UP_TEMPLATE';[\s\S]*?ENABLE TRIGGER arch040_command_guard;/);
assert.doesNotMatch(m2, /DISABLE TRIGGER (ALL|USER)|session_replication_role|CREATE OR REPLACE FUNCTION|initiationKey/);

const m3 = migration(expected[2]);
assert.match(m3, /LOCK TABLE "commerce"\."MerchantKnowledgeSourceRevision" IN SHARE ROW EXCLUSIVE MODE/);
assert.match(m3, /WHERE "uploadedAssetId" IS NOT NULL\s+AND "reason" IN \('CREATE', 'FILE_REPLACE'\)/);
assert.match(m3, /CREATE UNIQUE INDEX "MerchantKnowledgeSourceRevision_original_intake_asset_key"\s+ON "commerce"\."MerchantKnowledgeSourceRevision" \("uploadedAssetId"\)\s+WHERE "uploadedAssetId" IS NOT NULL AND "reason" IN \('CREATE', 'FILE_REPLACE'\)/);
assert.doesNotMatch(m3, /DELETE FROM|UPDATE "commerce"\."MerchantKnowledgeUploadedAsset"|DROP (TABLE|COLUMN)|IF NOT EXISTS/);

const predecessorPaths = migrationNames.slice(0, targetIndexes[0])
  .map(name => `prisma/migrations/${name}/migration.sql`);
const baselineMigrationBlobs = new Map(git('ls-tree', '-r', baseline, '--', 'prisma/migrations')
  .trim().split('\n').filter(Boolean).map(line => {
    const [, , , objectId, path] = line.match(/^(\d+) (blob) ([0-9a-f]+)\t(.+)$/) ?? [];
    return [path, objectId];
  }));
const currentMigrationBlobs = execFileSync('git', ['hash-object', '--stdin-paths'], {
  cwd: root, encoding: 'utf8', input: `${predecessorPaths.join('\n')}\n`,
}).trim().split('\n');
assert.equal(currentMigrationBlobs.length, predecessorPaths.length,
  'Every canonical predecessor migration must be present in the working tree');
for (let index = 0; index < predecessorPaths.length; index++) {
  assert.equal(currentMigrationBlobs[index], baselineMigrationBlobs.get(predecessorPaths[index]),
    `Canonical predecessor migration hash changed: ${predecessorPaths[index]}`);
}
for (const file of [...expected.map(name => `prisma/migrations/${name}/migration.sql`), ...[...expectedFiles].filter(x => x.startsWith('scripts/'))]) {
  assert.ok(readFileSync(join(root, file), 'utf8').length > 0, `${file} is empty`);
}

const temp = mkdtempSync(join(tmpdir(), 'arch055-prisma-diff-'));
try {
  const baselinePath = join(temp, 'schema.prisma');
  writeFileSync(baselinePath, git('show', `${baseline}:prisma/schema.prisma`));
  const prisma = join(root, 'node_modules/.bin/prisma');
  const result = spawnSync(prisma, ['migrate', 'diff', '--from-schema-datamodel', baselinePath,
    '--to-schema-datamodel', join(root, 'prisma/schema.prisma'), '--script'],
  { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `Prisma schema diff failed: ${result.stderr}`);
  const statements = result.stdout.split(';').map(x => x.trim()).filter(Boolean);
  assert.equal(statements.length, 2, `Expected only two Prisma column additions, got:\n${result.stdout}`);
  assert.match(result.stdout, /ALTER TABLE "whatsapp"\."MerchantConversationSendCommand" ADD COLUMN\s+"followUpClaimKey" VARCHAR\(255\)/);
  assert.match(result.stdout, /ALTER TABLE "commerce"\."MerchantKnowledgeUploadedAsset" ADD COLUMN\s+"intentPurposeKey" VARCHAR\(64\)/);
  assert.doesNotMatch(result.stdout, /DROP |CREATE (TABLE|INDEX)|ALTER COLUMN|SET NOT NULL/);
  console.log('PASS Prisma schema-to-schema diff contains exactly two nullable column additions');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`PASS ARCH-055 static contract, exact edit allowlist, target migration order through ${expected.at(-1)}, and ${targetIndexes[0]} predecessor hashes from ${baseline}`);
