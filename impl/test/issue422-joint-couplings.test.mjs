// Issue #422 red-before skeleton (stage: design-not-landed): joint couplings a group holds
// without a lead — the rotating writer lease, the quorum synchronization point, and
// proposal-by-arrival — as specified by docs/45-open-coordination.md §4 and §7.
//
// Every row asserts the behaviour docs/45 specifies against the CURRENT runtime and is expected
// RED: the lease/propose/quorum vocabulary does not exist yet (today the first unlanded call
// refuses — swarm_permission_required, a closed-set action refusal, or an absent projection —
// and each row's message names what the implementer must land).
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs) plus a workspaceAttachment
// mock, so participants carry a recorded checkout (the lease coverage rule, docs/45 §4.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const WS_TEAM = `ws-${'a'.repeat(32)}`;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue422-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const starts = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    // Every seat in this file is recorded in the one team checkout: the lease's coverage has an
    // identity to compare (docs/45 §4.1), and the binding write records it (swarm-runtime.mjs).
    workspaceAttachment: () => ({ workspaceId: WS_TEAM, worktree: directory }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: false, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId) => call('recruit', { participantId, objective: `Continue working as ${participantId}` });
  const team = async () => {
    await call('create', { purpose: 'Joint couplings (#422)' });
    await recruit('alpha');
    await recruit('beta');
    await recruit('gamma');
    await call('update', { event: 'swarm.group_updated', payload: { groupId: 'team', members: ['alpha', 'beta', 'gamma'] } });
    return { alpha: principal('w-1'), beta: principal('w-2'), gamma: principal('w-3') };
  };
  const couplingRow = (view, couplingId) => (view?.couplings ?? []).find((row) => row.couplingId === couplingId) ?? null;
  return { store, runtime, workers, starts, call, recruit, team, couplingRow };
}

test('#422 RED (stage: design-not-landed): a group member with communicate declares a rotating writer lease over its own group', async (t) => {
  const f = fixture(t);
  const { alpha } = await f.team();
  // docs/45 §4.1/§4.6: declare over groupId (no participantId) by a member of the group is
  // admitted at communicate authority — no lead, no organize grant.
  const declared = await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'declare', groupId: 'team',
  } }, alpha);
  assert.equal(declared.receipt.event.kind, 'swarm.coupling_updated',
    'land the rotating writer lease: declare over groupId by a group member with communicate (docs/45 §4.1, §4.6)');
  const view = await f.call('view');
  const lease = f.couplingRow(view, 'lease-1');
  assert.ok(lease, 'land the lease record on the view (docs/45 §8)');
  assert.equal(lease.holder, null, 'land holder:null on an unheld lease (docs/45 §4.1)');
  assert.deepEqual([...lease.members].sort(), ['alpha', 'beta', 'gamma'],
    'land the declared roster snapshot on the lease record (docs/45 §4.1)');
});

test('#422 RED (stage: design-not-landed): the lease rotates — take refuses while held naming the holder, yield frees it, another member takes', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'declare', groupId: 'team',
  } }, alpha);
  const taken = await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'take',
  } }, alpha);
  assert.equal(taken.receipt.event.kind, 'swarm.coupling_updated',
    'land the take action on a writer lease (own take, contribute authority — docs/45 §4.1, §4.6)');
  assert.equal(f.couplingRow(await f.call('view'), 'lease-1').holder, 'alpha',
    'land the holder projection on the lease row (docs/45 §8)');
  await assert.rejects(f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'take',
  } }, beta), (error) => {
    assert.equal(error.code, 'swarm_writer_lease_held',
      'land the lease-held refusal for a take while held (docs/45 §4.1)');
    assert.match(error.message, /alpha/, 'the refusal names the current holder (docs/45 §4.1)');
    return true;
  });
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'yield', participantId: 'alpha',
  } }, alpha);
  assert.equal(f.couplingRow(await f.call('view'), 'lease-1').holder, null,
    'land yield: the holder frees the lease without a lead (docs/45 §4.1)');
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'take',
  } }, beta);
  const lease = f.couplingRow(await f.call('view'), 'lease-1');
  assert.equal(lease.holder, 'beta', 'land rotation: the next member takes the freed lease (docs/45 §4.1)');
  assert.equal(lease.holds.length, 2, 'land the hold history on the record (docs/45 §4.1)');
});

test('#422 RED (stage: design-not-landed): a hold whose holder left the swarm is takeable; a dead-runtime hold pages coupling_writer_gone with the yield remedy', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'declare', groupId: 'team',
  } }, alpha);
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'take',
  } }, alpha);
  // A dead-runtime holder never auto-releases: the attention row names the lease, the holder
  // and the remedy (docs/45 §4.1 — death is settled by an explicit act, §0).
  f.workers.find((row) => row.id === 'w-1').status = 'dead';
  const deadView = await f.call('view');
  const gone = (deadView.attention ?? []).find((row) => row.kind === 'coupling_writer_gone' && row.couplingId === 'lease-1');
  assert.ok(gone, 'land coupling_writer_gone for a lease whose holder runtime is dead (docs/45 §4.1)');
  assert.equal(gone.participantId, 'alpha', 'the row names the dead holder (docs/45 §4.1)');
  assert.ok(gone.next, 'the row names the remedy act — never an auto-release (docs/45 §4.1, §0)');
  // Once the holder's membership has ENDED, the fold admits the take-over without any release
  // (docs/45 §4.1 — the fold reads membership, never liveness).
  await f.call('update', { event: 'swarm.participant_left', payload: { participantId: 'alpha', reason: 'done' } });
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-1', coupling: 'writer', action: 'take',
  } }, beta);
  assert.equal(f.couplingRow(await f.call('view'), 'lease-1').holder, 'beta',
    'land take-over once the holder\'s membership has ended (docs/45 §4.1)');
});

test('#422 RED (stage: design-not-landed): a quorum synchronization point releases on the quorum-th arrival, attributed to the arriver', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'sync-1', coupling: 'synchronization', action: 'declare', groupId: 'team', name: 'interface-freeze', quorum: 2,
  } });
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'sync-1', coupling: 'synchronization', action: 'arrive',
  } }, alpha);
  const midway = f.couplingRow(await f.call('view'), 'sync-1');
  assert.equal(midway.satisfied, false,
    'land quorum: the view derives satisfied from arrivals against the declared quorum (docs/45 §4.3)');
  assert.equal(midway.released, false, 'one arrival of two never releases a quorum-2 point (docs/45 §4.3)');
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'sync-1', coupling: 'synchronization', action: 'arrive',
  } }, beta);
  const done = f.couplingRow(await f.call('view'), 'sync-1');
  assert.equal(done.released, true,
    'land release-by-quorum: the satisfying arrival releases the point in the same fold (docs/45 §4.3)');
  assert.equal(done.releasedBy, 'beta', 'the release is attributed to the arriving seat, never to a lead (docs/45 §4.3)');
  assert.match(done.releaseReason ?? '', /quorum/, 'the release reason names the quorum (docs/45 §4.3)');
});

test('#422 RED (stage: design-not-landed): a member with communicate proposes a coupling; arrival is consent; full consent declares it', async (t) => {
  const f = fixture(t);
  const { alpha, beta } = await f.team();
  const proposed = await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-9', coupling: 'writer', action: 'propose', members: ['alpha', 'beta'],
  } }, alpha);
  assert.equal(proposed.receipt.event.kind, 'swarm.coupling_updated',
    'land the propose action: any member with communicate proposes a coupling (docs/45 §4.5, §4.6)');
  const midway = f.couplingRow(await f.call('view'), 'lease-9');
  assert.equal(midway.proposed, true, 'land the proposed projection (docs/45 §8)');
  assert.deepEqual(midway.consents, ['alpha'], 'the proposer consents by proposing (docs/45 §4.5)');
  assert.deepEqual(midway.outstanding, ['beta'], 'the view names the outstanding consents (docs/45 §8)');
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'lease-9', coupling: 'writer', action: 'arrive',
  } }, beta);
  const declared = f.couplingRow(await f.call('view'), 'lease-9');
  assert.equal(declared.proposed, false,
    'land declaration-by-consent: the last arrival declares the record (docs/45 §4.5)');
  assert.equal(declared.holder, null, 'a consented lease starts unheld (docs/45 §4.5)');
});

test('#422 RED (stage: design-not-landed): group tightness is derived per group and never stored on the swarm (#374)', async (t) => {
  const f = fixture(t);
  await f.team();
  // A declared group-scoped coupling that exists TODAY (a failure policy) makes the group tight.
  await f.call('update', { event: 'swarm.coupling_updated', payload: {
    couplingId: 'fail-1', coupling: 'failure', action: 'declare', groupId: 'team', policy: 'independent',
  } });
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'lone', members: ['gamma'] } });
  const view = await f.call('view');
  const tight = view.groups.find((row) => row.groupId === 'team');
  const loose = view.groups.find((row) => row.groupId === 'lone');
  assert.equal(tight.coordination, 'tight',
    'land the derived group coordination reading: a declared coupling makes the group tight (docs/45 §7)');
  assert.ok((tight.tightBecause ?? []).some((entry) => entry.couplingId === 'fail-1'),
    'land tightBecause naming the rows that make the group tight (docs/45 §7)');
  assert.equal(loose.coordination, 'loose', 'a group with no declared rows reads loose (docs/45 §7)');
  assert.equal('coordination' in view, false, 'tightness is never a swarm-global field (docs/45 §7, §9)');
  assert.equal('mode' in view, false, 'there is no declared mode anywhere (docs/45 §9)');
});
