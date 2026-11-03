import assert from 'node:assert/strict';

export function assertColumnShape(columns, { schema, table, name, length }) {
  const column = columns.find(item => item.schema === schema && item.table === table && item.name === name);
  assert.ok(column, `${schema}.${table}.${name} exists`);
  assert.equal(column.length, length);
  assert.equal(column.nullable, true);
  assert.equal(column.defaultValue, null);
}

export function assertRejected(run, label, expected = /23514|23505/) {
  try { run(); } catch (error) {
    assert.match(String(error.stderr ?? error.message), expected, `${label}: unexpected database error`);
    return;
  }
  assert.fail(`${label}: PostgreSQL accepted a forbidden write`);
}

export function assertSameRows(before, after, label) {
  assert.deepEqual(after, before, `${label}: existing row values changed`);
}
