import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SHA = 'a'.repeat(40);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const prompts = [];
  const starts = [];
  const checks = [];
  const captures = new Map();
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async (workerId, message) => {
      prompts.push({ workerId, message });
      workers.find((row) => row.id === workerId).paused = false;
      return { ok: true };
    },
    captureContribution: async (workerId, { contributionId }) => {
      const captured = { contributionId, workerId, sha: SHA, ref: `refs/baton/checkpoints/${SHA}` };
      captures.set(`${workerId}:${contributionId}`, captured);
      return captured;
    },
    checkContribution: async (workerId, { contributionId, checkId }) => {
      assert.ok(captures.has(`${workerId}:${contributionId}`));
      checks.push({ workerId, contributionId, checkId });
      return { passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } };
    },
  };
  const ports = {
    store, coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      assert.equal(store.hasSwarmParticipantRun(request.runId), true, 'membership must precede the first native turn');
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }), ...(['list', 'inspect', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, ports, workers, prompts, starts, checks, call, recruit };
}

test('orchestrator starts empty, recruits later, and changes overlapping collaboration groups', async (t) => {
  const f = fixture(t);
  const empty = await f.call('create', { purpose: 'Develop Baton using Baton' });
  assert.equal(empty.participants.length, 0);
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'runtime', members: ['builder', 'reviewer'] } });
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'api', members: ['reviewer'] } });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'design', body: 'A turn ending is not a contribution being accepted.' } });
  await f.recruit('scout');
  assert.equal(f.starts.at(-1).sharedContext[0].body, 'A turn ending is not a contribution being accepted.');
  assert.equal(f.workers.length, 3);
  const view = await f.call('inspect');
  assert.deepEqual(view.groups.runtime.members, ['builder', 'reviewer']);
  assert.deepEqual(view.groups.api.members, ['reviewer']);
  assert.ok(view.availableActions.includes('swarm.recruit'));
});

test('delegated coordinator recruits within grants and implementers can contribute ordinary findings', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Delegated development' });
  await f.recruit('lead', SWARM_PERMISSIONS);
  const lead = principal('w-1');
  await f.recruit('builder', undefined, lead);
  assert.equal(f.store.swarm('baton').participants.builder.parentId, 'lead');
  const builder = principal('w-2');
  const view = await f.call('inspect', {}, builder);
  assert.ok(view.availableActions.includes('swarm.check'));
  assert.equal(view.availableActions.includes('swarm.recruit'), false);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'finding', participantId: 'builder', body: 'The current interface needs another operation.',
  } }, builder);
  await assert.rejects(f.recruit('outsider', undefined, builder), { code: 'swarm_permission_required' });
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'forged', participantId: 'lead', body: 'Pretend this came from the lead.',
  } }, builder), { code: 'swarm_author_mismatch' });
  await assert.rejects(f.call('inspect', {}, principal('unknown')), { code: 'swarm_membership_required' });
});

test('reviewers check and accept contributions while authors remain available for further guidance', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Continuous review' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const reviewer = principal('w-2');
  await f.call('capture', { participantId: 'builder', contributionId: 'revision' }, reviewer);
  const result = await f.call('check', { participantId: 'builder', contributionId: 'revision', checkId: 'initial' }, reviewer);
  assert.equal(result.passed, true);
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'revision', decision: 'accept', reason: 'Ready for integration.',
  } }, reviewer);
  await f.call('guide', { participantId: 'builder', message: 'Continue with the next interface.' }, reviewer);
  assert.equal(f.workers[0].status, 'working');
  assert.equal(f.store.swarm('baton').participants.builder.status, 'active');
  assert.equal(f.prompts.length, 1);
  await f.call('stop', { participantId: 'builder', reason: 'Session no longer needed' });
  await f.call('check', { participantId: 'builder', contributionId: 'revision', checkId: 'after-stop' }, reviewer);
  assert.equal(f.workers[0].status, 'dead');
});

test('recruitment recovers through the existing idempotent Run authority and retains its original shared context', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Recover recruitment' });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'basis', body: 'original' } });
  const start = f.runtime.startRun;
  let loseResponse = true;
  f.runtime.startRun = async (request, actor) => {
    await start(request, actor);
    if (loseResponse) { loseResponse = false; throw new Error('Response lost after Run admission'); }
  };
  const request = { participantId: 'builder', objective: 'Build the runtime', idempotencyKey: 'recruit-builder' };
  await assert.rejects(f.call('recruit', request), /Response lost/);
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'basis', body: 'newer' } });
  const replay = new SwarmRuntime({ ...f.ports, startRun: f.runtime.startRun });
  await replay.command('swarm.recruit', { ...request, swarmId: 'baton' }, owner);
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].sharedContext[0].body, 'original');
  assert.equal(f.store.swarm('baton').participants.builder.bindings.length, 1);
  await assert.rejects(replay.command('swarm.recruit', {
    ...request, swarmId: 'baton', objective: 'Different request under the same key',
  }, owner), { code: 'swarm_replay_conflict' });
});

test('invalid recruitment is refused before membership or provider effects', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Preflight authority' });
  f.runtime.prepareRun = async () => { throw Object.assign(new Error('Scope outside deployment'), { code: 'application_scope_not_allowed' }); };
  await assert.rejects(f.recruit('outside'), { code: 'application_scope_not_allowed' });
  assert.deepEqual(Object.keys(f.store.swarm('baton').participants), []);
  assert.equal(f.starts.length, 0);
});


test('watch ignores unrelated swarms, wakes on selected updates, and releases on shutdown', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Selected collaboration updates' });
  const cursor = (await f.call('inspect')).cursor;
  let resolved = false;
  const watching = f.call('watch', { afterSeq: cursor, timeoutMs: 1000 }).then((result) => { resolved = true; return result; });
  await f.runtime.command('swarm.create', { swarmId: 'unrelated', purpose: 'Another collaboration', idempotencyKey: 'unrelated' }, owner);
  await new Promise(setImmediate);
  assert.equal(resolved, false);
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'finding', body: 'Relevant update' } });
  const view = await watching;
  assert.ok(view.cursor > cursor);
  assert.equal(Object.values(view.context)[0].body, 'Relevant update');
  const pending = f.call('watch', { afterSeq: view.cursor, timeoutMs: 1000 });
  await new Promise(setImmediate);
  f.runtime.close();
  await assert.rejects(pending, { code: 'coordination_wait_aborted' });
});
