// Work-holder updates (issue #345): a recruited seat with contribute authority may move the
// work item it holds (status, basis, progress notes) but never dependsOn and never another
// seat's work; swarm.recruit takes an optional workId that assigns the seat on join.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SHA = 'a'.repeat(40);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue345-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const cards = new Map([
    ['mock-session', { prompt: 'native', steer: 'native' }],
  ]);
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [...cards.entries()].map(([name, verbs]) => ({ name, card: { verbs } })),
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async (workerId, { contributionId }) =>
      ({ contributionId, workerId, sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } }),
  };
  const ports = {
    store, coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async () => ({ state: 'closed' }),
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  return { store, runtime, workers, call };
}

async function swarmWithWork(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'Holder progress' });
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'work-332', objective: 'Foundation part' } });
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'work-331', objective: 'Dependent part', dependsOn: [{ workId: 'work-332' }] } });
  return f;
}

// (a) a recruited seat with contribute updates the work it holds and the row is attributed to it.
test('a seat holding work updates its status, basis and progress notes with contribute authority', async (t) => {
  const f = await swarmWithWork(t);
  await f.call('recruit', { participantId: 'muse-337', objective: 'Build the foundation', workId: 'work-332' });
  const seat = principal('w-1');
  // Progress notes on the held item: the objective text moves with contribute authority.
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'work-332', objective: 'Foundation part — half done, wiring remains' } }, seat);
  let view = await f.call('view', {}, seat);
  assert.equal(view.work['work-332'].objective, 'Foundation part — half done, wiring remains');
  assert.equal(view.work['work-332'].actor, 'worker:w-1',
    'the progress row lands attributed to the seat that reported it');
  // Status with cited basis: the seat publishes, the root accepts, the seat marks done.
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'contribution-foundation-1', participantId: 'muse-337',
      workId: 'work-332', body: 'Foundation implemented' } }, seat);
  await f.call('update', { event: 'swarm.contribution_reviewed',
    payload: { contributionId: 'contribution-foundation-1', decision: 'accept', reason: 'verified' } });
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'work-332', status: 'completed',
      basis: { contributionIds: ['contribution-foundation-1'] } } }, seat);
  view = await f.call('view', {}, seat);
  assert.equal(view.work['work-332'].status, 'completed');
  assert.equal(view.work['work-332'].actor, 'worker:w-1');
});

// (b) the same seat is refused on another seat's work with the named rule and field.
test("a seat is refused on work it does not hold with the work-holder-or-organize rule", async (t) => {
  const f = await swarmWithWork(t);
  await f.call('recruit', { participantId: 'muse-337', objective: 'Build the foundation', workId: 'work-332' });
  await f.call('recruit', { participantId: 'muse-338', objective: 'Build the dependent', workId: 'work-331' });
  const seat = principal('w-1');
  await assert.rejects(
    f.call('update', { event: 'swarm.work_updated',
      payload: { workId: 'work-331', objective: 'taking over the other seat' } }, seat),
    (error) => {
      assert.equal(error.code, 'swarm_permission_required');
      assert.equal(error.detail?.field, 'workId');
      assert.equal(error.detail?.rule, 'work-holder-or-organize');
      return true;
    });
  const view = await f.call('view');
  assert.equal(view.work['work-331'].objective, 'Dependent part', 'the refused update changed nothing');
});

// (c) the seat is refused when its update names dependsOn, even on its own work.
test('a seat is refused when its update names dependsOn, even on the work it holds', async (t) => {
  const f = await swarmWithWork(t);
  await f.call('recruit', { participantId: 'muse-337', objective: 'Build the foundation', workId: 'work-332' });
  const seat = principal('w-1');
  await assert.rejects(
    f.call('update', { event: 'swarm.work_updated',
      payload: { workId: 'work-332', dependsOn: [{ workId: 'work-331' }] } }, seat),
    (error) => {
      assert.equal(error.code, 'swarm_permission_required');
      assert.equal(error.detail?.field, 'workId');
      assert.equal(error.detail?.rule, 'work-holder-or-organize');
      return true;
    });
});

// (d) a recruit with workId reads as the holder on swarm.view and the brief names the assignment.
test('a recruit with workId is assigned on join and briefed from the assignment', async (t) => {
  const f = await swarmWithWork(t);
  await f.call('recruit', { participantId: 'muse-337', objective: 'Build the foundation', workId: 'work-332' });
  const view = await f.call('view');
  const assignments = Object.values(view.assignments);
  assert.equal(assignments.length, 1, 'the runtime wrote the assignment row itself');
  assert.equal(assignments[0].participantId, 'muse-337');
  assert.equal(assignments[0].workId, 'work-332');
  assert.equal(assignments[0].status, 'active');
  assert.ok(view.work['work-332'], 'the assigned work reads on the work slice');
  const brief = f.store.swarm('baton').participants['muse-337'].brief;
  assert.match(brief, /work-332/u, 'the brief names the assigned work item');
});

// (e) a recruit with an unknown workId refuses work_not_found pre-effect.
test('a recruit naming an unknown work item refuses work_not_found with nothing recorded', async (t) => {
  const f = await swarmWithWork(t);
  await assert.rejects(
    f.call('recruit', { participantId: 'ghost', objective: 'Haunt nothing', workId: 'work-nope' }),
    { code: 'work_not_found' });
  assert.equal(Object.hasOwn(f.store.swarm('baton').participants, 'ghost'), false,
    'the refused recruit joined nobody');
  assert.equal(Object.keys(f.store.swarm('baton').assignments).length, 0,
    'the refused recruit assigned nothing');
});

// (f) the holder's done releases a dependent's waitsOn through the existing derivation.
test("the holder completing its work settles the dependent's waitsOn", async (t) => {
  const f = await swarmWithWork(t);
  await f.call('recruit', { participantId: 'muse-337', objective: 'Build the foundation', workId: 'work-332' });
  const seat = principal('w-1');
  let view = await f.call('view');
  assert.deepEqual(view.work['work-331'].waitsOn, [{ workId: 'work-332', settled: false, evidence: [] }]);
  await f.call('update', { event: 'swarm.contribution_recorded',
    payload: { contributionId: 'contribution-foundation-1', participantId: 'muse-337',
      workId: 'work-332', body: 'Foundation implemented' } }, seat);
  await f.call('update', { event: 'swarm.contribution_reviewed',
    payload: { contributionId: 'contribution-foundation-1', decision: 'accept', reason: 'verified' } });
  await f.call('update', { event: 'swarm.work_updated',
    payload: { workId: 'work-332', status: 'completed',
      basis: { contributionIds: ['contribution-foundation-1'] } } }, seat);
  view = await f.call('view');
  assert.equal(view.work['work-332'].status, 'completed', 'the holder moved its own item to done');
  assert.deepEqual(view.work['work-331'].waitsOn,
    [{ workId: 'work-332', settled: true, evidence: ['contribution-foundation-1'] }],
    'the dependent wait settles from the same evidence the holder completed with');
});

// The wake feed already classifies a seat's progress row: pin the class.
test("a seat's progress row wakes the work_updated class", async (t) => {
  const row = wakeClassFor({ kind: 'swarm.work_updated',
    payload: { swarmId: 'baton', workId: 'work-332' } });
  assert.ok(row, 'swarm.work_updated classifies on the wake feed');
  assert.equal(row.wakeClass, 'work_updated');
});
