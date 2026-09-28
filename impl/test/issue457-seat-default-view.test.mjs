// Issue #627 removed the bridge's wire-frame byte ceiling; issue #457's seat read is the fixture
// that measures it.
//
// Issue #457 was observed at 1a830bfe (swarm-primary-20260918): the bridge buffered one JSON frame
// per direction, measured the answer against its `wire.frame` ceiling, and refused whenever the
// whole record did not fit — four seats, the #306 sub-orchestrator among them, lost their FIRST
// read to a `swarm_bridge_frame_exceeded` refusal. #457 answered that with a narrowing record and
// a page walk; #627 removed the bound itself, so a read of any size is carried whole and neither
// the narrowing record nor the walk remains.
//
// The law this file pins:
//   • the DEFAULT read (no `projection`) answers the whole record — every participant row, every
//     contribution body — whatever its size, and nothing about the answer is refused or cut;
//   • an EXPLICIT projection answers exactly that slice, whole, and the record it answers about is
//     untouched;
//   • `participants` / `contributions` carry every row of their family in ONE answer, bodies
//     whole, with no `page` record and no `narrowed` record (the shapes #457 minted);
//   • a handler that THROWS crosses with its class and its own text, whole, recorded as
//     `bridge.handler_threw` (carried from #458).
//
// Every fixture below is measured against the ceiling the bridge enforced until #627, so each row
// shows the answer really was the size the old bound refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_VIEW_PROJECTION_NAMES } from '../src/swarm-contract.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const SHA = 'e'.repeat(40);
// The wire.frame ceiling the bridge enforced until #627: the seats in the observation ran against
// a swarm that did not fit it.
const RETIRED_FRAME = 8192;
// The page frame issue #457 sized its walk with, and the frame its contributions walk used.
const RETIRED_PAGE_FRAME = 24 * 1024;
const RETIRED_CONTRIBUTION_FRAME = 16 * 1024;

/** The exact bytes one success envelope costs on the wire. */
const frameBytes = (result) => Buffer.byteLength(JSON.stringify({ ok: true, result }), 'utf8');
/** One value with the wire's own shape: what a caller reads is the JSON document, so a comparison
 * against an in-process read is made on that document. */
const onWire = (value) => JSON.parse(JSON.stringify(value));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue457-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async () => ({ sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: {} }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  return { store, runtime, workers, call };
}

const refusalRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');

/** A seat's own view, read in-process: the same slice the bridge's dispatch answered with, so a
 * test can compare the answer with the read it came from. */
function principalFor(f, participantId) {
  const worker = f.workers.find((row) => row.runId === f.store.swarm('baton').participants[participantId].runId);
  return { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: worker.id };
}

/** A swarm with `participants` seats and a bridge token issued for the first one, over the REAL
 * runtime — the fixture pattern swarm-bridge-truth.test.mjs uses, at a size the old frame refused. */
async function linked(t, { participants = 1, objectiveBytes = 0, contributionBodies = [] } = {}) {
  const f = fixture(t);
  await f.call('create', { purpose: 'A seat\'s default read answers through the bridge' });
  const ids = ['alpha', ...Array.from({ length: participants - 1 }, (_, index) => `p${index}`)];
  for (const participantId of ids) {
    await f.call('recruit', {
      participantId,
      objective: objectiveBytes > 0 ? 'o'.repeat(objectiveBytes) : `Build as ${participantId}`,
      permissions: SWARM_PERMISSIONS,
    });
  }
  for (const [index, body] of contributionBodies.entries()) {
    await f.call('update', {
      event: 'swarm.contribution_recorded',
      payload: { contributionId: `c-457-${index}`, participantId: 'alpha', body },
    });
  }
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
  });
  t.after(async () => { await bridge.close(); });
  const runId = f.store.swarm('baton').participants.alpha.runId;
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'alpha', runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });
  return { ...f, bridge, issued, send, runId };
}

test('457-a: a DEFAULT read answers the whole record, however large — the seat\'s first look is never refused', async (t) => {
  const f = await linked(t, { contributionBodies: ['x'.repeat(16 * 1024)] });
  const seat = await f.call('view', {}, principalFor(f, 'alpha'));
  assert.ok(frameBytes(seat) > RETIRED_FRAME, 'the fixture really exceeds the ceiling the bridge enforced until #627');

  const answer = await f.send('swarm.view', { swarmId: 'baton' });
  assert.ok(frameBytes(answer) > RETIRED_FRAME,
    'the answer crosses whole: the bridge wrote more than the retired ceiling without cutting or refusing it');
  assert.equal(answer.swarmId, 'baton');
  assert.equal(answer.projection, 'full', 'naming no projection answers the whole record');
  assert.equal(Object.hasOwn(answer, 'narrowed'), false,
    'nothing was narrowed: the read the caller asked for is the read it got');
  assert.equal(Object.hasOwn(answer, 'page'), false, 'a whole answer leaves nothing for a second page');
  assert.deepEqual(onWire(answer), onWire(seat),
    'the bridge answered exactly the view its dispatch read, byte for byte');
  assert.equal(answer.contributions[0].body.length, 16 * 1024,
    'the contribution body rides whole — a read is never bounded by the size of its rows');
  assert.equal(answer.participants.find((row) => row.participantId === 'alpha').lastRefusal, null,
    'the seat\'s own row carries no refusal: its read was answered');

  assert.deepEqual(refusalRows(f.store), [],
    'an answered read records nothing: no refusal, no row');
});

test('457-b: an EXPLICIT projection answers exactly that slice, whole', async (t) => {
  const f = await linked(t, { participants: 8, objectiveBytes: 700, contributionBodies: ['x'.repeat(16 * 1024)] });
  const defaulted = await f.send('swarm.view', { swarmId: 'baton' });

  const named = await f.send('swarm.view', { swarmId: 'baton', projection: 'full' });
  assert.equal(named.projection, 'full');
  assert.equal(Object.hasOwn(named, 'narrowed'), false,
    'a caller that named its own slice is served that slice, with no second narrowing');
  assert.deepEqual(onWire(named), onWire(defaulted), 'naming `full` is the default read, spelled out');

  for (const projection of SWARM_VIEW_PROJECTION_NAMES) {
    const served = await f.send('swarm.view', { swarmId: 'baton', projection });
    const own = await f.call('view', { projection }, principalFor(f, 'alpha'));
    assert.equal(served.projection, projection);
    assert.deepEqual(onWire(served), onWire(own),
      `${projection}: the bridge answers the projection the runtime built for this caller`);
  }

  assert.equal(f.store.swarm('baton').contributions['c-457-0'].body.length, 16 * 1024,
    'a read changes no record: the contribution it answered about is untouched');
  assert.deepEqual(refusalRows(f.store), [], 'no read was refused, so nothing was recorded');
});

test('457-c: a participants read answers every row of the roster in one answer', async (t) => {
  const f = await linked(t, {
    participants: 24, objectiveBytes: 700,
    contributionBodies: ['x'.repeat(5 * 1024), 'y'.repeat(5 * 1024), 'z'.repeat(5 * 1024)],
  });
  const whole = await f.call('view', { projection: 'participants' }, principalFor(f, 'alpha'));
  assert.ok(frameBytes(whole) > RETIRED_PAGE_FRAME, 'the fixture really exceeds the page frame #457 walked');

  const answer = await f.send('swarm.view', { swarmId: 'baton', projection: 'participants' });
  assert.equal(answer.projection, 'participants', 'the answer names the projection whose rows it carries');
  assert.equal(Object.hasOwn(answer, 'page'), false, 'a whole answer carries no page record');
  assert.equal(Object.hasOwn(answer, 'narrowed'), false, 'and no narrowing record');
  assert.ok(frameBytes(answer) > RETIRED_PAGE_FRAME, 'the roster crosses whole, page frame or not');
  assert.equal(answer.participants.length, whole.participants.length,
    'every seat of the family is served — a seat\'s first look answers every peer');
  assert.deepEqual(onWire(answer), onWire(whole),
    'the served rows are the roster itself: same seats, same rows, nothing dropped and nothing added');
  assert.ok(answer.participants.every((row) => typeof row.participantId === 'string'),
    'the rows served are the participant rows themselves');

  assert.deepEqual(refusalRows(f.store), [], 'a read records nothing, whatever its size');
});

test('457-c2: a contributions read answers every row with its body whole', async (t) => {
  const f = await linked(t, {
    contributionBodies: ['x'.repeat(5 * 1024), 'y'.repeat(5 * 1024), 'z'.repeat(5 * 1024)],
  });
  const whole = await f.call('view', { projection: 'contributions' }, principalFor(f, 'alpha'));
  assert.ok(frameBytes(whole) > RETIRED_CONTRIBUTION_FRAME,
    'the fixture really exceeds the page frame #457 walked the contributions walk under');

  const answer = await f.send('swarm.view', { swarmId: 'baton', projection: 'contributions' });
  assert.equal(answer.projection, 'contributions');
  assert.equal(Object.hasOwn(answer, 'page'), false, 'a whole answer carries no page record');
  assert.equal(answer.contributions.length, whole.contributions.length,
    'every contribution of the family is served in one answer');
  assert.deepEqual(onWire(answer), onWire(whole),
    'and each row is the row the runtime derived, body included');
  assert.ok(answer.contributions.every((row) => row.body.length === 5 * 1024),
    'each body rides whole: the read bounds no row');
  assert.deepEqual(refusalRows(f.store), [], 'a read records nothing, whatever its size');
});

test('457-e: a thrown handler crosses with its class and its own text, and is recorded as bridge.handler_threw', async (t) => {
  const f = await linked(t);
  const crashed = createSwarmNativeBridge({
    // The deployment's own dispatch defects on this one command: everything else still reaches the
    // runtime (the bridge's refusal report included, so the row can be recorded).
    dispatch: ({ command, args, principal, context }) => command === 'swarm.view'
      ? Promise.reject(new TypeError('view handler exploded while folding rows'))
      : f.runtime.command(command, args, principal, context),
  });
  t.after(async () => { await crashed.close(); });
  const issued = await crashed.issue({ swarmId: 'baton', participantId: 'alpha', runId: f.runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });

  const crash = await send('swarm.view', { swarmId: 'baton' }).then(() => null, (error) => error);
  assert.equal(crash.code, 'swarm_bridge_dispatch_failed');
  assert.equal(crash.status, 500, 'a handler crash is a defect of the bridge, not a refusal of the request');
  assert.equal(crash.detail.errorClass, 'TypeError', 'the error CLASS crosses');
  assert.match(crash.detail.errorMessage, /view handler exploded while folding rows/u,
    'and the cause\'s own text does too — never a bare catch-all');
  assert.equal(crash.detail.rule, 'bridge.handler_threw');

  const row = refusalRows(f.store).at(-1);
  assert.equal(row.payload.code, 'swarm_bridge_dispatch_failed');
  assert.equal(row.payload.rule, 'bridge.handler_threw', 'the crash is recorded as what it was');
  assert.equal(row.payload.participantId, 'alpha');

  // A crash text larger than any frame crosses whole: it is the one diagnostic a caller gets.
  const flooding = createSwarmNativeBridge({
    dispatch: () => Promise.reject(new RangeError('z'.repeat(64 * 1024))),
  });
  t.after(async () => { await flooding.close(); });
  const floodIssued = await flooding.issue({ swarmId: 'baton', participantId: 'alpha', runId: f.runId });
  const flood = await swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: 'baton' } }, { env: floodIssued.env })
    .then(() => null, (error) => error);
  assert.equal(flood.detail.errorClass, 'RangeError');
  assert.equal(flood.detail.errorMessage.length, 64 * 1024,
    'the text is relayed whole: a thinned diagnostic would be exactly what it hides');
  assert.equal(flood.detail.errorMessage, 'z'.repeat(64 * 1024), 'and it is the cause\'s own text, character for character');
});
