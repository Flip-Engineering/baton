// issue #140 — the waitingOn projection's coordination lookups want only the LAST matching
// event (plan.version_proposed; task.dispatch_deferred — the deferral receipt is
// idempotency-keyed per task, `task.dispatch_deferred:<taskId>:<taskCreatedSeq>`, so re-skips
// never re-mint and the last match is the only match). The lookup serves every run view /
// outline projection and every runs.list item, and waves.progress polls it per member per
// cycle, so the read walks backwards from the eventCursor() tail in clone-free eventsView
// windows until the predicate matches or seq 1 is reached: exact (a bounded window alone is
// not), and the cost tracks the distance from the tail to the match.
//
// ROW INVENTORY
//   (a) EQUIVALENCE   lastCoordinationEvent returns the same event events(1).findLast
//                     returns, on a real-store fixture ledger whose last match sits far
//                     behind the tail — payload-filtered, kind-only, tail-adjacent, at
//                     seq 1, and no match at all.
//   (b) BOUNDED READ  through projectWaitingOn against an instrumented store face: the
//                     projection issues zero events() calls and every eventsView window is
//                     bounded by WAITING_ON_TAIL_SCAN_CHUNK, while the projected plan_approval
//                     and capacity_ceiling values keep the issue #10 vocabulary shapes; a
//                     tail-adjacent match resolves inside a single window.
//   (c) HONEST WALK   the no-receipt arm still resolves: the scan reaches seq 1 in bounded
//                     windows and projects dispatch_pending with since = task.created.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CoordinationStore } from '../src/coordination-store.mjs';
import {
  lastCoordinationEvent,
  projectWaitingOn,
  WAITING_ON_TAIL_SCAN_CHUNK,
} from '../src/application-observation.mjs';

const FILLER = 'scratch.read'; // a real ledger kind whose fold carries no plan/task projection weight
let fixtureKeySeq = 0;

function fixtureStore(t, repoId) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue140-${repoId}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new CoordinationStore(root, { repoId, clock: () => '2026-09-20T00:00:00.000Z' });
}

// The fixture seeds the store's ledger array directly: the write path binds goal/plan rows to
// a full cryptographically validated chain (goal digests, plan heads, context-call validation)
// that the waitingOn read path never looks at, and the read path under test here —
// eventCursor(), eventsView(), events() — is the store's own code over this same array.
function appendEvent(store, kind, payload) {
  const event = Object.freeze({
    schemaVersion: 1, seq: store._events.length + 1, ts: '2026-09-20T00:00:00.000Z',
    kind, actor: 'fixture:issue140', idempotencyKey: `fixture:issue140:${fixtureKeySeq += 1}`,
    payload: Object.freeze(structuredClone(payload)),
  });
  store._events.push(event);
  return event;
}

function fill(store, count) {
  for (let index = 0; index < count; index += 1) appendEvent(store, FILLER, { index });
}

// seq 1  plan-a v1, seq 2 plan-a v2 (the LAST plan-a match), seq 3 the only task-a deferral
// receipt — all ~16 windows behind the tail; distractors (task-b receipt, plan-c proposal)
// sit one half-window behind the tail; the rest is filler.
function farBehindTailStore(t) {
  const store = fixtureStore(t, 'far');
  appendEvent(store, 'plan.version_proposed', { plan: { planId: 'plan-a', version: 1 } });
  appendEvent(store, 'plan.version_proposed', { plan: { planId: 'plan-a', version: 2 } });
  appendEvent(store, 'task.dispatch_deferred', { taskId: 'task-a', vendor: 'mock', ceiling: 2, inFlight: 1 });
  fill(store, 16 * WAITING_ON_TAIL_SCAN_CHUNK);
  appendEvent(store, 'task.dispatch_deferred', { taskId: 'task-b', vendor: 'grok', ceiling: 1, inFlight: 3 });
  appendEvent(store, 'plan.version_proposed', { plan: { planId: 'plan-c', version: 9 } });
  fill(store, Math.floor(WAITING_ON_TAIL_SCAN_CHUNK / 2));
  return store;
}

function instrumented(store) {
  const calls = [];
  const coordination = {
    eventCursor: () => store.eventCursor(),
    eventsView: (fromSeq, limit) => {
      calls.push({ read: 'eventsView', fromSeq, limit });
      return store.eventsView(fromSeq, limit);
    },
    events: (fromSeq = 1, limit = null) => {
      calls.push({ read: 'events', fromSeq, limit });
      return store.events(fromSeq, limit);
    },
    task: (id) => store.task(id),
  };
  return { driver: { coordination }, calls };
}

function assertBoundedReads(calls, context) {
  const fullReads = calls.filter((call) => call.read === 'events');
  assert.deepEqual(fullReads, [],
    `${context}: the projection reads the ledger through the bounded face only — full reads: ${JSON.stringify(fullReads)}`);
  assert.ok(calls.length > 0, `${context}: the projection reads the ledger`);
  for (const call of calls) {
    assert.ok(Number.isSafeInteger(call.limit) && call.limit >= 1 && call.limit <= WAITING_ON_TAIL_SCAN_CHUNK,
      `${context}: every window is bounded by WAITING_ON_TAIL_SCAN_CHUNK (${WAITING_ON_TAIL_SCAN_CHUNK}): ${JSON.stringify(call)}`);
  }
}

test('a140 (a): lastCoordinationEvent equals events(1).findLast on every lookup shape, with the last match far behind the tail', (t) => {
  const store = farBehindTailStore(t);
  const driver = { coordination: store };
  const planA = (event) => event.kind === 'plan.version_proposed' && event.payload?.plan?.planId === 'plan-a';
  const anyPlan = (event) => event.kind === 'plan.version_proposed';
  const taskA = (event) => event.kind === 'task.dispatch_deferred' && event.payload?.taskId === 'task-a';
  const nothing = () => false;
  for (const predicate of [planA, anyPlan, taskA, nothing]) {
    const expected = store.events(1).findLast(predicate) ?? null;
    assert.deepEqual(lastCoordinationEvent(driver, predicate), expected,
      'the bounded reverse scan returns the event the full-log findLast returns');
  }
  assert.equal(lastCoordinationEvent(driver, planA)?.seq, 2, 'the LAST plan-a proposal is the superseded v2 far behind the tail');
  assert.equal(lastCoordinationEvent(driver, anyPlan)?.payload?.plan?.planId, 'plan-c', 'the tail-adjacent distractor is the kind-only last match');
  assert.equal(lastCoordinationEvent(driver, taskA)?.payload?.taskId, 'task-a', 'the only task-a receipt is the match');
  assert.equal(lastCoordinationEvent(driver, nothing), null, 'a no-match walk to seq 1 reads null');
});

test('a140 (a2): an empty ledger and a match at seq 1 both read exactly', (t) => {
  const store = fixtureStore(t, 'edge');
  const driver = { coordination: store };
  assert.equal(lastCoordinationEvent(driver, () => true), null, 'an empty ledger reads null');
  appendEvent(store, 'plan.version_proposed', { plan: { planId: 'plan-a', version: 1 } });
  assert.equal(lastCoordinationEvent(driver, (event) => event.kind === 'plan.version_proposed')?.seq, 1,
    'a match at seq 1 is found');
});

test('a140 (b1): the plan_approval arm projects the far-behind proposal through bounded windows', (t) => {
  const store = farBehindTailStore(t);
  const { driver, calls } = instrumented(store);
  const view = projectWaitingOn(driver, { plan: { planId: 'plan-a', version: 2 } }, 'awaiting_plan_approval', null, [], null);
  assert.deepEqual(view, {
    kind: 'plan_approval',
    since: { eventSeq: 2, turnEpoch: null },
    detail: { planVersion: 2, proposalSeq: 2 },
  }, 'the projected plan_approval keeps the issue #10 shape over the bounded read');
  assertBoundedReads(calls, 'plan_approval');
});

test('a140 (b2): a tail-adjacent plan match resolves inside a single bounded window', (t) => {
  const store = farBehindTailStore(t);
  const { driver, calls } = instrumented(store);
  const view = projectWaitingOn(driver, { plan: null }, 'awaiting_plan_approval', null, [], null);
  assert.deepEqual(view, {
    kind: 'plan_approval',
    since: { eventSeq: 3 + 16 * WAITING_ON_TAIL_SCAN_CHUNK + 2, turnEpoch: null },
    detail: { planVersion: 9, proposalSeq: 3 + 16 * WAITING_ON_TAIL_SCAN_CHUNK + 2 },
  }, 'the kind-only lookup finds the nearest proposal to the tail');
  assertBoundedReads(calls, 'plan_approval kind-only');
  assert.equal(calls.length, 1, `the walk stops at the first window: ${JSON.stringify(calls)}`);
  const scanned = calls.reduce((total, call) => total + call.limit, 0);
  assert.ok(scanned <= WAITING_ON_TAIL_SCAN_CHUNK && scanned < store.eventCursor(),
    `the read costs one window, not the ledger: ${scanned} of ${store.eventCursor()} rows`);
});

test('a140 (b3): the capacity_ceiling arm projects the deferral receipt through bounded windows', (t) => {
  const store = farBehindTailStore(t);
  const { driver, calls } = instrumented(store);
  const task = { id: 'task-a', status: 'pending', vendorRequested: 'mock', createdEvent: 3 };
  const view = projectWaitingOn(driver, null, null, task, [], null);
  assert.deepEqual(view, {
    kind: 'capacity_ceiling',
    since: { eventSeq: 3, turnEpoch: null },
    detail: { vendor: 'mock', ceiling: 2, inFlight: 1 },
  }, 'the projected capacity_ceiling keeps the issue #10 shape over the bounded read');
  assertBoundedReads(calls, 'capacity_ceiling');
});

test('a140 (c): with no receipt the walk reaches seq 1 in bounded windows and projects dispatch_pending', (t) => {
  const store = fixtureStore(t, 'noreceipt');
  fill(store, 2);
  const { driver, calls } = instrumented(store);
  const task = { id: 'task-none', status: 'pending', vendorRequested: 'mock', createdEvent: 2 };
  const view = projectWaitingOn(driver, null, null, task, [], null);
  assert.deepEqual(view, {
    kind: 'dispatch_pending',
    since: { eventSeq: 2, turnEpoch: null },
    detail: { vendorRequested: 'mock', reason: 'pre-dispatch' },
  }, 'the no-receipt arm keeps the honest dispatch_pending projection');
  assertBoundedReads(calls, 'dispatch_pending');
  const scanned = calls.reduce((total, call) => total + call.limit, 0);
  assert.equal(scanned, store.eventCursor(),
    'exactness walks the full distance to seq 1 when nothing matches');
});
