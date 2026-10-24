import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT } from './arch047-template-persistence-contract.mjs';

const migrationPath = fileURLToPath(new URL('../prisma/migrations/20261024133000_arch047_template_persistence/migration.sql', import.meta.url));
const predecessorPath = fileURLToPath(new URL('../prisma/migrations/20261023173000_arch047_whatsapp_template_audit_actions/migration.sql', import.meta.url));
const collapse = s => s.replace(/\s+/g, ' ').trim();
const stripComments = s => s.replace(/--[^\n]*/g, '');
const quoteList = s => s.split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
function splitSqlColumns(source) {
  let depth = 0; let begin = 0; let quoted = false;
  const pieces = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '"') quoted = !quoted;
    if (quoted) continue;
    if (source[i] === '(') depth += 1;
    if (source[i] === ')') depth -= 1;
    if (source[i] === ',' && depth === 0) {
      pieces.push(source.slice(begin, i).trim()); begin = i + 1;
    }
  }
  pieces.push(source.slice(begin).trim());
  return pieces.filter(Boolean);
}
function nativeType(declaration) {
  const type = declaration.split(/\s+/)[0];
  const nullable = type.endsWith('?');
  let sqlType;
  if (type.startsWith('String')) {
    const match = declaration.match(/@db\.VarChar\((\d+)\)/);
    sqlType = match ? `VARCHAR(${match[1]})` : 'TEXT';
  } else if (type.startsWith('Int')) sqlType = 'INTEGER';
  else if (type.startsWith('Json')) sqlType = 'JSONB';
  else if (type.startsWith('DateTime')) {
    const precision = declaration.match(/@db\.Timestamptz\((\d+)\)/);
    sqlType = precision ? `TIMESTAMPTZ(${precision[1]})` : 'TIMESTAMP(3)';
  } else return null; // relation fields are not columns
  let result = sqlType;
  if (declaration.includes('@default(now())')) result += ' DEFAULT CURRENT_TIMESTAMP';
  else if (declaration.includes('@default(0)')) result += ' DEFAULT 0';
  else if (declaration.includes('@default(1)')) result += ' DEFAULT 1';
  if (!nullable) result += ' NOT NULL';
  return result;
}
function schemaOf(name) {
  if (name === 'Shop' || name === 'CommerceTranslationModelConfiguration') return 'commerce';
  if (name === 'PlatformAdmin') return 'public';
  return 'whatsapp';
}
function expectedFk(model, field, declaration) {
  const attr = declaration.match(/@relation\((.+)\)/)?.[1];
  if (!attr || !attr.includes('fields:')) return null;
  const target = declaration.split(/\s+/)[0].replaceAll('?', '').replaceAll('[', '').replaceAll(']', '');
  const relationColumns = key => {
    const start = attr.indexOf(`${key}: [`);
    const end = attr.indexOf(']', start);
    return start < 0 || end < 0 ? [] : quoteList(attr.slice(start + key.length + 3, end));
  };
  const sourceColumns = relationColumns('fields');
  const refColumns = relationColumns('references');
  assert.ok(sourceColumns.length && refColumns.length, `Malformed ${model}.${field} relation contract`);
  return [schemaOf(model), model, sourceColumns.join(','), schemaOf(target), target, refColumns.join(','),
    (attr.match(/onDelete:\s*(\w+)/)?.[1] ?? 'NoAction').toUpperCase().replace('SETNULL','SET NULL'),
    (attr.match(/onUpdate:\s*(\w+)/)?.[1] ?? 'Cascade').toUpperCase().replace('SETNULL','SET NULL')].join('|');
}
function expectedIndexesFor(model, declarations) {
  const indexes = [];
  for (const [field, declaration] of Object.entries(declarations.fields)) {
    if (/\s@unique(?:\s|$)/.test(declaration)) indexes.push(`unique:${field}`);
  }
  for (const line of declarations.directives) {
    const match = line.match(/^@@(unique|index)/);
    const open = line.indexOf('[');
    const close = line.lastIndexOf(']');
    if (match && open >= 0 && close > open) {
      indexes.push(`${match[1]}:${line.slice(open + 1, close).replace(/\s+/g, '')}`);
    }
  }
  return indexes;
}
function extractAuditCase(source) {
  const match = source.match(/ADD CONSTRAINT "arch020_audit_targets"\s+CHECK\s*\(CASE\b([\s\S]*?)\bEND\s*\)/);
  assert.ok(match, 'Missing existing CommerceAuditEvent arch020_audit_targets CHECK');
  return match[1];
}
export function validateMigrationText(input, predecessorInput = readFileSync(predecessorPath, 'utf8')) {
  const sql = stripComments(input);
  const predecessor = stripComments(predecessorInput);
  assert.match(sql, /^\s*BEGIN\s*;/, 'ARCH-047 migration must begin a transaction');
  assert.match(sql, /COMMIT\s*;\s*$/, 'ARCH-047 migration must commit');
  assert.doesNotMatch(sql, /\bCREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|TRIGGER|PROCEDURE)\b/i,
    'No ARCH-047 business triggers, SQL functions or stored procedures');
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE\s+"|DELETE FROM|TRUNCATE|DROP TABLE)\b/i,
    'ARCH-047 persistence migration must never seed or rewrite legacy data');
  assert.doesNotMatch(sql, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*\bWHERE\b/i,
    'No state-dependent partial/conditional unique indexes');

  const created = [...sql.matchAll(/\bCREATE TABLE\s+"([^"]+)"\."([^"]+)"\s*\(([\s\S]*?)\);/g)];
  const expectedNames = Object.keys(CONTRACT.models);
  assert.deepEqual(created.map(m => `${m[1]}.${m[2]}`).sort(),
    expectedNames.map(name => `whatsapp.${name}`).sort(),
    'CREATE TABLE must create exactly the 11 task-defined whatsapp tables, without obsolete release/Meta history tables');
  const fkExpected = [];
  const indexesExpected = [];
  for (const [, , modelName, content] of created) {
    const contract = CONTRACT.models[modelName];
    const columns = new Map(); let pkCount = 0;
    for (const piece of splitSqlColumns(content)) {
      if (/^CONSTRAINT\s+/i.test(piece)) {
        const pk = piece.match(/^CONSTRAINT\s+"([^"]+)"\s+PRIMARY KEY\s*\(\s*"([^"]+)"\s*\)$/);
        assert.ok(pk, `${modelName}: unexpected constraint (only technical PK is permitted): ${piece}`);
        assert.equal(pk[2], Object.entries(contract.fields).find(([, d]) => /\s@id(?:\s|$)/.test(d))?.[0],
          `${modelName}: wrong primary key field`);
        pkCount += 1;
      } else {
        const match = piece.match(/^"([^"]+)"\s+(.+)$/);
        assert.ok(match, `${modelName}: malformed CREATE TABLE column ${piece}`);
        assert.ok(!columns.has(match[1]), `${modelName}.${match[1]} is duplicated`);
        columns.set(match[1], collapse(match[2]));
      }
    }
    assert.equal(pkCount, 1, `${modelName}: missing primary key`);
    const expectedColumns = Object.fromEntries(Object.entries(contract.fields)
      .map(([field, decl]) => [field, nativeType(decl)]).filter(([, type]) => type !== null));
    assert.deepEqual([...columns.keys()].sort(), Object.keys(expectedColumns).sort(),
      `${modelName}: incorrect columns (including unexpected wabaId or obsolete releaseId)`);
    for (const [field, type] of Object.entries(expectedColumns)) {
      assert.equal(columns.get(field), type, `${modelName}.${field}: wrong SQL type, nullability or default`);
    }
    for (const [field, declaration] of Object.entries(contract.fields)) {
      const fk = expectedFk(modelName, field, declaration);
      if (fk) fkExpected.push(fk);
    }
    indexesExpected.push(...expectedIndexesFor(modelName, contract).map(x => `whatsapp.${modelName}|${x}`));
  }
  const addVariant = [...sql.matchAll(/\bALTER TABLE\s+"whatsapp"\."WhatsAppTemplateVariant"\s+ADD COLUMN\s+"([^"]+)"\s+([^;]+);/g)];
  assert.equal(addVariant.length, 1, 'Exactly one additive legacy-variant column is allowed');
  assert.equal(addVariant[0][1], 'metaRegistrationId', 'Only legacy variant metaRegistrationId may be added');
  assert.equal(collapse(addVariant[0][2]), 'TEXT',
    'WhatsAppTemplateVariant.metaRegistrationId must be nullable TEXT with no default');
  fkExpected.push(expectedFk('WhatsAppTemplateVariant', 'metaRegistration',
    CONTRACT.existingFields.WhatsAppTemplateVariant.metaRegistration));
  indexesExpected.push('whatsapp.WhatsAppTemplateVariant|index:metaRegistrationId');

  const fks = [...sql.matchAll(/\bALTER TABLE\s+"([^"]+)"\."([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+"([^"]+)"\."([^"]+)"\s*\(([^)]+)\)\s+ON DELETE\s+(RESTRICT|SET NULL|CASCADE|NO ACTION)\s+ON UPDATE\s+(RESTRICT|SET NULL|CASCADE|NO ACTION)\s*;/g)];
  const fkKeys = fks.map(m => [m[1], m[2], quoteList(m[4]).join(','), m[5], m[6], quoteList(m[7]).join(','), m[8], m[9]].join('|'));
  assert.deepEqual(fkKeys.sort(), fkExpected.sort(),
    'FK declarations must match every relation target/column and onDelete/onUpdate action');
  // Catch malformed unparsed foreign keys; all are required technical relations.
  assert.equal((sql.match(/\bFOREIGN KEY\s*\(/g) ?? []).length, fks.length,
    'Malformed or incomplete FK DDL');

  const indexes = [...sql.matchAll(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\."([^"]+)"\s*\(([^)]+)\)\s*;/g)];
  const indexKeys = indexes.map(m => `${m[3]}.${m[4]}|${m[1] ? 'unique' : 'index'}:${quoteList(m[5]).join(',')}`);
  assert.deepEqual(indexKeys.sort(), indexesExpected.sort(),
    'All technical unique constraints/indexes and exact compound keys (including shop+language) must match');
  assert.equal((sql.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/g) ?? []).length, indexes.length,
    'Unexpected/nonstandard index DDL');
  const names = indexes.map(m => `${m[3]}.${m[2]}`);
  assert.equal(new Set(names).size, names.length, 'Duplicate SQL index identities');
  assert.ok(indexes.every(m => Buffer.byteLength(m[2], 'utf8') <= 63), 'PostgreSQL index identifiers must not be truncated implicitly');
  const tableChecks = created.some(m => /\bCHECK\s*\(/.test(m[3]));
  assert.ok(!tableChecks, 'No new template business CHECK constraints');
  const allChecks = (sql.match(/\bCHECK\s*\(/g) ?? []).length;
  assert.equal(allChecks, 1, 'Only the inherited arch020_audit_targets CHECK may be recreated');

  const additions = [...sql.matchAll(/\bALTER TYPE\s+"commerce"\."CommerceAuditAction"\s+ADD VALUE IF NOT EXISTS\s+'([^']+)'\s*;/g)].map(m => m[1]);
  assert.deepEqual(additions.sort(), [...CONTRACT.actions].sort(),
    'Append exactly the ten new CommerceAuditAction labels; preserve six old labels in the predecessor');
  assert.equal((sql.match(/\bALTER TYPE\s+"commerce"\."CommerceAuditAction"\s+ADD VALUE/g) ?? []).length,
    additions.length, 'Unsupported audit enum mutation');
  assert.match(sql, /ALTER TABLE "commerce"\."CommerceAuditEvent" DROP CONSTRAINT "arch020_audit_targets"\s*;/,
    'Recreate existing exhaustive audit-target CHECK, do not introduce another audit table');
  const priorCase = extractAuditCase(predecessor);
  const actualCase = extractAuditCase(sql);
  const neutral = actualCase.match(/\bWHEN\s+"action"::text\s+IN\s*\(([^)]+)\)\s+THEN true\b/);
  assert.ok(neutral, 'New template audit actions must use neutral THEN true branch');
  assert.deepEqual([...neutral[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort(), [...CONTRACT.actions].sort(),
    'Neutral audit branch must cover exactly the ten new actions');
  const oldCase = actualCase.replace(neutral[0], '');
  assert.equal(collapse(oldCase), collapse(priorCase),
    'Historic arch020_audit_targets CASE branches (including six variant actions) must remain identical');
  return { tables: created.length, fks: fks.length, indexes: indexes.length, enumAdditions: additions.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--migration');
  const selected = index < 0 ? migrationPath : process.argv[index + 1];
  assert.ok(selected, '--migration requires a path');
  const result = validateMigrationText(readFileSync(selected, 'utf8'));
  console.log(`ARCH-047 migration DDL PASS: ${result.tables} tables, ${result.fks} FKs, ${result.indexes} indexes, ${result.enumAdditions} audit actions`);
}
