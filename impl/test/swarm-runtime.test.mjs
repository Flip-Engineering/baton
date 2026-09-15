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
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }), ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, ports, workers, prompts, starts, checks, call, recruit };
}

test('orchestrator starts empty, recruits later, and changes overlapping collaboration groups', async (t) => {
  const f = fixture(t);
  const created = await f.call('create', { purpose: 'Develop Baton using Baton' });
  // Issue #302: a mutation answers with its RECEIPT — the recorded event and the rows it changed —
  // and carries `next`; the whole view rides along only when the caller asks (view: true).
  assert.equal(created.receipt.command, 'swarm.create');
  assert.equal(created.receipt.event.kind, 'swarm.created');
  assert.equal(typeof created.receipt.event.seq, 'number');
  assert.equal(typeof created.receipt.event.ts, 'string');
  assert.equal(created.receipt.event.actor, 'owner');
  assert.deepEqual(created.receipt.changed, [{ collection: 'swarm', id: created.swarmId, seq: created.receipt.event.seq, ts: created.receipt.event.ts }]);
  assert.deepEqual(created.next, { command: 'swarm.recruit', args: { swarmId: created.swarmId } });
  assert.equal('participants' in created, false, 'the view is opt-in, never the default answer');
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'runtime', members: ['builder', 'reviewer'] } });
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'api', members: ['reviewer'] } });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'design', body: 'A turn ending is not a contribution being accepted.' } });
  await f.recruit('scout');
  assert.equal(f.starts.at(-1).sharedContext[0].body, 'A turn ending is not a contribution being accepted.');
  assert.equal(f.workers.length, 3);
  const view = await f.call('view');
  assert.deepEqual(view.groups.find((row) => row.groupId === 'runtime').members, ['builder', 'reviewer']);
  assert.deepEqual(view.groups.find((row) => row.groupId === 'api').members, ['reviewer']);
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
  const view = await f.call('view', {}, builder);
  assert.ok(view.availableActions.includes('swarm.check'));
  assert.ok(view.availableActions.includes('swarm.update'));
  assert.deepEqual(view.actionTargets['swarm.check'].participantIds, ['builder']);
  assert.equal(view.availableActions.includes('swarm.recruit'), false);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'finding', participantId: 'builder', body: 'The current interface needs another operation.',
  } }, builder);
  await assert.rejects(f.recruit('outsider', undefined, builder), { code: 'swarm_permission_required' });
  await assert.rejects(f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'forged', participantId: 'lead', body: 'Pretend this came from the lead.',
  } }, builder), { code: 'swarm_author_mismatch' });
  await assert.rejects(f.call('view', {}, principal('unknown')), { code: 'swarm_membership_required' });
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

test('inspect gives each participant usable payload examples only for their permitted updates', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Discover collaboration from the running swarm' });
  await f.recruit('builder');
  const caller = principal('w-1');
  const view = await f.call('view', {}, caller);
  assert.deepEqual(Object.keys(view.updatePayloads),
    view.updates.filter((row) => row.event !== undefined).map((row) => row.event));
  assert.deepEqual(view.updates.filter((row) => row.event !== undefined), [
    { event: 'swarm.context_updated', permission: 'communicate' },
    { event: 'swarm.contribution_recorded', permission: 'contribute' },
    { event: 'swarm.participant_left', permission: 'read' },
  ], 'updates names each kind this caller may send with the permission that admits it');
  assert.equal(view.updatePayloads['swarm.group_updated'], undefined);
  const schema = view.updatePayloads['swarm.context_updated'];
  assert.equal(schema.fields.body.type, 'json');
  await f.call('update', { event: 'swarm.context_updated', payload: schema.example }, caller);
  const next = await f.call('view', {}, caller);
  assert.deepEqual(Object.values(next.context).find((row) => row.key === schema.example.key).body, schema.example.body);
});

test('a captured revision attaches to an existing finding without replacing its text or author', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Findings and code can describe the same contribution' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review']);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'critique', body: 'The native watch wakes on its own tool calls.', refs: ['evidence:live-exercise'],
  } }, principal('w-1'));
  const finding = f.store.swarm('baton').contributions.critique;
  await f.call('capture', { participantId: 'builder', contributionId: 'critique' }, principal('w-2'));
  const attached = f.store.swarm('baton').contributions.critique;
  assert.equal(attached.body, finding.body);
  assert.equal(attached.actor, finding.actor);
  assert.equal(attached.participantId, 'builder');
  assert.equal(attached.revision.sha, SHA);
  assert.deepEqual(attached.refs, ['evidence:live-exercise', `refs/baton/checkpoints/${SHA}`]);
  const cursor = f.store.ledgerHeadSeq();
  await f.call('capture', { participantId: 'builder', contributionId: 'critique' }, principal('w-2'));
  assert.equal(f.store.ledgerHeadSeq(), cursor, 'retry does not duplicate the attachment');
  await assert.rejects(f.call('capture', { participantId: 'reviewer', contributionId: 'critique' }), {
    code: 'swarm_replay_conflict',
  });
  assert.equal((await f.call('check', { participantId: 'builder', contributionId: 'critique', checkId: 'review' }, principal('w-2'))).passed, true);
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
  const cursor = (await f.call('view')).cursor;
  let resolved = false;
  const watching = f.call('watch', { afterSeq: cursor, timeoutMs: 1000 }).then((result) => { resolved = true; return result; });
  await f.runtime.command('swarm.create', { swarmId: 'unrelated', purpose: 'Another collaboration', idempotencyKey: 'unrelated' }, owner);
  await new Promise(setImmediate);
  assert.equal(resolved, false);
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'finding', body: 'Relevant update' } });
  const view = await watching;
  assert.ok(view.cursor > cursor);
  assert.equal(view.watch.reason, 'event');
  assert.ok(view.watch.matchedSeq > cursor);
  assert.equal(Object.values(view.context)[0].body, 'Relevant update');
  const pending = f.call('watch', { afterSeq: view.cursor, timeoutMs: 1000 });
  await new Promise(setImmediate);
  f.runtime.close();
  await assert.rejects(pending, { code: 'coordination_wait_aborted' });
});

test('watch reports a timeout even when unrelated traffic advanced the deployment cursor', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Explain why an observer woke' });
  const cursor = f.store.ledgerHeadSeq();
  await f.runtime.command('swarm.create', { swarmId: 'elsewhere', purpose: 'Unrelated work', idempotencyKey: 'elsewhere' }, owner);
  const view = await f.call('watch', { afterSeq: cursor, timeoutMs: 10 });
  assert.ok(view.cursor > cursor);
  assert.deepEqual(view.watch, { reason: 'timeout', afterSeq: cursor, matchedSeq: null, event: null });
});

test('native watching does not wake itself through tool and token telemetry', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Wait for collaboration, without a tool feedback loop' });
  await f.recruit('lead');
  await f.recruit('builder');
  const cursor = f.store.ledgerHeadSeq();
  let resolved = false;
  const watching = f.call('watch', { afterSeq: cursor, timeoutMs: 1000 }, principal('w-1'))
    .then((view) => { resolved = true; return view; });
  for (const kind of ['content.tool_call', 'resource.tokens', 'route.observed']) {
    f.store.recordDriver(kind, { worker: 'w-1', runId: f.workers[0].runId }, { actor: 'worker', key: `telemetry:${kind}` });
  }
  await new Promise(setImmediate);
  assert.equal(resolved, false);
  f.store.recordDriver('turn.paused', { worker: 'w-2', runId: f.workers[1].runId }, { actor: 'worker', key: 'builder-paused' });
  const view = await watching;
  assert.equal(view.participants.find((row) => row.participantId === 'builder').runtime.turn, 'paused');
});

// 2026-09-14 audit S-E1/S-E2: the membership write is keyed on (swarmId, participantId), so a second
// recruit of the same name used to be served from the prior event (identical payload: a success
// receipt for an operation that did not happen) or refused as a REPLAY conflict (different payload).
// The name collision is now refused by name, naming the existing row's status.
test('recruiting a participant that already exists is refused by name, whatever the payload', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Develop Baton using Baton' });
  await f.recruit('builder');
  await assert.rejects(f.recruit('builder'), (error) => {
    assert.equal(error.code, 'swarm_participant_exists');
    assert.deepEqual(error.detail, { participantId: 'builder', status: 'active' });
    return true;
  });
  await assert.rejects(f.call('recruit', { participantId: 'builder', objective: 'A different objective' }), (error) => {
    assert.equal(error.code, 'swarm_participant_exists', 'never swarm_replay_conflict: the caller has no idempotency problem');
    return true;
  });
  const view = await f.call('view');
  assert.equal(view.participants.filter((row) => row.participantId === 'builder').length, 1);
  assert.equal(f.starts.length, 1, 'no second run was started for the collision');
});

// 2026-09-14 audit S-E3 (swarm-b/lead.md finding 9): the view published `observed_only` with empty
// arrays whenever the worker was unbound or the coordinator could not answer for native
// observations — a claim that Baton looked and saw no native collaboration. Absence is now labelled
// as absence, and only a real observation may claim the observed label.
test('native coverage labels absence as absence, and passes a real observation through', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Native observation truth' });
  await f.recruit('builder');

  // The fixture coordinator answers no native-observation query at all: nothing was observed.
  const unobserved = await f.call('view');
  assert.deepEqual(unobserved.participants[0].native,
    { coverage: 'unobserved', agents: [], invocations: [], unidentified: [] },
    'a coordinator that cannot answer for native observations has observed nothing');
  assert.equal(unobserved.participants[0].runtime.state, 'working');

  // An unbound participant observes nothing either — the label never claims otherwise.
  const bound = f.workers.slice();
  f.workers.length = 0;
  const unbound = await f.call('view');
  assert.equal(unbound.participants[0].runtime.state, 'unbound');
  assert.equal(unbound.participants[0].native.coverage, 'unobserved');

  // A coordinator that DOES answer passes its own observation through unaltered.
  f.workers.push(...bound);
  f.ports.coordinator.observedNativeSubagents = (workerId) => ({
    coverage: 'observed_only', agents: [{ nativeId: `child-of-${workerId}` }], invocations: [], unidentified: [],
  });
  const observed = await f.call('view');
  assert.equal(observed.participants[0].native.coverage, 'observed_only');
  assert.equal(observed.participants[0].native.agents[0].nativeId, 'child-of-w-1');
});
