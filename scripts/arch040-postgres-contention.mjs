import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { session, waitBlocked } from './arch040-postgres-lock-sessions.mjs';

function takeover(id, event) {
  return `UPDATE "whatsapp"."Conversation"
     SET "controlMode"='HUMAN', "controlRevision"=1,
         "controlChangedAt"=clock_timestamp(), "updatedAt"=now()
     WHERE "id"='${id}' AND "controlMode"='AI' AND "controlRevision"=0;
   INSERT INTO "whatsapp"."ConversationControlEvent"
     ("id", "conversationId", "fromMode", "toMode", "fromRevision", "toRevision")
     VALUES ('${event}','${id}','AI','HUMAN',0,1);`;
}

function aiPermit(conversation, message, key) {
  return `WITH eligible AS (
       SELECT "id" FROM "whatsapp"."Conversation"
       WHERE "id"='${conversation}' AND "controlMode"='AI' AND "controlRevision"=0
     ), admitted AS (
       UPDATE "whatsapp"."ConversationMessage" m
       SET "providerDispatchKey"='${key}', "providerDispatchAdmittedAt"=now(),
           "providerDispatchControlRevision"=0
       FROM eligible WHERE m."id"='${message}' AND m."conversationId"=eligible."id"
         AND m."providerDispatchKey" IS NULL RETURNING m."id"
     ) SELECT count(*) FROM admitted;`;
}

function suspend(shop, suffix) {
  return `INSERT INTO "commerce"."ShopHumanMessagingRestriction"
      ("shopId", "status", "revision", "reasonCode", "suspendedAt")
      VALUES ('${shop}', 'SUSPENDED', 1, 'review-${suffix}', now());
    INSERT INTO "commerce"."ShopHumanMessagingRestrictionEvent"
      ("id", "shopId", "fromStatus", "toStatus", "revision", "reasonCode", "platformAdminId")
      VALUES ('suspend-${suffix}', '${shop}', 'ACTIVE', 'SUSPENDED', 1,
              'review-${suffix}', 'admin-040');`;
}

function humanPermit(shop, conversation, message, command, token, key) {
  // The SHOP lock must precede reading the (possibly absent) restriction row.
  // Conversation + command/message locks are taken only after that shop lock.
  return `UPDATE "whatsapp"."ConversationMessage" m
     SET "providerDispatchKey"='${key}', "providerDispatchAdmittedAt"=now(),
         "providerDispatchControlRevision"=1
     WHERE m."id"='${message}' AND m."conversationId"='${conversation}'
       AND m."providerDispatchKey" IS NULL
       AND EXISTS (SELECT 1 FROM "whatsapp"."Conversation" c
          WHERE c."id"='${conversation}' AND c."controlMode"='HUMAN' AND c."controlRevision"=1)
       AND EXISTS (SELECT 1 FROM "whatsapp"."MerchantConversationSendCommand" cmd
          WHERE cmd."id"='${command}' AND cmd."state"='CLAIMED'
            AND cmd."leaseToken"='${token}' AND cmd."leaseExpiresAt">statement_timestamp())
       AND NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestriction" r
          WHERE r."shopId"='${shop}' AND r."status"='SUSPENDED');
    UPDATE "whatsapp"."MerchantConversationSendCommand" cmd
      SET "state"='DISPATCH_ADMITTED', "providerDispatchKey"='${key}',
          "providerDispatchAdmittedAt"=now(), "providerDispatchControlRevision"=1,
          "providerDispatchRestrictionRevision"=COALESCE(
            (SELECT r."revision" FROM "commerce"."ShopHumanMessagingRestriction" r
              WHERE r."shopId"='${shop}'), 0),
          "outboundMessageId"='${message}', "leaseToken"=NULL, "leaseExpiresAt"=NULL
      WHERE cmd."id"='${command}' AND cmd."state"='CLAIMED'
        AND cmd."leaseToken"='${token}' AND cmd."leaseExpiresAt">statement_timestamp()
        AND EXISTS (SELECT 1 FROM "whatsapp"."ConversationMessage" m
          WHERE m."id"='${message}' AND m."providerDispatchKey"='${key}')
        AND NOT EXISTS (SELECT 1 FROM "commerce"."ShopHumanMessagingRestriction" r
          WHERE r."shopId"='${shop}' AND r."status"='SUSPENDED');`;
}

export async function runArch040PostgresContention({ sql, scalar, rejects, dbArgs }) {
  const hex = 'b'.repeat(64);
  sql(`INSERT INTO "commerce"."Shop" ("id","domain","updatedAt")
         VALUES ('s3','arch040-lock-order.example',now());
       INSERT INTO "commerce"."CheckoutRecovery"
         ("id","shopId","checkoutToken","lastExternalActivityAt","updatedAt") VALUES
         ('r-ai-take','s1','ai-take',now(),now()),
         ('r-ai-first','s1','ai-first',now(),now()),
         ('r-suspend','s2','human-suspend',now(),now()),
         ('r-allow','s3','human-allow',now(),now());
       INSERT INTO "whatsapp"."Conversation"
         ("id","shopId","checkoutRecoveryId","type","updatedAt") VALUES
         ('c-ai-take',NULL,'r-ai-take','RECOVERY',now()),
         ('c-ai-first',NULL,'r-ai-first','RECOVERY',now()),
         ('c-suspend',NULL,'r-suspend','RECOVERY',now()),
         ('c-allow',NULL,'r-allow','RECOVERY',now());
       INSERT INTO "whatsapp"."ConversationMessage"
         ("id","conversationId","direction","senderType","content") VALUES
         ('m-ai-take','c-ai-take','OUTBOUND','AGENT','AI blocked'),
         ('m-ai-first','c-ai-first','OUTBOUND','AUTOMATION','AI permitted'),
         ('m-suspend','c-suspend','OUTBOUND','HUMAN','Human blocked'),
         ('m-allow','c-allow','OUTBOUND','HUMAN','Human permitted');`);
  sql(`BEGIN; ${takeover('c-suspend','control-suspend')} COMMIT;
       BEGIN; ${takeover('c-allow','control-allow')} COMMIT;`);
  sql(`INSERT INTO "whatsapp"."MerchantConversationSendCommand"
      ("id","shopId","conversationId","idempotencyKey","payloadSha256",
       "expectedControlRevision","kind","recipientSnapshot","textBody","updatedAt") VALUES
      ('cmd-suspend','s2','c-suspend','suspend-send','${hex}',1,'HUMAN_TEXT','447700900002','Blocked',now()),
      ('cmd-allow','s3','c-allow','allow-send','${hex}',1,'HUMAN_TEXT','447700900003','Allowed',now());
      UPDATE "whatsapp"."MerchantConversationSendCommand"
      SET "state"='CLAIMED', "leaseToken"='suspend-worker',
          "leaseExpiresAt"=now()+interval '10 minutes', "dispatchAttemptCount"=1
      WHERE "id"='cmd-suspend';
      UPDATE "whatsapp"."MerchantConversationSendCommand"
      SET "state"='CLAIMED', "leaseToken"='allow-worker',
          "leaseExpiresAt"=now()+interval '10 minutes', "dispatchAttemptCount"=1
      WHERE "id"='cmd-allow';`);

  // Takeover wins: admission must await the Conversation lock and then reject.
  const take = session(dbArgs, 'takeover_first');
  const lateAI = session(dbArgs, 'ai_admission_late');
  try {
    await take.send(`SET application_name='${take.name}'; BEGIN;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c-ai-take' FOR UPDATE;
      ${takeover('c-ai-take','control-ai-take')}`);
    const pending = lateAI.send(`SET application_name='${lateAI.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s1' FOR UPDATE;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c-ai-take' FOR UPDATE;
      ${aiPermit('c-ai-take','m-ai-take','permit-ai-late')} COMMIT;`);
    await waitBlocked(scalar, lateAI.name);
    await take.send('COMMIT;');
    await pending;
  } finally { await Promise.all([take.close(), lateAI.close()]); }
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationMessage"
    WHERE "id"='m-ai-take' AND "providerDispatchKey" IS NOT NULL`), '0');
  assert.equal(scalar(`SELECT "controlMode" FROM "whatsapp"."Conversation"
    WHERE "id"='c-ai-take'`), 'HUMAN');

  // Admission wins: takeover subsequently commits but cannot erase the permit.
  const earlyAI = session(dbArgs, 'ai_admission_first');
  const lateTake = session(dbArgs, 'takeover_late');
  try {
    await earlyAI.send(`SET application_name='${earlyAI.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s1' FOR UPDATE;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c-ai-first' FOR UPDATE;
      ${aiPermit('c-ai-first','m-ai-first','permit-ai-first')}`);
    const pending = lateTake.send(`SET application_name='${lateTake.name}'; BEGIN;
      ${takeover('c-ai-first','control-ai-late')} COMMIT;`);
    await waitBlocked(scalar, lateTake.name);
    await earlyAI.send('COMMIT;');
    await pending;
  } finally { await Promise.all([earlyAI.close(), lateTake.close()]); }
  assert.equal(scalar(`SELECT "providerDispatchKey" FROM "whatsapp"."ConversationMessage"
    WHERE "id"='m-ai-first'`), 'permit-ai-first');
  assert.equal(scalar(`SELECT "controlMode" FROM "whatsapp"."Conversation"
    WHERE "id"='c-ai-first'`), 'HUMAN');
  rejects(`UPDATE "whatsapp"."ConversationMessage"
    SET "providerDispatchKey"='recalled' WHERE "id"='m-ai-first'`,
  'takeover cannot rewrite an already-admitted provider permit');
  console.log('PASS provider admission/takeover contention in both orders and residual permit');

  // Suspension wins while the restriction row does NOT exist at admission start.
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopHumanMessagingRestriction"
    WHERE "shopId"='s2'`), '0');
  const firstSuspend = session(dbArgs, 'suspension_first');
  const lateHuman = session(dbArgs, 'human_admission_late');
  try {
    await firstSuspend.send(`SET application_name='${firstSuspend.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s2' FOR UPDATE;
      ${suspend('s2','first')}`);
    const pending = lateHuman.send(`SET application_name='${lateHuman.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s2' FOR UPDATE;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c-suspend' FOR UPDATE;
      ${humanPermit('s2','c-suspend','m-suspend','cmd-suspend','suspend-worker','permit-blocked')}
      COMMIT;`);
    await waitBlocked(scalar, lateHuman.name);
    await firstSuspend.send('COMMIT;');
    await pending;
  } finally { await Promise.all([firstSuspend.close(), lateHuman.close()]); }
  assert.equal(scalar(`SELECT "state"||':'||coalesce("providerDispatchKey",'NULL')
    FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-suspend'`), 'CLAIMED:NULL');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationMessage"
    WHERE "id"='m-suspend' AND "providerDispatchKey" IS NOT NULL`), '0');

  // An absent row cannot race an earlier HUMAN permit because both lock Shop.
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."ShopHumanMessagingRestriction"
    WHERE "shopId"='s3'`), '0');
  const firstHuman = session(dbArgs, 'human_admission_first');
  const lateSuspend = session(dbArgs, 'suspension_late');
  try {
    await firstHuman.send(`SET application_name='${firstHuman.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s3' FOR UPDATE;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c-allow' FOR UPDATE;
      ${humanPermit('s3','c-allow','m-allow','cmd-allow','allow-worker','permit-allowed')}`);
    const pending = lateSuspend.send(`SET application_name='${lateSuspend.name}'; BEGIN;
      SELECT "id" FROM "commerce"."Shop" WHERE "id"='s3' FOR UPDATE;
      ${suspend('s3','late')} COMMIT;`);
    await waitBlocked(scalar, lateSuspend.name);
    await firstHuman.send('COMMIT;');
    await pending;
  } finally { await Promise.all([firstHuman.close(), lateSuspend.close()]); }
  assert.equal(scalar(`SELECT "state"||':'||"providerDispatchKey"
    FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-allow'`),
  'DISPATCH_ADMITTED:permit-allowed');
  assert.equal(scalar(`SELECT "status" FROM "commerce"."ShopHumanMessagingRestriction"
    WHERE "shopId"='s3'`), 'SUSPENDED');
  console.log('PASS HUMAN admission/suspension contention with absent restriction row, both orders');

  // The same outbound evidence is used for automated sequence-2 recoveries.
  sql(`UPDATE "commerce"."RecoveryOutreachAttempt" SET "initiatedBy"='AUTOMATION',
    "initiationKey"='automation-follow', "claimedAt"=now(), "updatedAt"=now()
    WHERE "id"='foreign-follow' AND "initiationKey" IS NULL;
    INSERT INTO "whatsapp"."ConversationMessage"
      ("id","conversationId","direction","senderType","content") VALUES
      ('m-automated-follow','c2','OUTBOUND','AUTOMATION','Auto follow-up');
    BEGIN;
      SELECT "id" FROM "whatsapp"."Conversation" WHERE "id"='c2' FOR UPDATE;
      UPDATE "whatsapp"."ConversationMessage"
        SET "providerDispatchKey"='permit-auto-follow',
          "providerDispatchAdmittedAt"=now(),"providerDispatchControlRevision"=0
        WHERE "id"='m-automated-follow';
      UPDATE "commerce"."RecoveryOutreachAttempt"
        SET "outboundMessageId"='m-automated-follow',"updatedAt"=now()
        WHERE "id"='foreign-follow';
    COMMIT;`);
  assert.equal(scalar(`SELECT "initiatedBy"||':'||"outboundMessageId"
    FROM "commerce"."RecoveryOutreachAttempt" WHERE "id"='foreign-follow'`),
  'AUTOMATION:m-automated-follow');
  assert.equal(scalar(`SELECT "senderType"||':'||"providerDispatchControlRevision"
    FROM "whatsapp"."ConversationMessage" WHERE "providerDispatchKey"='permit-auto-follow'`),
  'AUTOMATION:0');
  assert.equal(scalar(`SELECT count(*) FROM "commerce"."RecoveryOutreachAttempt"
    WHERE "checkoutRecoveryId"='r2' AND "sequence"=2`), '1');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."ConversationMessage"
    WHERE "conversationId"='c2' AND "providerDispatchKey"='permit-auto-follow'`), '1');
  rejects(`INSERT INTO "whatsapp"."ConversationMessage"
    ("id","conversationId","direction","senderType","content",
     "providerDispatchKey","providerDispatchAdmittedAt","providerDispatchControlRevision")
    VALUES ('duplicate-auto','c2','OUTBOUND','AUTOMATION','Duplicate','permit-auto-follow',now(),0)`,
  'automation dispatch identity cannot create a second message');
  console.log('PASS automation shares canonical dispatch evidence, no duplicate follow-up/credit/message');

  // Concurrent inserts prove the SHOP-scoped idempotency key, not a sequential replay.
  const insert = (id) => `INSERT INTO "whatsapp"."MerchantConversationSendCommand"
    ("id","shopId","conversationId","idempotencyKey","payloadSha256",
     "expectedControlRevision","kind","recipientSnapshot","textBody","updatedAt")
    VALUES ('${id}','s1','c1','concurrent-key','${hex}',3,
            'HUMAN_TEXT','447700900001','Race',now());`;
  const firstInsert = session(dbArgs, 'idempotency_first');
  const secondInsert = session(dbArgs, 'idempotency_second');
  try {
    await firstInsert.send(`SET application_name='${firstInsert.name}'; BEGIN;
      ${insert('concurrent-a')}`);
    const pending = secondInsert.send(`SET application_name='${secondInsert.name}'; BEGIN;
      ${insert('concurrent-b').replace(/;\s*$/, '')}
      ON CONFLICT ("shopId", "idempotencyKey") DO NOTHING;
      COMMIT;`);
    await waitBlocked(scalar, secondInsert.name);
    await firstInsert.send('COMMIT;');
    await pending;
  } finally { await Promise.all([firstInsert.close(), secondInsert.close()]); }
  rejects(insert('concurrent-c'), 'committed idempotency key remains reserved');
  assert.equal(scalar(`SELECT count(*) FROM "whatsapp"."MerchantConversationSendCommand"
    WHERE "shopId"='s1' AND "idempotencyKey"='concurrent-key'`), '1');

  // Reclamation invalidates an old worker's CAS token even after its former lease expires.
  sql(insert('cmd-stale').replaceAll('concurrent-key', 'stale-key'));
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand"
    SET "state"='CLAIMED',"leaseToken"='old-worker',
        "leaseExpiresAt"=now()+interval '100 milliseconds',"dispatchAttemptCount"=1
    WHERE "id"='cmd-stale';`);
  await sleep(150);
  sql(`UPDATE "whatsapp"."MerchantConversationSendCommand"
    SET "leaseToken"='new-worker',"leaseExpiresAt"=now()+interval '5 minutes',
        "dispatchAttemptCount"=2
    WHERE "id"='cmd-stale' AND "state"='CLAIMED'
      AND "leaseToken"='old-worker' AND "leaseExpiresAt"<statement_timestamp();`);
  assert.equal(scalar(`SELECT "leaseToken"||':'||"dispatchAttemptCount"
    FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-stale'`), 'new-worker:2');
  assert.equal(scalar(`WITH stale AS (UPDATE "whatsapp"."MerchantConversationSendCommand"
    SET "state"='FAILED',"leaseToken"=NULL,"leaseExpiresAt"=NULL,
        "failureCode"='STALE_COMPLETION'
    WHERE "id"='cmd-stale' AND "state"='CLAIMED' AND "leaseToken"='old-worker'
    RETURNING "id") SELECT count(*) FROM stale;`), '0');
  assert.equal(scalar(`SELECT "state"||':'||"leaseToken"||':'||coalesce("failureCode",'NULL')
    FROM "whatsapp"."MerchantConversationSendCommand" WHERE "id"='cmd-stale'`),
  'CLAIMED:new-worker:NULL');
  console.log('PASS concurrent shop/idempotency inserts and stale lease completion fencing');
}
