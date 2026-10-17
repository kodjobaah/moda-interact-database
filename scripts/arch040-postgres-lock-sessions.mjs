import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// Deliberately run each contender in a separate PostgreSQL backend. The loser
// must be observed waiting on a real row lock, not just delayed by a JS timer.
export function session(dbArgs, name) {
  const child = spawn('docker', dbArgs(), { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '', exited = false, sequence = 0;
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { error += chunk; });
  child.on('close', () => { exited = true; });
  child.on('error', (err) => { error += String(err); exited = true; });
  async function send(statement) {
    const marker = `__arch040_${name}_${++sequence}__`;
    child.stdin.write(`${statement}\nSELECT '${marker}';\n`);
    for (let i = 0; i < 200; i++) {
      if (output.includes(marker)) return;
      if (exited) throw new Error(`PostgreSQL session ${name} exited: ${error}`);
      await sleep(25);
    }
    throw new Error(`PostgreSQL session ${name} did not finish: ${error}\n${output}`);
  }
  async function close() {
    if (!child.stdin.destroyed) child.stdin.end();
    for (let i = 0; i < 200 && !exited; i++) await sleep(25);
    assert.ok(exited, `${name}: psql must exit`);
    assert.equal(error, '', `${name}: unexpected PostgreSQL error`);
  }
  return { send, close, name };
}

export async function waitBlocked(scalar, name) {
  const escaped = name.replaceAll("'", "''");
  for (let i = 0; i < 150; i++) {
    if (scalar(`SELECT count(*) FROM pg_stat_activity
      WHERE application_name='${escaped}' AND wait_event_type='Lock'
      AND cardinality(pg_blocking_pids(pid))>0`) === '1') return;
    await sleep(30);
  }
  throw new Error(`${name} never blocked on PostgreSQL row lock`);
}
