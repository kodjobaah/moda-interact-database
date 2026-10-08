import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('prisma/schema.prisma');
const migrationPath = new URL('../prisma/migrations/', import.meta.url);
const migrationName = '20261008140724_arch028_whatsapp_failure_reachability_compensation';
const migration = read(`prisma/migrations/${migrationName}/migration.sql`);
const migrations = readdirSync(migrationPath).filter(name => /^\d{14}_.+$/.test(name)).sort();
const block = (source, kind, name) => source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const model = name => block(schema, 'model', name);
const enumBody = name => block(schema, 'enum', name);

function uncomment(sql) {
  let output = '';
  let depth = 0;
  let lineComment = false;
  let singleQuote = false;
  let doubleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        output += '\n';
      }
      continue;
    }
    if (depth > 0) {
      if (character === '/' && next === '*') {
        depth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        depth -= 1;
        index += 1;
      }
      continue;
    }
    if (!singleQuote && !doubleQuote && character === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!singleQuote && !doubleQuote && character === '/' && next === '*') {
      depth = 1;
      index += 1;
      continue;
    }
    if (character === "'" && !doubleQuote) singleQuote = !singleQuote;
    if (character === '"' && !singleQuote) doubleQuote = !doubleQuote;
    output += character;
  }
  assert.equal(depth, 0, 'migration SQL contains an unterminated block comment');
  return output;
}

assert.deepEqual(migrations.filter(name => /arch028_whatsapp_failure_reachability_compensation/.test(name)), [migrationName]);
assert.ok(migrations.includes('20261008110000_arch027_woocommerce_billing_persistence'), 'accepted ARCH-027 migration must remain present');
assert.ok(migrationName > '20261008110000_arch027_woocommerce_billing_persistence', 'ARCH-028 must follow ARCH-027');
assert.equal(migrations.at(-1), migrationName, 'ARCH-028 must be the latest migration on this task branch');

const activeSql = uncomment(migration);
assert.doesNotMatch(migration, /Prisma-generated drift SQL/i, 'migration must not retain generated drift commentary');
assert.doesNotMatch(activeSql, /\bDROP\s+(?:TABLE|INDEX|TYPE|CONSTRAINT)\b/i, 'ARCH-028 must not remove accepted schema objects');
assert.doesNotMatch(activeSql, /\bRENAME\s+(?:INDEX|CONSTRAINT|COLUMN|TO)\b/i, 'ARCH-028 must not rename accepted schema objects');
assert.doesNotMatch(activeSql, /ALTER TABLE\s+"(?:commerce|shopify|public|woocommerce)"/i);
assert.doesNotMatch(activeSql, /INSERT\s+INTO/i, 'migration must not seed business rows');
assert.deepEqual(
  [...activeSql.matchAll(/ALTER TABLE\s+"([^"]+)"\."([^"]+)"/g)].map(([, schemaName, tableName]) => `${schemaName}.${tableName}`).sort(),
  ['billing.PlatformBillingPolicy', 'billing.UsageReservation', 'whatsapp.ConversationMessage'],
  'only ARCH-028-owned existing tables may be altered',
);
assert.deepEqual(
  [...activeSql.matchAll(/CREATE TABLE\s+"([^"]+)"\."([^"]+)"/g)].map(([, schemaName, tableName]) => `${schemaName}.${tableName}`),
  ['whatsapp.WhatsAppRecipientReachability'],
  'only the ARCH-028 reachability table may be created',
);
assert.deepEqual(
  [...activeSql.matchAll(/CREATE TYPE\s+"([^"]+)"\."([^"]+)"\s+AS ENUM/g)].map(([, schemaName, typeName]) => `${schemaName}.${typeName}`).sort(),
  ['billing.UsageReservationCompensationDisposition', 'billing.UsageReservationCompensationReason'],
  'only ARCH-028 compensation enums may be created',
);
for (const required of [
  'UsageReservation_compensation_fields_all_or_none_check',
  'UsageReservation_compensationUsageEventId_key',
  'ConversationMessage_providerFailureCode_check',
  'PlatformBillingPolicy_whatsappRecipientSuppressionDays_check',
  'WhatsAppRecipientReachability_recipient_check',
  'WhatsAppRecipientReachability_suppression_check',
  'WhatsAppRecipientReachability_shopId_recipient_key',
  'WhatsAppRecipientReachability_shopId_suppressUntil_idx',
  'arch028_assert_reservation_compensation',
  'arch028_usage_reservation_compensation_guard',
  'arch028_usage_event_compensation_guard',
]) assert.ok(activeSql.includes(required), `${required} missing from active migration SQL`);
for (const invariant of [
  /original\."shopId"\s*=\s*reservation\."shopId"/,
  /original\."metric"\s*=\s*'RECOVERY_CONVERSATION'/,
  /original\."quantity"\s*>\s*0/,
  /correction\."quantity"\s*=\s*-original\."quantity"/,
  /correction\."correctionOfUsageEventId"\s*=\s*original\."id"/,
  /DEFERRABLE INITIALLY DEFERRED/,
]) assert.match(activeSql, invariant);

const message = model('ConversationMessage');
assert.match(message, /^\s*providerFailureCode\s+String\?\s+@db\.VarChar\(64\)/m);
assert.match(message, /^\s*failedAt\s+DateTime\?/m);
const reachability = model('WhatsAppRecipientReachability');
for (const field of ['shopId', 'shop', 'recipient', 'lastProviderFailureCode', 'lastFailureAt', 'suppressUntil', 'lastSuccessfulAt', 'version', 'createdAt', 'updatedAt']) {
  assert.match(reachability, new RegExp(`^\\s*${field}\\s`, 'm'), `reachability.${field} missing`);
}
assert.match(reachability, /@@unique\(\[shopId, recipient\]\)/);
assert.match(reachability, /@@index\(\[shopId, suppressUntil\]\)/);
assert.match(reachability, /@@schema\("whatsapp"\)/);
assert.match(model('Shop'), /^\s*whatsappRecipientReachability\s+WhatsAppRecipientReachability\[\]/m);
assert.match(model('PlatformBillingPolicy'), /^\s*whatsappRecipientSuppressionDays\s+Int\s+@default\(7\)/m);
const reservation = model('UsageReservation');
for (const field of ['compensationUsageEventId', 'compensationUsageEvent', 'compensationReason', 'compensationDisposition', 'compensatedAt']) {
  assert.match(reservation, new RegExp(`^\\s*${field}\\s`, 'm'), `UsageReservation.${field} missing`);
}
assert.match(model('UsageEvent'), /^\s*compensatedReservation\s+UsageReservation\?/m);
for (const [name, expected] of [
  ['UsageReservationCompensationReason', ['WHATSAPP_RECIPIENT_UNDELIVERABLE']],
  ['UsageReservationCompensationDisposition', ['RESTORED_SPENDABLE', 'HELD_FOR_REFUND', 'HISTORICAL_ONLY']],
]) {
  const values = enumBody(name).match(/^\s+[A-Z][A-Z_]+\s*$/gm)?.map(value => value.trim());
  assert.deepEqual(values, expected, `${name} values differ`);
}
assert.match(enumBody('RecoveryAdmissionBlockReason'), /^\s+WHATSAPP_RECIPIENT_SUPPRESSED\s*$/m);
assert.doesNotMatch(schema, /unreachable|refundCancellation|makeGood/i, 'ARCH-028 must not add permanent reachability or refund/make-good state');

console.log('ARCH-028 WhatsApp failure/reachability schema and migration checks passed.');