// Issue #457: a seat's DEFAULT swarm.view over the native bridge must ANSWER.
//
// Observed at 1a830bfe (swarm-primary-20260918): four seats — including the #306 sub-orchestrator,
// whose whole job is to watch and review its builders — lost their FIRST read to a
// `swarm_bridge_frame_exceeded` refusal. The bridge buffers one JSON frame per direction, measured
// the answer, and refused whenever the whole record did not fit its `wire.frame` ceiling. That is
// the right answer for a caller that NAMED an oversize projection; for the default read it makes
// the reading half (#441) fail at its first step on exactly the swarms that matter.
//
// The law this file pins (the #349 rule applied to the frame the bridge itself negotiated):
//   • the DEFAULT read (no `projection`) answers the widest projection that measurably fits,
//     loudly: `narrowed {from: 'full', to, reason: 'bridge-frame'}` rides the answer;
//   • `participants` / `contributions` PAGE through the #343 walk the resident already serves —
//     one derivation, the same cursor token, the same `page {cursor, next, total, served,
//     ceiling}` record — so a seat walks a swarm larger than one frame;
//   • an EXPLICIT projection that does not fit still refuses, naming the slice that fits, and the
//     durable refusal row carries `detail.fits` — what the seat was told (#457 owed 3);
//   • a handler that THROWS crosses with its class and a bounded text and is recorded as
//     `bridge.handler_threw`, never a bare catch-all (carried from #458).
//
// Red-first at HEAD: the default read refuses, `narrowed` does not exist, a participants read has
// no page record, the refusal row carries no `fits`, and a thrown handler loses its class.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_VIEW_PROJECTION_NAMES, projectSwarmView } from '../src/swarm-contract.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const SHA = 'e'.repeat(40);
// A frame small enough that a real swarm exceeds it — the negotiated ceiling is per deployment,
// and the seats in the observation ran against a swarm that did not fit the default one either.
const FRAME = 8192;
// The paging fixture's frame: sized so the walk serves whole rows per page (the #343 derivation
// measures a page through the MCP envelope MIRROR, which counts the answer twice).
const PAGE_FRAME = 24 * 1024;
const CONTRIBUTION_FRAME = 16 * 1024;

/** The exact bytes one success envelope costs on the wire — the measure the bridge's own frame
 * bound is enforced against, so a test reads fit the way the bridge does. */
const frameBytes = (result) => Buffer.byteLength(JSON.stringify({ ok: true, result }), 'utf8');

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
 * test can measure what the bridge measured without asking it to repeat itself. */
function principalFor(f, participantId) {
  const worker = f.workers.find((row) => row.runId === f.store.swarm('baton').participants[participantId].runId);
  return { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: worker.id };
}

/** A swarm with `participants` seats and a bridge token issued for the first one, over the REAL
 * runtime — the fixture pattern swarm-bridge-truth.test.mjs uses, at a frame the swarm exceeds. */
async function linked(t, {
  maxFrameBytes = FRAME, participants = 1, objectiveBytes = 0, contributionBodies = [],
} = {}) {
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
    maxFrameBytes,
  });
  t.after(async () => { await bridge.close(); });
  const runId = f.store.swarm('baton').participants.alpha.runId;
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'alpha', runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });
  return { ...f, bridge, issued, send, runId };
}

test('457-a: an over-bound DEFAULT read answers narrowed — the seat\'s first look is never refused', async (t) => {
  const f = await linked(t, { contributionBodies: ['x'.repeat(16 * 1024)] });
  const seat = await f.call('view', {}, principalFor(f, 'alpha'));
  assert.ok(frameBytes(seat) > FRAME, 'the fixture really exceeds the bridge frame');

  const answer = await f.send('swarm.view', { swarmId: 'baton' });
  assert.ok(frameBytes(answer) <= FRAME, 'the served answer fits the negotiated ceiling');
  assert.equal(answer.swarmId, 'baton');
  assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes(answer.projection));
  assert.notEqual(answer.projection, 'full', 'the whole record did not fit: a slice was served');
  assert.deepEqual(answer.narrowed, { from: 'full', to: answer.projection, reason: 'bridge-frame' },
    'the answer names the narrowing it applied, loudly (#349)');
  assert.ok(Array.isArray(answer.participants)
    && answer.participants.some((row) => row.participantId === 'alpha'),
  'the frame and the rows the served slice keeps still ride');
  assert.equal(answer.participants.find((row) => row.participantId === 'alpha').lastRefusal, null,
    'the seat\'s own row carries no refusal: its read was answered');

  // The widest slice that fits — with the narrowing record itself, which also costs bytes.
  const ranked = SWARM_VIEW_PROJECTION_NAMES
    .filter((name) => name !== 'full')
    .map((name) => ({ name, bytes: frameBytes({ ...projectSwarmView(seat, name), narrowed: answer.narrowed }) }))
    .filter((row) => row.bytes <= FRAME)
    .sort((left, right) => right.bytes - left.bytes);
  assert.equal(ranked[0].name, answer.projection,
    'the served slice is the WIDEST that measurably fits, never a thinner one than it had to be');

  assert.deepEqual(refusalRows(f.store), [],
    'an answered read records nothing: no refusal, no row');
});

test('457-b: an EXPLICIT over-size projection still refuses, naming the slice that fits', async (t) => {
  const f = await linked(t, { contributionBodies: ['x'.repeat(16 * 1024)] });

  // The default read is answered (457-a's law) on the very fixture that refuses the named one.
  const answered = await f.send('swarm.view', { swarmId: 'baton' });
  assert.ok(answered.narrowed, 'the default read answers rather than refusing');

  const refusal = await f.send('swarm.view', { swarmId: 'baton', projection: 'full' })
    .then(() => null, (error) => error);
  assert.equal(refusal.code, 'swarm_bridge_frame_exceeded');
  assert.equal(refusal.status, 413);
  assert.equal(refusal.detail.direction, 'response');
  assert.equal(refusal.detail.rule, 'bridge-frame');
  assert.equal(refusal.detail.requested, 'full');
  assert.equal(refusal.detail.value, FRAME, 'the ceiling is the bridge\'s own negotiated bound');
  assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes(refusal.detail.fits)
    && refusal.detail.fits !== 'full', 'a real, narrower projection is named');
  assert.ok(refusal.detail.fitsBytes <= FRAME, 'the named slice MEASURABLY fits the ceiling');
  assert.match(refusal.message.split('\n')[0],
    new RegExp(`^Nothing was recorded: ask again with projection: ${refusal.detail.fits} \\(\\d+ bytes fits `, 'u'),
    'the refusal says nothing was recorded and names the slice to ask for');

  // The advice is not a promise the bridge cannot keep: asking with it WORKS, whole and unnamed.
  const served = await f.send('swarm.view', { swarmId: 'baton', projection: refusal.detail.fits });
  assert.equal(served.projection, refusal.detail.fits);
  assert.equal(Object.hasOwn(served, 'narrowed'), false,
    'a caller that named its own slice is served that slice, never a second narrowing');
  assert.equal(f.store.swarm('baton').contributions['c-457-0'].body.length, 16 * 1024,
    'the answer was refused; the record it answered about is untouched');
});

test('457-c: participants page over the bridge with the #343 page argument, and the walk is complete', async (t) => {
  const f = await linked(t, {
    maxFrameBytes: PAGE_FRAME, participants: 8, objectiveBytes: 700,
    contributionBodies: ['x'.repeat(5 * 1024), 'y'.repeat(5 * 1024), 'z'.repeat(5 * 1024)],
  });
  const whole = await f.call('view', { projection: 'participants' }, principalFor(f, 'alpha'));
  assert.ok(frameBytes(whole) > PAGE_FRAME, 'the fixture really exceeds the bridge frame');

  const first = await f.send('swarm.view', { swarmId: 'baton', projection: 'participants' });
  assert.equal(first.projection, 'participants', 'the answer names the projection whose rows it walks');
  assert.ok(first.page !== null && typeof first.page === 'object', 'a paged answer carries its page record');
  assert.equal(first.page.cursor, null, 'the first page resumes nothing');
  assert.equal(first.page.total, whole.participants.length, 'the page counts the rows the walk serves');
  assert.ok(first.page.served >= 1 && first.page.served < whole.participants.length,
    'the first page serves part of the family, not all of it');
  assert.equal(first.page.ceiling.value, PAGE_FRAME, 'the page names the bridge\'s negotiated ceiling');
  assert.ok(first.page.next, 'the page names where the walk resumes');
  assert.ok(frameBytes(first) <= PAGE_FRAME, 'the page fits the frame it was bounded by');
  assert.ok(first.participants.every((row) => typeof row.participantId === 'string'),
    'the page serves the participant rows themselves');

  const seen = first.participants.map((row) => row.participantId);
  let page = first;
  let pages = 1;
  while (page.page.next !== null) {
    pages += 1;
    assert.ok(pages <= whole.participants.length + 1, 'the walk advances to its end');
    const cursor = page.page.next;
    page = await f.send('swarm.view', { swarmId: 'baton', projection: 'participants', cursor });
    assert.ok(frameBytes(page) <= PAGE_FRAME, 'every page fits the frame');
    assert.equal(page.page.cursor, cursor, 'the page echoes the cursor it was resumed with');
    assert.equal(page.page.total, whole.participants.length, 'the walk keeps counting the same family');
    seen.push(...page.participants.map((row) => row.participantId));
  }
  assert.equal(page.page.next, null, 'the last page names no successor');
  assert.deepEqual([...seen].sort(), whole.participants.map((row) => row.participantId).sort(),
    'the walk reproduces the whole family, row by row');
  assert.equal(new Set(seen).size, seen.length, 'no row is served twice and none is skipped');
  assert.deepEqual(refusalRows(f.store), [], 'a walk is reads: nothing is recorded, nothing refused');
});

test('457-c2: contributions page the same way, with the bodies bounded per row', async (t) => {
  const f = await linked(t, {
    maxFrameBytes: CONTRIBUTION_FRAME,
    contributionBodies: ['x'.repeat(5 * 1024), 'y'.repeat(5 * 1024), 'z'.repeat(5 * 1024)],
  });
  const whole = await f.call('view', { projection: 'contributions' }, principalFor(f, 'alpha'));
  assert.ok(frameBytes(whole) > CONTRIBUTION_FRAME, 'the fixture really exceeds the bridge frame');

  const first = await f.send('swarm.view', { swarmId: 'baton', projection: 'contributions' });
  assert.equal(first.projection, 'contributions');
  assert.equal(first.page.cursor, null);
  assert.equal(first.page.total, whole.contributions.length);
  assert.ok(first.page.served >= 1 && frameBytes(first) <= CONTRIBUTION_FRAME);

  const seen = first.contributions.map((row) => row.contributionId);
  let page = first;
  while (page.page.next !== null) {
    page = await f.send('swarm.view', { swarmId: 'baton', projection: 'contributions', cursor: page.page.next });
    seen.push(...page.contributions.map((row) => row.contributionId));
    assert.ok(frameBytes(page) <= CONTRIBUTION_FRAME);
  }
  assert.deepEqual([...seen].sort(), whole.contributions.map((row) => row.contributionId).sort(),
    'the contributions walk reproduces the family');
  const served = [...first.contributions, ...page.contributions][0];
  assert.ok(served.body.length > 0, 'each page carries the contribution body it bounded, never a blank row');
});

test('457-d: the frame refusal\'s durable row carries detail.fits — what the seat was told', async (t) => {
  const f = await linked(t, { contributionBodies: ['x'.repeat(16 * 1024)] });
  const refusal = await f.send('swarm.view', { swarmId: 'baton', projection: 'full' })
    .then(() => null, (error) => error);
  const rows = refusalRows(f.store);
  assert.equal(rows.length, 1, 'exactly one row: the refusal the bridge raised and reported');
  const row = rows[0];
  assert.deepEqual({ ...row.payload, seq: undefined }, {
    kind: 'swarm.operation_refused', swarmId: 'baton', command: 'swarm.view', event: null,
    code: 'swarm_bridge_frame_exceeded', field: null, rule: 'bridge-frame', participantId: 'alpha',
    detail: { fits: refusal.detail.fits }, seq: undefined,
  }, 'the root reads what the seat was told — the slice that would have fit — from the row itself');
  assert.ok(Number.isSafeInteger(row.seq));
});

test('457-e: a thrown handler crosses with its class and a bounded text, and is recorded as bridge.handler_threw', async (t) => {
  const f = await linked(t);
  const crashed = createSwarmNativeBridge({
    maxFrameBytes: FRAME,
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
    'and a bounded message does too — never a bare catch-all');
  assert.equal(crash.detail.rule, 'bridge.handler_threw');

  const row = refusalRows(f.store).at(-1);
  assert.equal(row.payload.code, 'swarm_bridge_dispatch_failed');
  assert.equal(row.payload.rule, 'bridge.handler_threw', 'the crash is recorded as what it was');
  assert.equal(row.payload.participantId, 'alpha');

  // A message that cannot fit the frame crosses CUT, and the answer still fits the ceiling.
  const flooding = createSwarmNativeBridge({
    maxFrameBytes: FRAME,
    dispatch: () => Promise.reject(new RangeError('z'.repeat(64 * 1024))),
  });
  t.after(async () => { await flooding.close(); });
  const floodIssued = await flooding.issue({ swarmId: 'baton', participantId: 'alpha', runId: f.runId });
  const flood = await swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: 'baton' } }, { env: floodIssued.env })
    .then(() => null, (error) => error);
  assert.equal(flood.detail.errorClass, 'RangeError');
  assert.ok(flood.detail.errorMessage.length < 64 * 1024, 'the text is bounded, not relayed whole');
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: false, error: { message: flood.message, code: flood.code, detail: flood.detail, refusalRecorded: true } }), 'utf8') <= FRAME,
    'the crash answer itself fits the frame it answers under');
});
