// One swarm record, read as the slice the caller needs (issue #283, deliverables 1–3, 5–7):
// swarm.view takes a projection so a caller reads `outline`, `participants`, `contributions`,
// `attention`, `guidance`, `workspace` or `full` instead of the whole record; `updates` names the
// kinds the caller may send beside availableActions WITH the permission that admits each, derived
// from the same table dispatch enforces; a participant-scoped view carries only what that
// participant may see — its own brief and no other, the records whose roster intersects it, its own
// attention rows, never a request body; the participant row's liveness is ONE derivation the view,
// the wake feed and the bridge all carry; the row carries the route and scope the seat was
// recruited under; and its last refusal stands until a later operation of the same command
// succeeds. Fixture pattern from swarm-runtime.test.mjs (a real CoordinationStore under a
// controllable coordinator), so a worker's status can be set to exactly what the test needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS, SWARM_LIVE_RUNTIME_STATES, swarmParticipantLiveness } from '../src/swarm-runtime.mjs';
import { SWARM_COMMAND_ROWS, SWARM_VIEW_PROJECTION_NAMES, projectSwarmView,
  validateSwarmCommand } from '../src/swarm-contract.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';
import { SWARM_CLI_COMMANDS, SWARM_MCP_TOOL_DEFINITIONS } from '../src/swarm-surface.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const SHA = 'b'.repeat(40);
const FAMILIES = ['participants', 'work', 'assignments', 'contributions', 'reviews', 'groups', 'couplings', 'context', 'attention'];

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-view-slices-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async (workerId) => { workers.find((row) => row.id === workerId).paused = false; return { ok: true }; },
    captureContribution: async (workerId, { contributionId }) => ({ contributionId, workerId, sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } }),
  };
  const ports = {
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  // The worker handle a participant's principal resolves through — the seat a test drives.
  const workerOf = (participantId) => workers.find((row) => row.runId === store.swarm('baton').participants[participantId].runId);
  const asParticipant = (participantId) => workerPrincipal(workerOf(participantId).id);
  return { store, runtime, ports, workers, coordinator, call, workerOf, asParticipant };
}

/** Walk the wakes a command produced (they are already durable, so each step returns at once)
 * until the one whose event matches — the view a watcher wakes with, in the order it will read
 * them. Bounded: a wake that never arrives is a failure, not a hang. */
async function wakeMatching(f, first, matches, limit = 8) {
  let woke = first;
  for (let step = 0; step < limit; step += 1) {
    if (woke.watch.reason === 'event' && matches(woke.watch.event)) return woke;
    woke = await f.call('watch', { afterSeq: woke.cursor, timeoutMs: 50 });
  }
  throw new Error('no wake matched the expected event');
}
// A swarm with a lead, two builders it recruited, one leaf under a builder, a group, a shared
// context entry (swarm-wide and group-scoped), and work with an assignment.
async function built(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'Slice the view' });
  await f.call('recruit', { participantId: 'lead', objective: 'Coordinate the build', permissions: SWARM_PERMISSIONS });
  const lead = f.asParticipant('lead');
  // alpha may recruit its own detail worker (and nothing else beyond its default grant), so the
  // subtree it owns is a real one: alpha, leaf.
  await f.call('recruit', { participantId: 'alpha', objective: 'Build A', permissions: ['read', 'communicate', 'contribute', 'recruit'] }, lead);
  await f.call('recruit', { participantId: 'beta', objective: 'Build B' }, lead);
  await f.call('recruit', { participantId: 'leaf', objective: 'Detail work under A' }, f.asParticipant('alpha'));
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'impl', members: ['alpha', 'beta'] } });
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'others', members: ['beta'] } });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:all', body: 'shared with everyone' } });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:impl', body: 'for the implementers', groupId: 'impl' } });
  await f.call('update', { event: 'swarm.work_updated', payload: { workId: 'W-A', objective: 'Part A', status: 'open' } });
  await f.call('update', { event: 'swarm.assignment_updated', payload: { assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A', status: 'active' } });
  await f.call('update', { event: 'swarm.contribution_recorded', payload: { contributionId: 'c-alpha', participantId: 'alpha', workId: 'W-A', body: 'Part A built' } });
  await f.call('update', { event: 'swarm.contribution_reviewed', payload: { contributionId: 'c-alpha', decision: 'accept' } });
  return { ...f, lead };
}

test('every projection answers its own slice, keeps the frame, and the default stays the whole record', async (t) => {
  const f = await built(t);
  const full = await f.call('view');
  assert.equal(full.projection, 'full', 'naming no projection answers with the whole record');
  for (const family of FAMILIES) assert.ok(family in full, `${family} rides the full record`);

  for (const projection of SWARM_VIEW_PROJECTION_NAMES) {
    const view = await f.call('view', { projection });
    assert.equal(view.projection, projection);
    for (const frame of ['swarmId', 'status', 'purpose', 'caller', 'availableActions', 'updates', 'cursor']) {
      assert.ok(frame in view, `${projection} keeps the frame field ${frame}`);
      if (frame in full) assert.deepEqual(view[frame], full[frame], `${projection} keeps ${frame} unchanged`);
    }
  }

  const outline = await f.call('view', { projection: 'outline' });
  assert.deepEqual(FAMILIES.filter((family) => family in outline), [], 'the outline carries no rows at all');

  const participants = await f.call('view', { projection: 'participants' });
  assert.deepEqual(Object.keys(participants).filter((key) => FAMILIES.includes(key)), ['participants']);
  assert.deepEqual(participants.participants.map((row) => row.participantId), ['lead', 'alpha', 'beta', 'leaf']);

  const contributions = await f.call('view', { projection: 'contributions' });
  assert.deepEqual(contributions.contributions.map((row) => row.contributionId), ['c-alpha']);
  assert.deepEqual(Object.keys(contributions.reviews), ['c-alpha']);
  assert.equal('work' in contributions, false, 'the contributions slice carries no work rows');

  const guidance = await f.call('view', { projection: 'guidance' });
  assert.deepEqual(guidance.participants[0], { participantId: 'lead', guidance: [] },
    'a guidance row is the seat and its guidance, nothing else');
  const workspace = await f.call('view', { projection: 'workspace' });
  assert.deepEqual(Object.keys(workspace.participants[0]), ['participantId', 'workspace']);

  // The watch answers with the same slice, so a follower can ask for a small one.
  const parked = await f.call('view');
  const watching = f.call('watch', { afterSeq: parked.cursor, timeoutMs: 5000, projection: 'outline' });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:wake', body: 'woke' } });
  const woke = await watching;
  assert.equal(woke.watch.reason, 'event');
  assert.equal(woke.projection, 'outline');
  assert.deepEqual(FAMILIES.filter((family) => family in woke), [], 'the watch honours the requested slice');

  // An unknown projection is refused by the contract, naming the field and the closed set.
  await assert.rejects(f.call('view', { projection: 'summary' }), (error) =>
    error.code === 'swarm_command_invalid' && error.detail.field === 'projection'
      && error.detail.expectation === `one of ${SWARM_VIEW_PROJECTION_NAMES.join(', ')}`);
});

test('the projection argument is exposed by the CLI and MCP surfaces from the one contract row', () => {
  const cli = SWARM_CLI_COMMANDS.find((row) => row.command === 'swarm.view');
  assert.deepEqual(cli.flags.find((entry) => entry.field === 'projection'), { field: 'projection', flag: '--projection' });
  assert.match(cli.usage, /\[--projection VALUE\]/u);
  const mcp = SWARM_MCP_TOOL_DEFINITIONS.find((row) => row.command === 'swarm.view');
  assert.deepEqual(mcp.properties.projection.enum, SWARM_VIEW_PROJECTION_NAMES);
  assert.match(mcp.description, /projection names the slice/u);
  // The wire table and the argument validator agree because both derive from the same vocabulary.
  assert.equal(validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'outline' }), true);
  assert.throws(() => validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'summary' }),
    (error) => error.code === 'swarm_command_invalid' && error.detail.rule === 'closed-set');
  assert.equal(SWARM_COMMAND_ROWS.find((row) => row.command === 'swarm.view').properties.projection.enum.length,
    SWARM_VIEW_PROJECTION_NAMES.length);
});

test('the projection slicer is the one definition of a slice, and it is idempotent', async (t) => {
  const f = await built(t);
  const full = await f.call('view');
  for (const projection of SWARM_VIEW_PROJECTION_NAMES) {
    const view = await f.call('view', { projection });
    assert.deepEqual(view, projectSwarmView(full, projection),
      `${projection} is exactly what the shared slicer says it is`);
    assert.deepEqual(projectSwarmView(view, projection), view, `${projection} is idempotent`);
  }
});

test('updates names the kinds this caller may send with the permission that admits each, and dispatch agrees', async (t) => {
  const f = await built(t);
  const alpha = f.asParticipant('alpha');
  const view = await f.call('view', {}, alpha);
  const advertised = view.updates.map((row) => row.event);
  assert.deepEqual(view.updates, [
    { event: 'swarm.context_updated', permission: 'communicate' },
    { event: 'swarm.contribution_recorded', permission: 'contribute' },
    { event: 'swarm.participant_left', permission: 'read' },
    // The knowledge verbs (#318), in the participant table's order, each with its admitting
    // permission — read verbs for a reader, write verbs only where contribute is granted.
    { command: 'run.knowledge.seed', permission: 'contribute' },
    { command: 'run.board.post', permission: 'contribute' },
    { command: 'run.board.read', permission: 'read' },
    { command: 'run.scratchpad.append', permission: 'contribute' },
    { command: 'run.scratchpad.read', permission: 'read' },
    { command: 'run.scratchpad.elevate', permission: 'contribute' },
    { command: 'evidence.search', permission: 'read' },
  ]);
  assert.equal(advertised.includes('swarm.group_updated'), false, 'organizing is not advertised to a builder');
  assert.equal(advertised.includes('swarm.closed'), false);
  assert.ok(view.availableActions.includes('swarm.update'), 'there is something to send, so the command is offered');
  for (const row of view.updates) assert.ok(view.caller.permissions.includes(row.permission), `${row.event} names a permission the caller holds`);

  // Every advertised kind really is admitted, and the kind that is not advertised really is refused.
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:a', body: 'from alpha' } }, alpha);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: 'alpha published a finding' }, alpha);
  await assert.rejects(f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'g', members: ['alpha'] } }, alpha),
    (error) => error.code === 'swarm_permission_required' && error.detail.permission === 'organize',
    'a kind the view does not advertise is refused by exactly the permission it would have needed');

  // A read-only seat may send its own leave and nothing else; the view says so.
  await f.call('recruit', { participantId: 'reader', objective: 'Watch only', permissions: ['read'] }, f.lead);
  const readOnly = await f.call('view', {}, f.asParticipant('reader'));
  assert.deepEqual(readOnly.updates, [
    { event: 'swarm.participant_left', permission: 'read' },
    { command: 'run.board.read', permission: 'read' },
    { command: 'run.scratchpad.read', permission: 'read' },
    { command: 'evidence.search', permission: 'read' },
  ],
    'a read-only participant is told the one update and the read verbs it may send, with their permissions');
  await assert.rejects(f.call('update', { event: 'swarm.context_updated', payload: { key: 'k', body: 'b' } }, f.asParticipant('reader')),
    (error) => error.code === 'swarm_permission_required' && error.detail.permission === 'communicate',
    'and the permission the view names is the one dispatch enforces');
  // Its own leave is admitted: the advertised row was not a promise the runtime breaks.
  await f.call('update', { event: 'swarm.participant_left' }, f.asParticipant('reader'));
  assert.equal(f.store.swarm('baton').participants.reader.status, 'left');
});

test('a participant-scoped view carries its own brief and no other, by roster intersection, and never a request body', async (t) => {
  const f = await built(t);
  const alphaScope = await f.call('view', { participantId: 'alpha' });

  // Briefs: the scope's own row carries its brief; every other row says the text was withheld.
  assert.deepEqual(alphaScope.participants.map((row) => row.participantId), ['alpha', 'leaf']);
  assert.equal(alphaScope.participants[0].role, 'Build A');
  assert.equal(alphaScope.participants[1].role, null, 'another participant\'s brief is never in the view');
  assert.equal(alphaScope.participants[1].briefWithheld, true, 'withheld is said, not silently dropped');
  // Alpha's OWN brief legitimately names the situation it was recruited with (its peers' roles,
  // issue #318 deliverable 4); another seat's brief row, by contrast, is withheld whole.
  assert.equal(alphaScope.participants.some((row) => row.participantId === 'lead'), false,
    'the recruiter outside the subtree is not here at all');
  assert.equal(alphaScope.participants.every((row) => row.participantId === 'alpha' || row.brief === null), true,
    'no carried row keeps another seat\u2019s composed brief');

  // Records by roster intersection: the group alpha is on is in scope (with its real roster), the
  // group it is not on is not; couplings follow the same rule (already pinned elsewhere).
  assert.deepEqual(alphaScope.groups.find((row) => row.groupId === 'impl').members, ['alpha', 'beta']);
  assert.equal(alphaScope.groups.some((row) => row.groupId === 'others'), false, 'a group the seat is not on is out of scope');

  // Shared context: every entry the swarm publishes swarm-wide is the participant's own reading
  // (it is recruited WITH that context), and an entry written for ONE group follows that group's
  // roster — so a seat outside the group never sees it (2026-09-14 audit S-G5).
  const contextKeys = (view) => Object.values(view.context).map((entry) => entry.key).sort();
  assert.deepEqual(contextKeys(alphaScope), ['notes:all', 'notes:impl'], 'alpha is on impl');
  assert.deepEqual(contextKeys(await f.call('view', { participantId: 'beta' })), ['notes:all', 'notes:impl']);
  assert.deepEqual(contextKeys(await f.call('view', { participantId: 'leaf' })), ['notes:all'],
    'a member of no group reads the swarm-wide entry and nothing else');

  // An in-flight operation is attention; its REQUEST BODY never is (2026-09-14 audit S-E6).
  const secret = 'guide text that belongs to nobody else';
  f.store.recordDriver('swarm.operation_requested', {
    swarmId: 'baton', command: 'swarm.guide', requestDigest: 'digest', basis: null, participantId: 'beta',
    request: { swarmId: 'baton', participantId: 'beta', message: secret, idempotencyKey: 'key-that-must-not-leak' },
  }, { actor: 'worker:w-2', key: 'swarm-operation:probe-in-flight' });

  const global = await f.call('view');
  const row = global.attention.find((entry) => entry.kind === 'operation_unconfirmed');
  assert.deepEqual(row, {
    kind: 'operation_unconfirmed', command: 'swarm.guide', participantId: 'beta',
    operationKey: 'swarm-operation:probe-in-flight', state: 'unconfirmed', code: null,
  }, 'an in-flight row names the command, the seat and the key — not the payload');
  assert.equal(row.request, undefined);
  assert.equal(JSON.stringify(row).includes('digest'), false, 'the recorded row itself carries no body either');
  const attentionSlice = await f.call('view', { projection: 'attention' });
  assert.deepEqual(attentionSlice.attention, global.attention, 'the attention slice is the same attention');
  assert.equal(JSON.stringify(global).includes(secret), false, 'no attention row carries a request body');

  // A scoped view carries only the attention its subtree can act on: beta's operation is not
  // alpha's business, and its own is.
  const alphaScoped = await f.call('view', { participantId: 'alpha' });
  assert.equal(alphaScoped.attention.some((entry) => entry.kind === 'operation_unconfirmed'), false);
  const betaScoped = await f.call('view', { participantId: 'beta' });
  assert.equal(betaScoped.attention.some((entry) => entry.kind === 'operation_unconfirmed'), true);
});

test('one runtime record, one classification: the view, the wake feed and the bridge all carry it', async (t) => {
  const f = await built(t);
  const worker = f.workerOf('alpha');
  const participant = await f.call('view')
    .then((view) => view.participants.find((row) => row.participantId === 'alpha'));
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
  });
  t.after(async () => { await bridge.close(); });
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'alpha', runId: participant.runId });
  const overBridge = () => swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: 'baton' } },
    { env: issued.env });

  const states = ['pending', 'working', 'blocked', 'idle', 'stopping', 'dead', 'exited'];
  for (const status of states) {
    for (const paused of [false, true]) {
      worker.status = status;
      worker.paused = paused;
      const view = await f.call('view');
      const row = view.participants.find((entry) => entry.participantId === 'alpha');
      const parked = await f.call('view');
      const woke = await f.call('watch', { afterSeq: parked.cursor, timeoutMs: 10 });
      const bridged = await overBridge();
      const throughBridge = bridged.participants.find((entry) => entry.participantId === 'alpha');
      const expected = swarmParticipantLiveness(worker, paused ? 1 : 0);
      assert.deepEqual(row.runtime, throughBridge.runtime, 'the bridge carries the view row verbatim');
      assert.deepEqual(woke.participants.find((entry) => entry.participantId === 'alpha').runtime, row.runtime,
        'the wake feed carries the same classification');
      assert.deepEqual({ state: row.runtime.state, live: row.runtime.live, turn: row.runtime.turn }, expected,
        `${status}${paused ? ' (paused)' : ''} is classified by the one predicate`);
    }
  }

  // A seat with no worker at all is unbound — absence, not a dead runtime. Live is the ONE list:
  // everything outside it is gone, and nothing re-derives the question.
  f.workers.splice(f.workers.indexOf(worker), 1);
  const unbound = (await f.call('view')).participants.find((entry) => entry.participantId === 'alpha');
  assert.deepEqual(unbound.runtime, { workerId: null, state: 'unbound', turn: null, live: false });
  assert.equal(SWARM_LIVE_RUNTIME_STATES.includes('unbound'), false);
  assert.deepEqual((await overBridge()).participants.find((entry) => entry.participantId === 'alpha').runtime,
    unbound.runtime, 'and the bridge says exactly the same thing');

  // The same classification drives the attention rows: an active seat whose runtime is gone is a
  // dead-runtime row; an unbound seat is absence and raises nothing.
  f.workers.push(worker);
  worker.status = 'dead';
  worker.paused = false;
  const dead = await f.call('view');
  assert.deepEqual(dead.attention.find((entry) => entry.kind === 'participant_runtime_dead'),
    { kind: 'participant_runtime_dead', participantId: 'alpha', state: 'dead' });
  f.workers.splice(f.workers.indexOf(worker), 1);
  assert.equal((await f.call('view')).attention.some((entry) => entry.kind === 'participant_runtime_dead'), false,
    'an unbound seat is not a dead runtime');
});

test('a participant row carries the route and scope the seat was recruited under, durably, and the wake names it', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Record the recruitment' });
  const parked = await f.call('view');
  const watching = f.call('watch', { afterSeq: parked.cursor, timeoutMs: 5000 });
  const route = { harness: 'omp', model: 'model-z', effort: 'high' };
  const scope = ['impl/**', 'docs/**'];
  await f.call('recruit', { participantId: 'builder', objective: 'Build under a recorded route', options: { exact: route, scope } });
  // The recruit's own operation row lands first and is a wake about the recruit too; the wake that
  // IS the recruitment is the join, so walk the (already durable) wakes to it.
  const recruitment = await wakeMatching(f, await watching, (event) => event.kind === 'swarm.participant_joined');
  const row = (await f.call('view')).participants[0];
  assert.deepEqual(row.route, route, 'the row carries the route the seat was recruited under');
  assert.deepEqual(row.scope, scope, 'and the scope it was admitted over');
  assert.deepEqual(f.store.swarm('baton').participants.builder.route, route, 'the join itself carries it: a projection, not new state');
  assert.deepEqual(f.store.swarm('baton').participants.builder.scope, scope);
  assert.deepEqual(recruitment.watch.event, {
    seq: recruitment.watch.matchedSeq, kind: 'swarm.participant_joined', payloadKind: null,
    participantId: 'builder', route, scope,
  }, 'the wake summary for a recruitment names the route the seat was started under');

  // A worker that moved on does not move the recorded route: it is a fact of the join.
  f.workerOf('builder').status = 'dead';
  const after = await f.call('view');
  assert.deepEqual(after.participants[0].route, route);
  // A recruitment that named no complete route records none — an incomplete selector is not padded
  // into a route.
  await f.call('recruit', { participantId: 'vague', objective: 'No selection named', options: { exact: { harness: 'omp' } } });
  assert.equal((await f.call('view')).participants.find((entry) => entry.participantId === 'vague').route, null);
});

test('a participant carries its last refusal until a later operation of the same command succeeds', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Refusals clear the way successes are recorded' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build, and be refused once' });
  const builder = f.asParticipant('builder');
  const worker = f.workerOf('builder');

  // The seat loses its worker: its capture refuses, and the refusal is the seat's own.
  f.workers.splice(f.workers.indexOf(worker), 1);
  await assert.rejects(f.call('capture', { participantId: 'builder', contributionId: 'c1' }, builder),
    { code: 'swarm_participant_unbound' });
  const refused = (await f.call('view')).participants.find((row) => row.participantId === 'builder');
  assert.deepEqual(Object.keys(refused.lastRefusal).sort(), ['code', 'command', 'field', 'seq']);
  assert.equal(refused.lastRefusal.command, 'swarm.capture');
  assert.equal(refused.lastRefusal.code, 'swarm_participant_unbound');
  assert.equal(Number.isSafeInteger(refused.lastRefusal.seq), true, 'the row names the refusal\'s own seq');

  // A success of a DIFFERENT command leaves it standing.
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'k', body: 'b' } }, builder);
  assert.equal((await f.call('view')).participants.find((row) => row.participantId === 'builder').lastRefusal.seq,
    refused.lastRefusal.seq, 'only the same command clears it');

  // Restoring the worker lets the SAME command succeed, and the standing refusal is retired.
  f.workers.push(worker);
  await f.call('capture', { participantId: 'builder', contributionId: 'c1' }, builder);
  const cleared = await f.call('view');
  assert.equal(cleared.participants.find((row) => row.participantId === 'builder').lastRefusal, null,
    'a later operation of the same command that succeeds clears it');
  assert.equal(cleared.caller.lastRefusal, null);
  assert.equal(f.store.eventsView().some((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.operation_completed' && event.payload.command === 'swarm.capture'
    && event.payload.participantId === 'builder'), true, 'the terminal row is the durable evidence of the success');

  // A refused READ is not recorded by the RUNTIME — a refused read is the caller's own business
  // (pinned by swarm-refusals) — so no view refusal ever reaches `lastRefusal`. What a row reports
  // is what the runtime refused to the seat, plus the refusals the native bridge raised on its
  // behalf, which the bridge reports for exactly this reason (swarm-bridge-truth).
  const reader = f.asParticipant('builder');
  await assert.rejects(f.call('view', { projection: 'summary' }, reader), { code: 'swarm_command_invalid' });
  assert.equal((await f.call('view', {}, reader)).caller.lastRefusal, null,
    'a refused read leaves no standing refusal behind');
});
