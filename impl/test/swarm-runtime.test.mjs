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
  // Adapter cards by vendor name (#337): the card's steer/prompt verbs decide whether a seat
  // can take mid-turn guidance — never the harness name. A session vendor delivers natively;
  // a one-shot vendor names both verbs unsupported.
  const cards = new Map([
    ['mock-session', { prompt: 'native', steer: 'native' }],
    ['mock-oneshot', { prompt: 'unsupported', steer: 'unsupported' }],
  ]);
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    routeCards: () => [...cards.entries()].map(([name, verbs]) => ({ name, card: { verbs } })),
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
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
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
  return { store, runtime, ports, workers, prompts, starts, checks, call, recruit, cards };
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
  assert.ok(view.availableActions.includes('swarm.update'));
  assert.equal(view.availableActions.includes('swarm.check'), false);
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

test('reviewers accept contributions while authors remain available for further guidance', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Continuous review' });
  await f.recruit('builder');
  await f.recruit('reviewer', ['read', 'review', 'communicate']);
  const reviewer = principal('w-2');
  await f.call('capture', { participantId: 'builder', contributionId: 'revision' }, reviewer);
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: {
    contributionId: 'revision', decision: 'accept', reason: 'Ready for integration.',
  } }, reviewer);
  await f.call('guide', { participantId: 'builder', message: 'Continue with the next interface.' }, reviewer);
  assert.equal(f.workers[0].status, 'working');
  assert.equal(f.store.swarm('baton').participants.builder.status, 'active');
  assert.equal(f.prompts.length, 1);
  await f.call('stop', { participantId: 'builder', reason: 'Session no longer needed' });
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
  // docs/45 §4.6: the two new kinds ride the SAME derivation dispatch enforces, so a seat with
  // contribute is told it may take its own claim, and every seat is told its own consent (an
  // arrival at a proposal) is sendable at read — beside the kinds that were already advertised.
  assert.deepEqual(view.updates.filter((row) => row.event !== undefined), [
    { event: 'swarm.claim_updated', permission: 'contribute' },
    { event: 'swarm.proposal_updated', permission: 'read' },
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
  // Issue #433 (docs/46 §3.3): a spent watch names an EMPTY frame — no rows, no pending row —
  // beside the first-row `event` the CLI compatibility keeps.
  assert.deepEqual(view.watch, { reason: 'timeout', afterSeq: cursor, matchedSeq: null,
    pendingSince: null, event: null, events: [] });
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

// Issue #337 with issue #273's receipt: guidance to a one-shot harness seat used to be silently
// dropped — swarm.guide answered operation_completed with `guide: null` and nothing reached the
// seat. The message parks durably instead, and the receipt now carries the guide's OWN row —
// never null, whatever lane answered — naming the seat, the messageId, the sender relationship,
// the priority and the delivery state.
test('a guide to a one-shot seat parks durably and answers with its own row', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Parked guidance' });
  await f.recruit('builder');
  f.workers[0].vendor = 'mock-oneshot';
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, reason: 'nudge unsupported on one-shot muse' });

  const guided = await f.call('guide', { participantId: 'builder', message: 'Hold the API shape.' });
  assert.equal(guided.receipt.command, 'swarm.guide');
  assert.equal(guided.receipt.event.kind, 'swarm.guidance_parked');
  assert.deepEqual(guided.receipt.changed, [{ collection: 'participants', id: 'builder',
    seq: guided.receipt.event.seq, ts: guided.receipt.event.ts }]);
  assert.deepEqual(guided.guide, {
    seq: guided.receipt.event.seq, kind: 'swarm.guidance_parked', participantId: 'builder',
    from: { kind: 'root', participantId: null }, sentAt: guided.receipt.event.ts,
    priority: 'next_boundary', inReplyTo: null, messageId: guided.guide.messageId,
    delivery: { state: 'parked', lane: null, reason: 'harness_one_shot', terminal: true },
  }, 'the parked receipt IS the row the guide wrote, with the whole provenance on it');
  assert.match(guided.guide.messageId, /^message:[a-f0-9]{64}$/);
  assert.deepEqual(guided.result, { ok: true, result: 'parked',
    reason: 'harness_one_shot', messageId: guided.guide.messageId });
  assert.deepEqual(guided.next, { command: 'swarm.watch', args: { swarmId: 'baton' },
    observation: { wakeClass: 'guidance_delivered', participantId: 'builder' } },
  'next names the delivery that clears the park');

  const parked = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_parked');
  assert.equal(parked.length, 1);
  assert.equal(parked[0].payload.participantId, 'builder');
  assert.equal(parked[0].payload.messageId, guided.guide.messageId);
  assert.equal(parked[0].payload.message, 'Hold the API shape.');
  assert.equal(parked[0].payload.actor, 'owner', 'the raw actor rides the row the relationship was read from');
  assert.deepEqual(parked[0].payload.from, { kind: 'root', participantId: null });
  assert.deepEqual(parked[0].payload.delivery,
    { state: 'parked', lane: null, reason: 'harness_one_shot', terminal: true });
  assert.equal(f.store.eventsView().some((event) => event.kind === 'message.delivered'), false,
    'the park itself wakes no guidance_delivered');

  const view = await f.call('view');
  const row = view.participants.find((participant) => participant.participantId === 'builder');
  assert.deepEqual(row.guidance, [{
    seq: parked[0].seq, ts: parked[0].ts, kind: 'swarm.guidance_parked',
    messageId: guided.guide.messageId, from: { kind: 'root', participantId: null },
    priority: 'next_boundary', thread: { root: parked[0].seq, parent: null },
    delivery: { state: 'parked', lane: null, reason: 'harness_one_shot', terminal: true, deliveredTo: null, at: null },
  }]);
});

// Issue #557 on the peer channel: a `swarm.notify` to a one-shot seat parks durably, and the
// notification row now carries the same terminal mark the guide park carries, so a sender reading
// `state: parked` can tell a delivery that can never clear from one that has not cleared yet.
test('a notify to a one-shot seat carries the terminal mark its receipt and later reads both show', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Parked notify' });
  await f.recruit('builder');
  f.workers[0].vendor = 'mock-oneshot';
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, reason: 'nudge unsupported on one-shot muse' });

  const sent = await f.call('notify', { participantId: 'builder', message: 'Check the pipeline read.' });
  assert.equal(sent.receipt.event.kind, 'swarm.notification_sent');
  assert.equal(sent.notify.state, 'parked');
  assert.equal(sent.notify.reason, 'harness_one_shot');
  assert.equal(sent.notify.terminal, true,
    'a park that can never clear says so on the receipt the sender reads');
  assert.equal(sent.notify.read, null);

  const read = await f.runtime.command('swarm.notifications', { swarmId: 'baton' }, owner);
  const row = read.notifications.find((entry) => entry.receiptId === sent.notify.receiptId);
  assert.equal(row.terminal, true, 'and on every later read of the row');
});

// Issue #337 × #273 × #534: a harness that CAN deliver mid-turn keeps the delivery path — and
// when the lane itself answers worker_not_active, nobody home took the message, so the guidance
// parks durably under the lane's own reason: the seat's next exec composes it, and a resume-from
// successor inherits it in its brief. The row never lets a message die in a refused delivery.
test('a worker_not_active lane refusal parks the guidance under the lane\'s own reason', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Live guidance path' });
  await f.recruit('builder');
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, result: 'worker_not_active' });

  const guided = await f.call('guide', { participantId: 'builder', message: 'Keep going.' });
  assert.deepEqual(guided.result, { ok: true, result: 'parked', reason: 'worker_not_active',
    messageId: guided.guide.messageId });
  assert.equal(guided.guide.kind, 'swarm.guidance_parked', 'the guide leaves its parked row');
  assert.deepEqual(guided.guide.delivery,
    { state: 'parked', lane: null, reason: 'worker_not_active' },
    'the row says nobody home took it — and that it waits, composed into the next brief');
  assert.deepEqual(guided.next, { command: 'swarm.watch', args: { swarmId: 'baton' },
    observation: { wakeClass: 'guidance_delivered', participantId: 'builder' } },
    'next names the delivery that clears the park');
  const parked = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_parked');
  assert.equal(parked.length, 1, 'exactly one durable park');
  assert.equal(parked[0].payload.delivery.reason, 'worker_not_active');
});

// Issue #337: the card's steer/prompt verbs decide, never the harness name — a seat whose
// vendor is NAMED like a one-shot but whose card delivers keeps the live path (the lane is
// really tried; a park under the lane's answer names worker_not_active, never
// harness_one_shot), and a seat under a novel name whose card names both verbs unsupported
// parks under the harness rule.
test('one-shot detection reads card verbs, never the harness name', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Verb-decided parking' });
  await f.recruit('builder');
  f.workers[0].vendor = 'muse';
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, result: 'worker_not_active' });
  const live = await f.call('guide', { participantId: 'builder', message: 'Keep going.' });
  assert.deepEqual(live.result, { ok: true, result: 'parked', reason: 'worker_not_active',
    messageId: live.guide.messageId },
    'a muse-named seat with a deliverable card keeps the delivery path — the park names the lane\'s own answer');
  assert.equal(live.guide.delivery.reason, 'worker_not_active');
  assert.equal(live.guide.delivery.state, 'parked');

  f.workers[0].vendor = 'shiny-new-harness';
  f.cards.set('shiny-new-harness', { prompt: 'unsupported', steer: 'unsupported' });
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, reason: 'nudge unsupported on one-shot shiny' });
  const parked = await f.call('guide', { participantId: 'builder', message: 'Hold the shape.' });
  assert.equal(parked.guide.delivery.state, 'parked',
    'an unknown-named seat with unsupported verbs parks');
  assert.equal(parked.result.reason, 'harness_one_shot',
    'the card-unsupported park keeps the harness reason');
});

// Issue #337: parked guidance composes into the --resume-from successor's brief in the Swarm
// section, attributed to the root with seq/ts — and the composition marks it delivered, so a
// second successor never receives it twice and the park itself woke no delivery.
test('a resume-from successor brief carries parked guidance and marks it delivered', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Parked guidance inheritance' });
  await f.recruit('otelder');
  f.workers[0].vendor = 'mock-oneshot';
  f.ports.coordinator.guideParticipant = async () => ({ ok: false, reason: 'nudge unsupported on one-shot muse' });
  const root = { actor: 'orchestrator', principalId: 'orchestrator', sessionId: 'orchestrator' };
  const first = await f.call('guide', { participantId: 'otelder', message: 'Hold the API shape.' }, root);
  const second = await f.call('guide', { participantId: 'otelder', message: 'And the error codes.' }, root);

  await f.call('recruit', { participantId: 'successor', objective: 'Continue as successor', resumeFrom: 'otelder' });
  // #525: the successor's brief is composed when the orchestrator's answer starts the seat, so the
  // parked guidance reaches it through the #337 seam one delivery later.
  await f.call('guide', { participantId: 'successor', message: 'Continue the lane.' }, root);
  const brief = f.store.swarm('baton').participants.successor.brief;
  assert.match(brief, /Parked guidance for otelder/);
  assert.ok(brief.includes('Hold the API shape.'), 'first parked message composes into the successor brief');
  assert.ok(brief.includes('And the error codes.'), 'second parked message composes into the successor brief');
  assert.ok(brief.includes(first.guide.messageId), 'delivery cites the parked messageId');
  assert.ok(brief.includes(String(first.guide.seq)), 'delivery cites the parked seq');
  assert.ok(brief.includes('the root orchestrator'), 'parked guidance is attributed to the root');

  // The parked guidance rows this row owns: otelder's two. The recruit that composes the
  // successor's brief marks each one delivered (#572: one act, no answer in between).
  const deliveredOf = (messageIds) => f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_delivered'
    && messageIds.includes(event.payload.messageId));
  const delivered = deliveredOf([first.guide.messageId, second.guide.messageId]);
  assert.equal(delivered.length, 2, 'each parked message is marked delivered exactly once');
  assert.deepEqual(delivered.map((event) => event.payload.messageId).sort(),
    [first.guide.messageId, second.guide.messageId].sort());
  const wake = f.store.eventsView().filter((event) => event.kind === 'message.delivered'
    && event.payload?.messageId === first.guide.messageId);
  assert.equal(wake.length, 1, 'delivery wakes guidance_delivered on the parked messageId');

  const view = await f.call('view');
  const elder = view.participants.find((participant) => participant.participantId === 'otelder');
  assert.deepEqual(elder.guidance.map((row) => row.delivery.state), ['delivered', 'delivered'],
    'each park is ONE row whose state becomes delivered when the composition names its messageId');
  assert.ok(elder.guidance.every((row) => row.delivery.deliveredTo === 'successor'),
    'the delivery names the seat whose brief carried the message');

  await f.call('recruit', { participantId: 'third', objective: 'Continue as third', resumeFrom: 'otelder' });
  await f.call('guide', { participantId: 'third', message: 'Continue the lane.' }, root);
  const thirdBrief = f.store.swarm('baton').participants.third.brief;
  assert.equal(thirdBrief.includes('Hold the API shape.'), false, 'delivered guidance never composes twice');
  assert.equal(deliveredOf([first.guide.messageId, second.guide.messageId]).length, 2,
    'a second successor never re-marks a delivery the first one recorded');
});
