// Issues #302, #301 and #308: what a swarm mutation owes its caller, what a view owes its
// readers, and what a refused recruitment owes the swarm.
//
// #302 — every mutation (create, recruit, update, guide, stop, capture, check, close) answers
// with a RECEIPT — the recorded event {kind, seq, ts, actor} and the rows it changed — plus
// `next`, the step that follows; the whole view rides along only when the caller asks
// (view: true). The view carries ONE collection shape — participants, contributions, couplings,
// groups and attention are arrays — and one runtime fed through every read path (view, watch,
// bridge, MCP) answers with that same shape.
//
// #301 — swarm.recruit returns advisory scopeOverlap rows naming every ACTIVE participant across
// the repository's swarms whose scope shares paths with the requested scope (never a refusal);
// participant rows carry base {observedHead, target, behind} derived from the repository at read
// time, swarm.capture records the merge-base with the target on the capture row, and a checkpoint
// whose base cannot reach the target is refused typed.
//
// #308 — a recruit whose run admission refuses rolls its join back with a durable
// swarm.participant_left {reason: 'recruit_refused', code}; a repeated recruit of the same id
// resumes it; swarm_participant_exists crosses the CLI as itself with retryable:false; a refused
// operation settles its attention row; and in-flight rows never carry the request body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, McpFleetServer } from '../src/index.mjs';
import { normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { BatonControlError } from '../src/holistic-runtime.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const SHA = 'a'.repeat(40);
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t, { guideLane = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-receipts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const prompts = [];
  const starts = [];
  const checks = [];
  const captures = new Map();
  let messages = 0;
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    liveWorkspaceHolders: () => [],
    guideParticipant: async (workerId, message, { actor } = {}) => {
      prompts.push({ workerId, message });
      if (guideLane) {
        messages += 1;
        store.recordMessage('message.sent', {
          kind: 'nudge', to: { workerId }, from: 'orchestrator', messageId: `m-${messages}`,
        }, { actor: actor ?? 'swarm', key: `receipts-message:${messages}` });
      }
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
  // The admission refuses each id's FIRST start exactly once, then answers: a rolled-back recruit
  // CAN be admitted when the deployment answers again — that is what makes the resume path real.
  const refusedOnce = new Set();
  const runtime = new SwarmRuntime({
    store, coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      assert.equal(store.hasSwarmParticipantRun(request.runId), true, 'membership must precede the first native turn');
      if (refusedOnce.has(request.participantId)) {
        refusedOnce.delete(request.participantId);
        throw Object.assign(new Error('route refused this recruitment'), { code: 'application_route_not_allowed' });
      }
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async (runId) => {
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  const recruit = (participantId, permissions, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  }, caller);
  return { store, runtime, coordinator, workers, prompts, starts, checks, call, recruit, refusedOnce };
}

const isReceipt = (receipt, command) => {
  assert.equal(receipt.command, command);
  assert.equal(typeof receipt.event.seq, 'number');
  assert.equal(typeof receipt.event.ts, 'string');
  assert.equal(typeof receipt.event.actor, 'string');
  assert.ok(receipt.event.kind.length > 0);
  for (const row of receipt.changed) {
    assert.equal(typeof row.collection, 'string');
    assert.ok(row.id !== null && row.id !== undefined);
    assert.equal(typeof row.seq, 'number');
  }
};

test('#302 every swarm mutation answers with a receipt, and only view:true carries the view', async (t) => {
  const f = fixture(t, { guideLane: true });
  // create
  const created = await f.call('create', { purpose: 'Receipt contract' });
  isReceipt(created.receipt, 'swarm.create');
  assert.equal(created.receipt.event.kind, 'swarm.created');
  assert.deepEqual(created.receipt.changed,
    [{ collection: 'swarm', id: created.swarmId, seq: created.receipt.event.seq, ts: created.receipt.event.ts }]);
  assert.deepEqual(created.next, { command: 'swarm.recruit', args: { swarmId: created.swarmId } });
  assert.equal('view' in created, false);

  // recruit (with the binding write folded into changed) — and the opt-in view
  const recruited = await f.call('recruit', { participantId: 'builder', objective: 'build', view: true });
  isReceipt(recruited.receipt, 'swarm.recruit');
  assert.equal(recruited.receipt.event.kind, 'swarm.participant_joined');
  assert.deepEqual(
    recruited.receipt.changed.map(({ collection, id, seq }) => ({ collection, id, seq })),
    [{ collection: 'participants', id: 'builder', seq: recruited.receipt.event.seq + 1 }],
    'the join and its binding land as one changed participants row, written by the binding event');
  assert.deepEqual(recruited.next, { command: 'swarm.guide', args: { swarmId: 'baton', participantId: 'builder' } });
  assert.equal(recruited.view.participants.length, 1, 'view: true carries the whole refreshed view');

  // update
  const updated = await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'g', members: ['builder'] } });
  isReceipt(updated.receipt, 'swarm.update');
  assert.equal(updated.receipt.event.kind, 'swarm.group_updated');
  assert.deepEqual(updated.receipt.changed, [{ collection: 'groups', id: 'g', seq: updated.receipt.event.seq, ts: updated.receipt.event.ts }]);
  assert.deepEqual(updated.next, { command: 'swarm.view', args: { swarmId: 'baton' } });

  // guide — the receipt's event is the guide's OWN durable row (#273), which names the lane
  // receipt it rode; the next step names the observation the sender waits for.
  const guided = await f.call('guide', { participantId: 'builder', message: 'Focus' });
  isReceipt(guided.receipt, 'swarm.guide');
  assert.equal(guided.receipt.event.kind, 'swarm.guidance_sent');
  assert.equal(guided.guide.seq, guided.receipt.event.seq, 'the receipt event IS the guide\'s row');
  assert.equal(guided.guide.delivery.state, 'delivered');
  assert.deepEqual(guided.next, { command: 'swarm.watch', args: { swarmId: 'baton' },
    observation: { wakeClass: 'paused', participantId: 'builder' } },
  'next names the seat\'s next turn boundary');

  // capture
  const captured = await f.call('capture', { participantId: 'builder', contributionId: 'c1' });
  isReceipt(captured.receipt, 'swarm.capture');
  assert.equal(captured.receipt.event.kind, 'swarm.contribution_recorded');
  assert.deepEqual(captured.receipt.changed.map((row) => row.collection).sort(), ['contributions']);
  assert.deepEqual(captured.next,
    { command: 'swarm.view', args: { swarmId: 'baton' } });

  // close (swarm.update event swarm.closed)
  const closed = await f.call('update', { event: 'swarm.closed', payload: { reason: 'done' } });
  isReceipt(closed.receipt, 'swarm.update');
  assert.equal(closed.receipt.event.kind, 'swarm.closed');
  assert.deepEqual(closed.next, { command: 'swarm.list', args: {} });
});

test('#302 a stop answers with the receipt of the operation row that recorded it', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Stop receipt' });
  await f.recruit('builder');
  const stopped = await f.call('stop', { participantId: 'builder', reason: 'No longer needed' });
  isReceipt(stopped.receipt, 'swarm.stop');
  // Issue #350: the row a stop records is the seat's settled membership, so the receipt's
  // event is the participant_left row and the participant row is what changed.
  assert.equal(stopped.receipt.event.kind, 'swarm.participant_left');
  assert.ok(stopped.receipt.changed.some((row) => row.collection === 'participants' && row.id === 'builder'),
    'the stop receipt names the settled participant row');
  assert.deepEqual(stopped.next, { command: 'swarm.view', args: { swarmId: 'baton' } });
  assert.equal(f.workers[0].status, 'dead');
});

test('#302 one collection shape rides every read path: view, watch, bridge, and MCP', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'One shape everywhere' });
  await f.recruit('builder', SWARM_PERMISSIONS);
  await f.call('update', { event: 'swarm.group_updated', payload: { groupId: 'g', members: ['builder'] } });
  await f.call('update', { event: 'swarm.contribution_recorded', payload: { contributionId: 'c1', participantId: 'builder', body: 'A finding.' } }, { actor: 'worker:w-1', principalId: 'worker:w-1', sessionId: 'w-1' });

  const shapeOf = (view) => ({
    participants: Array.isArray(view.participants),
    contributions: Array.isArray(view.contributions),
    groups: Array.isArray(view.groups),
    couplings: Array.isArray(view.couplings),
    attention: Array.isArray(view.attention),
    workKeyed: view.work !== null && !Array.isArray(view.work),
    assignmentsKeyed: view.assignments !== null && !Array.isArray(view.assignments),
    reviewsKeyed: view.reviews !== null && !Array.isArray(view.reviews),
    contextKeyed: view.context !== null && !Array.isArray(view.context),
  });
  const expected = {
    participants: true, contributions: true, groups: true, couplings: true, attention: true,
    workKeyed: true, assignmentsKeyed: true, reviewsKeyed: true, contextKeyed: true,
  };

  // 1. the view
  assert.deepEqual(shapeOf(await f.call('view')), expected);

  // 2. the watch frame
  const cursor = f.store.ledgerHeadSeq();
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'k', body: 'wake' } });
  const woke = await f.call('watch', { afterSeq: cursor, timeoutMs: 1000 });
  assert.equal(woke.watch.reason, 'event');
  assert.deepEqual(shapeOf(woke), expected);

  // 3. the native bridge
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
  });
  t.after(() => bridge.close());
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'builder', runId: f.workers[0].runId });
  const bridged = await swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: 'baton' } }, { env: issued.env });
  assert.deepEqual(shapeOf(bridged), expected);

  // 4. the MCP tool (structuredContent of the ordinary baton_swarm_view tool)
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-receipts-mcp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const NOW = Date.parse('2026-09-14T00:00:00.000Z');
  const REPO_ID = 'repo-swarm-receipts';
  const server = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application: {
      repoId: REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async authorizeReplay() { return true; },
      async command(name, args, principal, context) {
        // Transport envelope fields (repoId) never reach the swarm contract; reads take no key.
        const { repoId, idempotencyKey, ...swarmArgs } = args;
        return f.runtime.command(name,
          { ...swarmArgs, ...(['swarm.view', 'swarm.watch', 'swarm.list', 'swarm.capture'].includes(name) ? {} : { idempotencyKey: idempotencyKey ?? 'mcp-key' }) },
          principal, context);
      },
      async contextEval() { throw new Error('unused'); },
      async decisionList() { return { decisions: [] }; },
    },
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const called = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'baton_swarm_view', arguments: { repoId: REPO_ID, swarmId: 'baton' } } });
  assert.equal(called.error, undefined, JSON.stringify(called.error ?? null));
  assert.deepEqual(shapeOf(called.result.structuredContent), expected,
    'the MCP tool returns the same collection shape as structuredContent');
  // The mutation tool schemas carry the receipt contract: view is a boolean on swarm.create.
  const tools = (await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })).result.tools;
  assert.equal(tools.find((entry) => entry.name === 'baton_swarm_create').inputSchema.properties.view.type, 'boolean');
});

test('#301 recruit returns advisory scopeOverlap across the repository swarms, never a refusal', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Scope truth' });
  await f.call('recruit', { participantId: 'a', objective: 'a', options: { scope: ['impl/**', 'docs/**'] } });
  // A second swarm in the same repository holds an ACTIVE participant whose scope overlaps.
  const other = await f.runtime.command('swarm.create', { swarmId: 'other', purpose: 'Second swarm', idempotencyKey: 'other-create' }, owner);
  await f.runtime.command('swarm.recruit', { swarmId: other.swarmId, participantId: 'b', objective: 'b',
    options: { scope: ['impl/**'] }, idempotencyKey: 'other-recruit' }, owner);
  const scoped = await f.call('recruit', { participantId: 'c', objective: 'c', options: { scope: ['impl/**'] } });
  assert.deepEqual(scoped.scopeOverlap, [
    { swarmId: 'baton', participantId: 'a', paths: ['impl/**'] },
    { swarmId: other.swarmId, participantId: 'b', paths: ['impl/**'] },
  ]);
  // Advisory only: the recruit succeeded despite the overlap.
  assert.equal(f.store.swarm('baton').participants.c.status, 'active');
  // No requested scope: nothing is compared, the row is empty.
  const unscoped = await f.call('recruit', { participantId: 'd', objective: 'd' });
  assert.deepEqual(unscoped.scopeOverlap, []);
  // A disjoint scope names nobody.
  const disjoint = await f.call('recruit', { participantId: 'e', objective: 'e', options: { scope: ['spec/**'] } });
  assert.deepEqual(disjoint.scopeOverlap, []);
});

test('#308 a refused recruit rolls its join back durably, and a repeated recruit of the same id resumes', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Rollback truth' });
  f.refusedOnce.add('ghost');
  const first = await f.call('recruit', { participantId: 'ghost', objective: 'first attempt' })
    .then(() => null, (error) => error);
  assert.equal(first.code, 'application_route_not_allowed', 'the caller sees the original admission refusal');
  const rolled = f.store.swarm('baton').participants.ghost;
  assert.equal(rolled.status, 'left', 'the join was rolled back');
  assert.equal(rolled.leftReason, 'recruit_refused');
  assert.equal(rolled.leftCode, 'application_route_not_allowed', 'the durable leave carries the typed code');
  const view = await f.call('view');
  assert.equal(view.participants.some((row) => row.participantId === 'ghost' && row.status === 'active'), false,
    'no phantom active member stays in the swarm');
  // The repeated recruit of the same id resumes the rolled-back join.
  const resumed = await f.call('recruit', { participantId: 'ghost', objective: 'second attempt' });
  assert.equal(resumed.participantId, 'ghost');
  const resumedRow = f.store.swarm('baton').participants.ghost;
  assert.equal(resumedRow.status, 'active');
  assert.equal(resumedRow.role, 'second attempt');
  assert.equal(f.workers.some((row) => row.runId === resumedRow.runId), true, 'the resumed seat is bound to its run');
  // An ACTIVE row is still a duplicate: swarm_participant_exists, as itself.
  const exists = await f.call('recruit', { participantId: 'ghost', objective: 'third' }).then(() => null, (error) => error);
  assert.equal(exists.code, 'swarm_participant_exists');
  assert.deepEqual(exists.detail, { participantId: 'ghost', status: 'active' });
});

test('#308 swarm_participant_exists crosses the CLI envelope as itself with retryable:false', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'CLI envelope truth' });
  await f.recruit('builder');
  const refused = await f.call('recruit', { participantId: 'builder', objective: 'again' }).then(() => null, (error) => error);
  assert.equal(refused.code, 'swarm_participant_exists');
  // The one normalization the CLI catch applies — the code crosses untouched, and the verdict
  // is that retrying the same request can never work.
  const envelope = normalizeControlSurfaceError(refused);
  assert.equal(envelope.error.code, 'swarm_participant_exists');
  assert.equal(envelope.error.retryable, false);
  assert.equal(BatonControlError.from(refused).envelope().error.code, 'swarm_participant_exists');
});

test('#308 a refused operation settles its attention row, and in-flight rows never carry the request body', async (t) => {
  const f = fixture(t);
  f.refusedOnce.add('ghost');
  await f.call('create', { purpose: 'Attention settlement' });
  // A recruit whose admission refuses inside its operation: the lane records requested and
  // unavailable rows, and the attention row reads SETTLED, not unconfirmed forever.
  const refused = await f.call('recruit', { participantId: 'ghost', objective: 'refused admission' })
    .then(() => null, (error) => error);
  assert.equal(refused.code, 'application_route_not_allowed');
  const view = await f.call('view');
  const settled = view.attention.find((row) => row.kind === 'operation_refused');
  assert.ok(settled, 'the refused operation has a settled attention row');
  assert.equal(settled.state, 'refused');
  assert.equal(settled.code, refused.code);
  assert.equal(view.attention.some((row) => row.kind === 'operation_unconfirmed' && row.operationKey === settled.operationKey), false,
    'the row no longer claims the outcome is unconfirmed');
  // The durable in-flight row carries the request DIGEST, never the request body.
  const requested = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.operation_requested');
  assert.ok(requested.length > 0);
  for (const event of requested) {
    assert.equal(event.payload.request, undefined, 'no request body on the in-flight row');
    assert.match(event.payload.requestDigest, /^[a-f0-9]{64}$/u);
  }
});

// ── #301 base derivation over a real repository ────────────────────────────────────────────────

function gitFixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'baton-swarm-base-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const run = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  run(['-c', 'init.defaultBranch=main', 'init']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'swarm@example.test', GIT_COMMITTER_EMAIL: 'swarm@example.test' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Swarm Test', GIT_COMMITTER_NAME: 'Swarm Test' });
  mkdirSync(join(repo, 'impl'));
  writeFileSync(join(repo, 'impl', 'a.txt'), 'one\n');
  run(['add', '.']);
  run(['commit', '-m', 'initial']);
  const worktree = join(repo, 'wt-builder');
  run(['worktree', 'add', worktree, '-b', 'baton/builder', 'HEAD']);
  return { repo, worktree, run };
}

test('#301 participant rows carry their repository base at read time, and capture records the merge-base', async (t) => {
  const g = gitFixture(t);
  const f = fixture(t);
  // Give the builder's worker the session context of a real Baton worktree.
  const realStart = f.runtime.startRun;
  f.runtime.startRun = async (request, principal, context) => {
    await realStart(request, principal, context);
    const worker = f.workers.find((row) => row.runId === request.runId);
    worker.sessionContext = { worktree: g.worktree, repoRoot: g.repo, ownerTaskId: worker.taskId };
  };
  await f.call('create', { purpose: 'Base truth' });
  await f.recruit('builder');
  const view = await f.call('view');
  const base = view.participants[0].base;
  assert.equal(base.target, 'main', 'the target is the deployment default branch');
  assert.match(base.observedHead, /^[a-f0-9]{40}$/u);
  assert.equal(base.behind, 0);
  // Drift at read time: a commit lands on the target, the seat is now behind.
  writeFileSync(join(g.repo, 'impl', 'a.txt'), 'two\n');
  g.run(['commit', '-am', 'target moves']);
  const drifted = await f.call('view');
  assert.equal(drifted.participants[0].base.behind, 1);
  // Capture pins the merge-base with the target on the capture row.
  const head = g.run(['rev-parse', 'HEAD'], g.worktree);
  f.coordinator.captureContribution = async (workerId, { contributionId }) => ({
    contributionId, workerId, sha: head, ref: `refs/baton/checkpoints/${head}`, observedHead: head,
  });
  const captured = await f.call('capture', { participantId: 'builder', contributionId: 'rev' });
  assert.equal(captured.mergeBase, head, 'the revision descends from the current target tip');
  const row = f.store.swarm('baton').contributions.rev.revision;
  assert.equal(row.mergeBase, head);
  assert.equal(row.observedHead, head);
  // An unbound seat (no worker, no checkout) reads base: null — absence, never a guess.
  const bound = f.workers.slice();
  f.workers.length = 0;
  const unbound = await f.call('view');
  assert.equal(unbound.participants[0].base, null);
  f.workers.push(...bound);
});

test('#301 a capture whose base cannot reach the deployment target is refused typed', async (t) => {
  const g = gitFixture(t);
  const f = fixture(t);
  const realStart = f.runtime.startRun;
  f.runtime.startRun = async (request, principal, context) => {
    await realStart(request, principal, context);
    const worker = f.workers.find((row) => row.runId === request.runId);
    worker.sessionContext = { worktree: g.worktree, repoRoot: g.repo, ownerTaskId: worker.taskId };
  };
  await f.call('create', { purpose: 'Unreachable truth' });
  await f.recruit('builder');
  // The target's history is replaced by an unrelated root: the seat's base can never reach it.
  g.run(['checkout', '--orphan', 'replaced-target']);
  g.run(['commit', '-m', 'unrelated root', '--allow-empty']);
  const head = g.run(['rev-parse', 'HEAD'], g.worktree);
  f.coordinator.captureContribution = async (workerId, { contributionId }) => ({
    contributionId, workerId, sha: head, ref: `refs/baton/checkpoints/${head}`, observedHead: head,
  });
  const refused = await f.call('capture', { participantId: 'builder', contributionId: 'doomed' })
    .then(() => null, (error) => error);
  assert.equal(refused.code, 'swarm_capture_base_unreachable');
  assert.equal(refused.detail.target, 'replaced-target');
  assert.match(refused.detail.observedHead, /^[a-f0-9]{40}$/u);
  assert.equal(f.store.swarm('baton').contributions.doomed, undefined, 'nothing was pinned');
});
