import assert from 'node:assert/strict';

// Executed after DATABASE-001 and DATABASE-002 have been proven against the
// original constraints, then DATABASE-003 has been applied in the same isolated
// PostgreSQL 17 fixture. No shared/prod database connection is accepted here.
export function runProviderReferenceCases({psql, jsonQuery, expectRejected, insertOperation, insertWooPurchase}) {
  const constraints = jsonQuery(`SELECT jsonb_build_object(
    'kindShape', (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid='billing."BillingOperation"'::regclass
        AND conname='BillingOperation_kind_shape_check'),
    'stateRefCount', (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid='billing."BillingOperation"'::regclass
        AND conname='BillingOperation_state_provider_reference_check'),
    'nonblank', (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid='billing."BillingOperation"'::regclass
        AND conname='BillingOperation_providerReference_check'),
    'writeOnceTrigger', (SELECT count(*)::int FROM pg_trigger
      WHERE tgrelid='billing."BillingOperation"'::regclass
        AND tgname='arch027_billing_operation_guard'
        AND tgenabled IN ('O', 'A') AND NOT tgisinternal),
    'writeOnceFunction', (SELECT pg_get_functiondef('billing.arch027_billing_operation_guard()'::regprocedure))
  )::text;`);
  assert.ok(constraints.kindShape, 'kind-shape constraint must survive');
  assert.doesNotMatch(constraints.kindShape, /providerReference/,
    'no operation kind may require provider evidence');
  assert.equal(constraints.stateRefCount, 0, 'state-based provider-reference requiredness must be removed');
  assert.match(constraints.nonblank, /providerReference/);
  assert.match(constraints.nonblank, /btrim/i);
  assert.equal(constraints.writeOnceTrigger, 1, 'write-once trigger must remain enabled');
  assert.match(constraints.writeOnceFunction, /providerReference is write-once/);
  console.log('PASS effective PostgreSQL catalogue: provider-neutral kind/state, nonblank check and write-once trigger');

  // Prove each operation kind in every state accepts NULL provider evidence.
  const states = ['INITIATING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'OUTCOME_UNKNOWN', 'FAILED'];
  const kinds = ['SUBSCRIPTION_CREATE', 'PLAN_SWITCH', 'ONE_TIME_CHARGE', 'CANCEL'];
  for (const kind of kinds) {
    for (const state of states) {
      const id = `arch027-db003-${kind.toLowerCase()}-${state.toLowerCase()}`;
      const params = {
        id, kind, state, key: id,
        ...(kind === 'SUBSCRIPTION_CREATE' || kind === 'PLAN_SWITCH'
          ? {planId: 'arch027-catalog-paid', amount: 1200, currency: 'USD', period: 'EVERY_30_DAYS'} : {}),
        ...(kind === 'ONE_TIME_CHARGE'
          ? {eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD', purchaseId: `${id}-purchase`} : {}),
      };
      if (kind === 'ONE_TIME_CHARGE') psql(insertWooPurchase({id: params.purchaseId}));
      psql(insertOperation(params));
    }
  }
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingOperation"
    WHERE "id" LIKE 'arch027-db003-%' AND "providerReference" IS NULL;`), kinds.length * states.length);
  console.log('PASS all 4 operation kinds x 5 states accept NULL providerReference');

  const valid = {
    kind: 'PLAN_SWITCH', planId: 'arch027-catalog-paid', amount: 1200,
    currency: 'USD', period: 'EVERY_30_DAYS',
  };
  expectRejected('blank non-null provider reference remains rejected',
    insertOperation({...valid, id: 'arch027-db003-blank', key: 'arch027-db003-blank', providerReference: ''}));
  expectRejected('whitespace-only provider reference remains rejected',
    insertOperation({...valid, id: 'arch027-db003-spaces', key: 'arch027-db003-spaces', providerReference: '   '}));
  const retained = 'arch027-db003-plan_switch-initiating';
  psql(`UPDATE billing."BillingOperation" SET "state"='AWAITING_CONFIRMATION'
    WHERE "id"='${retained}';
  UPDATE billing."BillingOperation" SET "state"='CONFIRMED'
    WHERE "id"='${retained}';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingOperation"
    WHERE "id"='${retained}' AND "state"='CONFIRMED' AND "providerReference" IS NULL;`), 1);
  console.log('PASS state transitions to AWAITING_CONFIRMATION and CONFIRMED with NULL providerReference');
  psql(`UPDATE billing."BillingOperation" SET "providerReference"='provider-new-evidence'
    WHERE "id"='${retained}';`);
  psql(`UPDATE billing."BillingOperation" SET "providerReference"='provider-new-evidence'
    WHERE "id"='${retained}';`);
  assert.equal(jsonQuery(`SELECT count(*)::int FROM billing."BillingOperation"
    WHERE "id"='${retained}' AND "providerReference"='provider-new-evidence';`), 1);
  expectRejected('existing providerReference cannot be replaced',
    `UPDATE billing."BillingOperation" SET "providerReference"='another-provider-id'
       WHERE "id"='${retained}'`);
  expectRejected('existing providerReference cannot be cleared',
    `UPDATE billing."BillingOperation" SET "providerReference"=NULL
       WHERE "id"='${retained}'`);
  console.log('PASS NULL-to-value, same-value, and rejected replace/clear invariants');

  // Retain the other shape, request-identity and purchase-ownership invariants.
  expectRejected('PLAN_SWITCH requires merchant pricing plan',
    insertOperation({id: 'arch027-db003-missing-plan', kind: 'PLAN_SWITCH', key: 'arch027-db003-missing-plan',
      amount: 1200, currency: 'USD', period: 'EVERY_30_DAYS'}));
  expectRejected('PLAN_SWITCH requires positive quote',
    insertOperation({...valid, id: 'arch027-db003-zero-amount', key: 'arch027-db003-zero-amount', amount: 0}));
  expectRejected('CANCEL cannot carry quote or plan',
    insertOperation({...valid, id: 'arch027-db003-cancel-bad', key: 'arch027-db003-cancel-bad', kind: 'CANCEL'}));
  expectRejected('ONE_TIME_CHARGE requires referenced purchase',
    insertOperation({id: 'arch027-db003-charge-no-purchase', kind: 'ONE_TIME_CHARGE', key: 'arch027-db003-charge-no-purchase',
      eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD'}));
  expectRejected('ONE_TIME_CHARGE purchase must belong to Shop',
    insertOperation({id: 'arch027-db003-charge-cross-shop', kind: 'ONE_TIME_CHARGE', key: 'arch027-db003-charge-cross-shop',
      eventId: 'arch027-catalog-free-bundle', amount: 500, currency: 'USD', purchaseId: 'arch027-woo-purchase-paid'}));
  expectRejected('quote currency still requires uppercase ISO shape',
    insertOperation({...valid, id: 'arch027-db003-bad-currency', key: 'arch027-db003-bad-currency', currency: 'usd'}));
  expectRejected('request fingerprint remains 32 bytes',
    insertOperation({...valid, id: 'arch027-db003-bad-fingerprint', key: 'arch027-db003-bad-fingerprint', digest: 31}));
  expectRejected('requestKey cannot be whitespace',
    insertOperation({...valid, id: 'arch027-db003-bad-request-key', key: '   '}));
  expectRejected('billing operation intent remains immutable',
    `UPDATE billing."BillingOperation" SET "requestKey"='altered'
       WHERE "id"='${retained}'`);
  console.log('PASS unrelated billing shape and durable-intent rules remain enforced');
}
