// swarm-seat-completion.test.mjs — issue #332: a seat whose worker exited after its
// recorded final contribution with a terminal turn_completed (or a boundary pause with no
// pending guidance) settles to a distinct completed state on swarm.view — status stays
// active, runtime.state reads 'completed' — instead of staying active with a dead runtime
// and raising participant_runtime_dead. participant_runtime_dead is raised only for a
// runtime that died without a terminal row or mid-turn; a completed seat still accepts
// swarm stop and --resume-from; the wake feed's dead class never wakes on a completion.
// Fixture pattern from cli-crash-stderr-tail.test.mjs (a real CoordinationStore under a
// controllable coordinator plus the wired lastCrash port), hermetic, no provider.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const seatOf = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t, { lastCrash } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-seat-completion-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const guides = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async (workerId, message) => {
      guides.push({ workerId, message });
      // The real coordinator lands the nudge on the message lane; the view reads pending
      // guidance from that same durable row.
      store.recordMessage('message.sent', { kind: 'nudge', to: { workerId }, from: 'owner',
        messageId: `nudge-${guides.length}`, body: message }, { actor: 'owner', key: `nudge-${guides.length}` });
      return { ok: true };
    },
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
    ...(lastCrash === undefined ? {} : { lastCrash }),
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'done' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `done-${++key}` }),
      ...args }, caller);
  const recruit = (participantId) => call('recruit', { participantId, objective: `Finish as ${participantId}` });
  // The seat publishes its final contribution the way a finishing worker does.
  const publish = (worker) => call('update',
    { event: 'swarm.contribution_recorded', payload: { contributionId: 'final', body: 'The work is done.' } },
    seatOf(worker.id));
  const workerOf = (participantId) => workers.find((row) => row.runId === store.swarm('done').participants[participantId].runId);
  // A clean terminal turn: the process exited with no crash row and no recorded failure.
  const cleanExit = (worker, status = 'exited') => {
    worker.status = status;
    worker.terminalCause = null;
  };
  return { store, workers, guides, coordinator, runtime, owner, call, recruit, publish, workerOf, cleanExit };
}

const rowOf = (view, participantId) => view.participants.find((entry) => entry.participantId === participantId);
const deadRowOf = (view, participantId) => view.attention.find((entry) => entry.kind === 'participant_runtime_dead'
  && entry.participantId === participantId);

test('#332: a seat that exited after its final contribution reads completed, not dead', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Settle completions' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  f.cleanExit(worker, 'exited');

  const view = await f.call('view');
  const row = rowOf(view, 'builder');
  assert.equal(row.status, 'active');
  assert.deepEqual(row.runtime, { workerId: worker.id, state: 'completed', turn: null, live: false });
  assert.equal(deadRowOf(view, 'builder'), undefined, 'a completion raises no dead-runtime row');
});

test('#332: a completion after a resident restart reads completed, not orphaned-dead', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Survive a restart' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  // After a restart every replayed handle reads orphaned until recovery resolves it.
  f.cleanExit(worker, 'orphaned');

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'completed');
  assert.equal(deadRowOf(view, 'builder'), undefined, 'an orphaned completion is not a dead runtime');
});

test('#332: a boundary pause with no pending guidance settles completed on exit', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Park at the boundary' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  worker.paused = true;
  f.cleanExit(worker, 'exited');

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'completed');
  assert.equal(deadRowOf(view, 'builder'), undefined, 'a boundary pause with nothing pending is a completion');
});

test('#332: a pause with pending guidance still pages dead', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Steer the paused seat' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  worker.paused = true;
  await f.call('guide', { participantId: 'builder', message: 'One more thing.' });
  // The steering was never answered: the process exited with the pause still pending.
  worker.paused = true;
  f.cleanExit(worker, 'exited');

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'exited');
  assert.deepEqual(deadRowOf(view, 'builder'),
    { kind: 'participant_runtime_dead', participantId: 'builder', state: 'exited' });
});

test('#332: a runtime that died mid-turn still raises participant_runtime_dead', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Die mid-turn' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  crashes.set(worker.id, { error: 'exited 1 (null)', stderrTail: null });
  worker.status = 'dead';
  worker.terminalCause = null;

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'dead');
  assert.deepEqual(deadRowOf(view, 'builder'),
    { kind: 'participant_runtime_dead', participantId: 'builder', state: 'dead' });
});

test('#332: a recorded failure cause vetoes completion', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Fail the turn' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  worker.status = 'exited';
  worker.terminalCause = { kind: 'provider_failure', code: 'provider_crashed' };

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'exited');
  assert.deepEqual(deadRowOf(view, 'builder'),
    { kind: 'participant_runtime_dead', participantId: 'builder', state: 'exited' });
});

test('#332: completion needs positive clean evidence — unknown crash authority stays dead', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Unknown exit' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  worker.status = 'exited';

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'exited');
  assert.deepEqual(deadRowOf(view, 'builder'),
    { kind: 'participant_runtime_dead', participantId: 'builder', state: 'exited' },
    'without a wired crash read the view cannot tell a clean exit from a vanish, so it pages');
});

test('#332: an exited seat with no recorded contribution still pages dead', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Vanish quietly' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  f.cleanExit(worker, 'exited');

  const view = await f.call('view');
  assert.equal(rowOf(view, 'builder').runtime.state, 'exited');
  assert.deepEqual(deadRowOf(view, 'builder'),
    { kind: 'participant_runtime_dead', participantId: 'builder', state: 'exited' },
    'a clean exit that published nothing is indistinguishable from a mid-turn death, so it pages');
});

test('#332: a completed seat still accepts swarm stop', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Stop a completion' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  f.cleanExit(worker, 'exited');
  assert.equal(rowOf(await f.call('view'), 'builder').runtime.state, 'completed');

  const stopped = await f.call('stop', { participantId: 'builder', reason: 'already done' });
  assert.equal(stopped.participantId, 'builder');
  const view = await f.call('view');
  // Issue #350: a stop settles membership; on a completed seat the settled reason IS the
  // completion, chosen by the derivation the view and the stop share.
  assert.equal(rowOf(view, 'builder').status, 'left', 'a stop settles the membership');
  assert.equal(rowOf(view, 'builder').leftReason, 'completed', 'a stop on a completed seat records the completion');
});

test('#332: a completed seat still serves --resume-from', async (t) => {
  const crashes = new Map();
  const f = fixture(t, { lastCrash: (workerId) => crashes.get(workerId) ?? null });
  await f.call('create', { purpose: 'Resume a completion' });
  await f.recruit('builder');
  const worker = f.workerOf('builder');
  await f.publish(worker);
  f.cleanExit(worker, 'exited');
  assert.equal(rowOf(await f.call('view'), 'builder').runtime.state, 'completed');

  const resumed = await f.call('recruit', { participantId: 'builder-2', objective: 'Continue', resumeFrom: 'builder' });
  assert.equal(resumed.participantId, 'builder-2');
  const brief = f.store.swarm('done').participants['builder-2'].brief;
  assert.ok(brief.includes('Last checkpoint: none was recorded'), 'the successor inherits the empty checkpoint line');
  assert.equal(rowOf(await f.call('view'), 'builder').runtime.state, 'completed');
});

test('#332: the wake feed dead class never wakes on a completion', async (t) => {
  assert.equal(wakeClassFor({ kind: 'swarm.contribution_recorded',
    payload: { swarmId: 's', participantId: 'a', contributionId: 'c' } })?.wakeClass,
    'contribution_recorded');
  assert.equal(wakeClassFor({ kind: 'turn.paused', payload: {} })?.wakeClass, 'paused');
  assert.equal(wakeClassFor({ kind: 'evidence.mapped', payload: { kind: 'turn.paused' } })?.wakeClass, 'paused');
  assert.equal(wakeClassFor({ kind: 'lifecycle.exited', payload: {} }), null, 'a clean exit is not a wake row at all');
  assert.equal(wakeClassFor({ kind: 'evidence.mapped', payload: { kind: 'lifecycle.crashed' } })?.wakeClass,
    'dead', 'only a crash row wakes the dead class');
});
