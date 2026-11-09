import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const name = `moda-arch068-${randomUUID()}`;
const target = '20261109210000_arch068_conversation_delivery_plan';
const root = new URL('../prisma/migrations/', import.meta.url);
const docker = (args, input) => execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sql = (db, input) => docker(['exec', '-i', name, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], input).trim();
function seed(db) {
  sql(db, `INSERT INTO commerce."Shop"(id,domain,"updatedAt") VALUES('shop','fixture.example',now());
INSERT INTO whatsapp."Conversation"(id,"shopId",type,"updatedAt") VALUES('conversation','shop','PRODUCT_DISCOVERY',now());
INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"providerMessageId") VALUES('legacy','conversation','OUTBOUND','AGENT','legacy body','receipt');`);
}
function checks(db) {
  assert.equal(sql(db, `SELECT "outboundPresentation" IS NULL FROM whatsapp."ConversationMessage" WHERE id='legacy'`), 't');
  assert.equal(sql(db, `SELECT is_nullable||':'||data_type||':'||coalesce(column_default,'none') FROM information_schema.columns WHERE table_schema='whatsapp' AND table_name='ConversationMessage' AND column_name='outboundPresentation'`), 'YES:jsonb:none');
  const image = { schemaVersion: 1, kind: 'IMAGE', body: 'Frozen caption 🌳', image: { schemaVersion: 1, shopId: 'shop', productId: 'tree', variantId: null, publicUrl: `https://media.example/conversation-products/v1/${'b'.repeat(64)}/${'c'.repeat(64)}/${'a'.repeat(64)}.jpg`, objectKey: `conversation-products/v1/${'b'.repeat(64)}/${'c'.repeat(64)}/${'a'.repeat(64)}.jpg`, contentSha256: 'a'.repeat(64), contentType: 'image/jpeg', byteLength: 512, width: 1125, height: 600 } };
  const text = { schemaVersion: 1, kind: 'TEXT', body: 'Text only' };
  for (const [id, plan] of [['text', text], ['image', image]]) {
    sql(db, `INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content,"outboundPresentation") VALUES('${id}','conversation','OUTBOUND','AGENT','${plan.body}','${JSON.stringify(plan)}'::jsonb)`);
    assert.deepEqual(JSON.parse(sql(db, `SELECT "outboundPresentation" FROM whatsapp."ConversationMessage" WHERE id='${id}'`)), plan);
    assert.equal(sql(db, `SELECT "contentType"||':'||("providerMediaId" IS NULL)::text FROM whatsapp."ConversationMessage" WHERE id='${id}'`), 'TEXT:true');
  }
  sql(db, `INSERT INTO whatsapp."ConversationMessage"(id,"conversationId",direction,"senderType",content) VALUES('old-writer','conversation','OUTBOUND','AGENT','still works')`);
  assert.equal(sql(db, `SELECT "outboundPresentation" IS NULL FROM whatsapp."ConversationMessage" WHERE id='old-writer'`), 't');
  // JSON shape/body/provenance validation intentionally remains application-owned.
  assert.equal(sql(db, `SELECT "providerMessageId"||':'||content FROM whatsapp."ConversationMessage" WHERE id='legacy'`), 'receipt:legacy body');
  console.log(`PASS ${db}: nullable/no-default JSONB, legacy/old writer compatibility, TEXT/IMAGE roundtrips and existing receipt/media semantics`);
}
try {
  docker(['run', '-d', '--name', name, '--label', 'moda.task=ARCH-068-DATABASE-001', '--network', 'none', '-e', 'POSTGRES_PASSWORD=fixture-only', '-e', 'POSTGRES_DB=fresh', 'pgvector/pgvector:pg17']);
  let ready = false;
  for (let i = 0; i < 30; i++) { try { sql('fresh', 'SELECT 1'); ready = true; break; } catch { await delay(500); } }
  assert.ok(ready, 'isolated PostgreSQL becomes ready');
  sql('fresh', 'CREATE DATABASE upgrade');
  const names = readdirSync(root).filter(n => /^\d{14}_/.test(n)).sort();
  assert.equal(names.at(-1), target);
  for (const db of ['fresh', 'upgrade']) {
    for (const n of names) {
      if (n === target && db === 'upgrade') {
        seed(db);
        const before = sql(db, 'SELECT to_jsonb(m) FROM whatsapp."ConversationMessage" m');
        sql(db, readFileSync(new URL(`${n}/migration.sql`, root), 'utf8'));
        assert.deepEqual(JSON.parse(sql(db, 'SELECT to_jsonb(m)-\'outboundPresentation\' FROM whatsapp."ConversationMessage" m')), JSON.parse(before));
      } else sql(db, readFileSync(new URL(`${n}/migration.sql`, root), 'utf8'));
    }
    if (db === 'fresh') seed(db);
    checks(db);
  }
} finally { docker(['rm', '-f', name]); console.log('Invocation-owned disposable PostgreSQL removed'); }
