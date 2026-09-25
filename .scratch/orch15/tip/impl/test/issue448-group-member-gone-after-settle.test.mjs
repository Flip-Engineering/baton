// Issue #448 — the `group_member_gone` attention row stopped appearing for a stopped member under
// a declared failure policy, and the red pin that noticed (swarm-coupling.test.mjs) could not say
// which input had moved. The input is the GROUP ROSTER: since issue #395 the `swarm.participant_left`
// fold evicts the settled seat from every group it was a member of (impl/src/swarm-state.mjs,
// "a group's `members` always lists seats that can act"), so the failure policy's derivation — which
// walked `swarm.groups[groupId].members` — could no longer see the very death the row exists to
// announce. `swarm.stop` settles membership through that same fold (#350), so every stopped member
// went silent.
//
// The row must survive the WHOLE settle, including the release an organiser runs afterwards: the
// `assignment_holder_gone` row every gone holder mints names `swarm.holder_released` as its remedy,
// and that release frees the member's holds — which is what makes the dependents most in need of
// being told, never a reason to stop telling them. This row stops a member, releases its holds,
// and asserts the row is still there with its dependent work.
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs, the shape the #422/#423 lanes
// use), carrying the swarm-coupling scenario — group `impl`, W-B declared on W-A, once the policy
// is declared over the group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue448-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'gone', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `gone-${++key}` }), ...args }, caller);
  const seat = (participantId) => call('recruit', { participantId, objective: `Build ${participantId}` });
  const update = (event, payload) => call('update', { event, payload });
  // The coupled subgroup: two builders in ONE group, one work item each, W-B declared on W-A, and
  // the declared failure policy over the group (the swarm-coupling scenario, on the light harness).
  const coupled = async () => {
    await call('create', { purpose: 'Tell the dependents (#448)' });
    await seat('alpha');
    await seat('beta');
    await update('swarm.work_updated', { workId: 'W-A', objective: 'Part A' });
    await update('swarm.work_updated', { workId: 'W-B', objective: 'Part B' });
    await update('swarm.assignment_updated', { assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A', status: 'active' });
    await update('swarm.assignment_updated', { assignmentId: 'as-beta', participantId: 'beta', workId: 'W-B', status: 'active' });
    await update('swarm.group_updated', { groupId: 'impl', members: ['alpha', 'beta'], purpose: 'builders' });
    await update('swarm.work_updated', { workId: 'W-B', objective: 'Part B', dependsOn: [{ workId: 'W-A' }] });
    await update('swarm.coupling_updated', { couplingId: 'policy-impl', coupling: 'failure',
      action: 'declare', groupId: 'impl', policy: 'independent' });
  };
  const goneRow = (view) => view.attention.find((row) => row.kind === 'group_member_gone') ?? null;
  return { store, runtime, workers, call, update, coupled, goneRow };
}

test('448: a stopped member of a policy-coupled group still names its dependents after the settle releases its holds', async (t) => {
  const f = fixture(t);
  await f.coupled();

  // The member's runtime dies. The stop settles membership — the seat reads left, and the group
  // roster eviction is recorded ON the group row (#395 evidence this test leans on).
  const stopped = await f.call('stop', { participantId: 'alpha', reason: 'runtime lost' });
  assert.equal(stopped.leftReason, 'stopped');
  let view = await f.call('view');
  const group = view.groups.find((row) => row.groupId === 'impl');
  assert.deepEqual(group.members, ['beta'], 'the stopped seat no longer holds a group seat');
  assert.deepEqual(group.departed.map((row) => row.participantId), ['alpha'],
    'the group row records the eviction the failure policy must still read');

  // The row the policy owes the dependents: the gone member, and the work declared on its work.
  assert.deepEqual(f.goneRow(view), { kind: 'group_member_gone', couplingId: 'policy-impl',
    groupId: 'impl', participantId: 'alpha', policy: 'independent', dependentWork: ['W-B'] },
  'a stopped member of a failure-coupled group is named with its dependent work');

  // The organiser runs the remedy every gone-holder row names: the seats are released, so the
  // member's holds are freed — and the row the dependents read must not go with them.
  const released = await f.call('update', { event: 'swarm.holder_released',
    payload: { participantId: 'alpha', reason: 'runtime is gone; seats released' } });
  assert.deepEqual(released.released.assignments, ['as-alpha'], 'the held assignment is released');
  view = await f.call('view');
  assert.equal(view.assignments['as-alpha'].status, 'released', 'the hold really was freed');
  assert.deepEqual(f.goneRow(view), { kind: 'group_member_gone', couplingId: 'policy-impl',
    groupId: 'impl', participantId: 'alpha', policy: 'independent', dependentWork: ['W-B'] },
  'the released hold does not silence the row: the dependents are still told');

  // The independent peer continues, and releasing the policy ends the coupling truth — the row
  // belongs to the declaration, so it goes with it.
  assert.equal(view.participants.find((row) => row.participantId === 'beta').status, 'active');
  await f.update('swarm.coupling_updated', { couplingId: 'policy-impl', coupling: 'failure',
    action: 'release', reason: 'integration window over' });
  view = await f.call('view');
  assert.equal(f.goneRow(view), null, 'a released policy mints no row');
});
