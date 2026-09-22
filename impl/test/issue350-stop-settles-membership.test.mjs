// Issue #350 — swarm.stop never settles the seat: stops closed the runtime but wrote
// no membership row, so stopped seats kept reading status:active and every "active"
// predicate (brief peers, scopeOverlap, roster intersection, closed_with_live_participants,
// holder checks, the #332 completion derivation) counted the dead. The repair: a stop
// records the seat's terminal membership (swarm.participant_left, reason stopped|completed)
// through the existing fold, and every can-still-act predicate reads one helper.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const seatOf = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue350-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: 'a'.repeat(40), ref: `refs/baton/checkpoints/${'a'.repeat(40)}` }),
    checkContribution: async () => ({ passed: true, sha: 'a'.repeat(40), attempt: { cleanup: { state: 'closed' } } }),
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'settle' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `settle-${++key}` }),
      ...args }, caller);
  const recruit = (participantId, options = {}) => call('recruit', {
    participantId, objective: `Work as ${participantId}`,
    ...(Object.keys(options).length ? { options } : {}),
  });
  const rowOf = (view, participantId) => view.participants.find((entry) => entry.participantId === participantId);
  return { store, workers, runtime, call, recruit, rowOf };
}

test('350a: swarm.stop settles membership — the seat reads status left with leftReason stopped', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Settle stops' });
  await f.recruit('alpha');
  await f.call('stop', { participantId: 'alpha', reason: 'Session no longer needed' });

  const left = f.store.eventsView().filter((event) => event.kind === 'swarm.participant_left'
    && event.payload?.participantId === 'alpha');
  assert.equal(left.length, 1, 'one stop writes one membership row');
  assert.equal(left[0].payload.reason, 'stopped');

  const view = await f.call('view', { projection: 'participants' });
  const row = f.rowOf(view, 'alpha');
  assert.equal(row.status, 'left');
  assert.equal(row.leftReason, 'stopped');
});

test('350a2: stopping a #332-completed seat settles it as completed, not stopped', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Settle completions' });
  await f.recruit('builder');
  const worker = f.workers[0];
  await f.call('update',
    { event: 'swarm.contribution_recorded', payload: { contributionId: 'final', body: 'The work is done.' } },
    seatOf(worker.id));
  worker.status = 'exited';
  worker.terminalCause = null;
  await f.call('stop', { participantId: 'builder', reason: 'already done' });

  const view = await f.call('view', { projection: 'participants' });
  const row = f.rowOf(view, 'builder');
  assert.equal(row.status, 'left');
  assert.equal(row.leftReason, 'completed');
});

test('350b: a recruit after the stop answers scopeOverlap without the stopped seat', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Advise live scopes only' });
  await f.recruit('alpha', { scope: ['impl/a'] });
  const before = await f.recruit('probe1', { scope: ['impl/a'] });
  assert.deepEqual(before.scopeOverlap,
    [{ swarmId: 'settle', participantId: 'alpha', paths: ['impl/a'] }],
    'before the stop the advisory names the live seat');

  await f.call('stop', { participantId: 'alpha', reason: 'done' });
  const after = await f.recruit('probe2', { scope: ['impl/a'] });
  assert.deepEqual(after.scopeOverlap,
    [{ swarmId: 'settle', participantId: 'probe1', paths: ['impl/a'] }],
    'after the stop the advisory names only seats that can still act');
});

test('350c: the brief after the stop omits the seat from Peers and carries the settled count', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Brief live peers only' });
  await f.recruit('alpha', { scope: ['impl/a'] });
  await f.recruit('probe1', { scope: ['impl/a'] });
  const firstBrief = f.store.swarm('settle').participants.probe1.brief;
  assert.ok(firstBrief.includes('- alpha'), 'before the stop the recruit is told alpha works beside it');

  await f.call('stop', { participantId: 'alpha', reason: 'done' });
  await f.recruit('probe2', { scope: ['impl/a'] });
  const brief = f.store.swarm('settle').participants.probe2.brief;
  const peers = brief.split('## Swarm situation')[1] ?? '';
  assert.equal(peers.includes('- alpha'), false, 'a stopped seat is not presented as a live peer');
  assert.ok(peers.includes('- probe1'), 'live seats are still presented as peers');
  assert.ok(brief.includes('1 seat has completed or stopped since the base; their contributions are on the view'),
    'one separate line names the settled history');
});

test('350d: a group synchronization point no longer awaits the stopped seat', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Barriers consume released seats' });
  await f.recruit('alpha');
  await f.recruit('beta');
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'g', members: ['alpha', 'beta'] } });
  await f.call('update', { event: 'swarm.coupling_updated',
    payload: { couplingId: 'c', coupling: 'synchronization', groupId: 'g', name: 'checkpoint', action: 'declare' } });
  const open = (await f.call('view')).couplings.find((row) => row.couplingId === 'c');
  assert.deepEqual(open.awaiting, ['alpha', 'beta']);

  await f.call('stop', { participantId: 'alpha', reason: 'done' });
  const settled = (await f.call('view')).couplings.find((row) => row.couplingId === 'c');
  assert.deepEqual(settled.awaiting, ['beta'], 'a stopped seat never holds the point open');
  assert.deepEqual(settled.departed, ['alpha'], 'a stopped seat is named as departed, never counted');
});

test('350e: a stopped holder releases — its assignments are freed by holder_released', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Release stopped holders' });
  await f.recruit('alpha');
  await f.call('update', { event: 'swarm.work_updated', payload: { workId: 'w', objective: 'Carry the work' } });
  await f.call('update', { event: 'swarm.assignment_updated',
    payload: { assignmentId: 'a', participantId: 'alpha', workId: 'w', status: 'active' } });
  await f.call('stop', { participantId: 'alpha', reason: 'done' });

  const released = await f.call('update', { event: 'swarm.holder_released', payload: { participantId: 'alpha' } });
  assert.deepEqual(released.released.assignments, ['a']);
});

test('350f: a closed swarm with only stopped seats raises no closed_with_live_participants', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Close around the settled' });
  await f.recruit('alpha');
  await f.recruit('beta');
  await f.call('stop', { participantId: 'alpha', reason: 'done' });
  await f.call('update', { event: 'swarm.closed', payload: { reason: 'objective met' } });

  const view = await f.call('view');
  const closed = view.attention.rows.find((row) => row.kind === 'closed_with_live_participants');
  assert.deepEqual(closed?.participantIds ?? null, ['beta'],
    'only seats that can still act keep a closed swarm live');
});
