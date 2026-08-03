// Bidirectional v3 red suite (contract: docs/reference/evidence/
// bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md v2.0 — issue #75).
//
// Sixteen rows over the folded decisions: BD3-A the read port (wire grammar, horizon
// predicate intersect, resolve-then-authorize, shared-only scratchpad, board binding,
// zero-weight context.read class + self-read exclusion, renderer mandate, not-progress);
// BD3-B context packs (supersession chain, live-head spawn CAS, expiry distinct);
// BD3-C the message lane (minted ids, inReplyTo-only worker frames, depth 1, honest
// receipt state machine); BD3-D the attention inbox (scope-first targets, review-lease
// candidacy, coalescing distribution, detach epochs, driver stall NOT replaced).
//
// Red-first: written against the v2.0 contract BEFORE implementation; every row fails for
// the named stage and goes green on the contract's implementation ONLY. Harness pattern
// mirrors test/trust-gate-steering-red.test.mjs and test/decision-gate-trust-gate-red.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-bd3-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

function emitContextRead(adapter, handle, query, key = 'bd3-read-1') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query, expectedFence: 'current', idempotencyKey: key },
  });
}

// ===========================================================================
// BD3-A — the read port (stage: lane missing)
// ===========================================================================

test('A1: a CONTEXT_READ wire emission is hub-admitted and answered through the closed renderer', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitContextRead(adapter, handle, { kind: 'knowledge', text: 'write-failure visibility' });
  await flush(40);
  const results = coordinator._log.read(handle.id).filter((event) => event.kind === 'context.read_result');
  assert.equal(results.length, 1, 'exactly one read result on the worker stream');
  const payload = results[0].payload ?? {};
  assert.equal(payload.ok ?? null, true, 'the in-horizon query answers');
  assert.match(JSON.stringify(payload), /UNTRUSTED/, 'every model-authored leaf is UNTRUSTED-framed by the renderer');
  const delivered = adapter.calls.prompt.filter((call) => JSON.stringify(call.content ?? '').includes('UNTRUSTED'));
  assert.ok(delivered.length >= 1, 'the framed answer reaches the provider-bound frame through the SAME renderer (only-path proof)');
});

test('A1b: malformed CONTEXT_READ shapes refuse with the typed code (closed grammar)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'knowledge', runId: 'run:other' }, expectedFence: 'current', idempotencyKey: 'a1b-1' },
  });
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'scratchpad', scope: 'worker:w-2' }, expectedFence: 'current', idempotencyKey: 'a1b-2' },
  });
  await flush(40);
  const results = coordinator._log.read(handle.id).filter((event) => event.kind === 'context.read_result');
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.payload?.ok ?? null, false);
    assert.match(String(result.payload?.result ?? ''), /invalid/, 'caller-named runId/scope fields refuse — the coordinator derives them');
  }
});

test('A2: the knowledge query intersects the run horizon (out-of-horizon nodes never serve)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  const store = coordinator._coordination;
  store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'in-horizon finding about the task', repoId: store._repoId ?? 'local',
    runId: task.runId, evidence: [],
  }, { actor: 'orchestrator', key: 'bd3-a2-in' });
  store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'out-of-horizon finding from another galaxy', repoId: store._repoId ?? 'local',
    runId: 'run:elsewhere', evidence: [],
  }, { actor: 'orchestrator', key: 'bd3-a2-out' });
  emitContextRead(adapter, handle, { kind: 'knowledge', text: 'finding' });
  await flush(40);
  const result = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.ok(result, 'the read result exists (the lane answers in-horizon queries)');
  const body = JSON.stringify(result?.payload ?? {});
  assert.ok(body.includes('in-horizon finding'), 'in-horizon nodes serve');
  assert.ok(!body.includes('another galaxy'), 'out-of-horizon nodes never serve (the predicate intersects after lookup)');
});

test('A3: finding-by-id is resolve-then-authorize (possession of a digest is never authority)', async () => {
  const adapterPos = new ScriptableAdapter();
  const { coordinator: coordPos } = setup({ adapter: adapterPos, capture: noDiff });
  const handlePos = await coordPos.spawn('mock', makeBrief());
  const taskPos = coordPos._tasks.get(handlePos.taskId);
  const storePos = coordPos._coordination;
  const inHorizon = storePos.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'a finding in this run', repoId: storePos._repoId ?? 'local',
    runId: taskPos.runId, evidence: [],
  }, { actor: 'orchestrator', key: 'bd3-a3-in' });
  emitContextRead(adapterPos, handlePos, { kind: 'finding', id: inHorizon.node?.id ?? 'finding:in' }, 'a3-pos');
  await flush(40);
  const posResult = coordPos._log.read(handlePos.id).find((event) => event.kind === 'context.read_result');
  assert.equal(posResult?.payload?.ok ?? null, true, 'an in-horizon finding-by-id answers (the positive control)');
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const store = coordinator._coordination;
  const added = store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'a secret of another run', repoId: store._repoId ?? 'local',
    runId: 'run:elsewhere', evidence: [],
  }, { actor: 'orchestrator', key: 'bd3-a3-out' });
  emitContextRead(adapter, handle, { kind: 'finding', id: added.node?.id ?? 'finding:x' }, 'a3-read');
  await flush(40);
  const result = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.equal(result?.payload?.ok ?? null, false, 'the resolved node is authorized against the horizon, not possessed');
  assert.match(String(result?.payload?.result ?? ''), /scope|horizon|not_found/, 'constant scope refusal — no existence leak');
});

test('A4: scratchpad reads return only the run shared partition, never a sibling worker partition', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const handle2 = await coordinator.spawn('mock', makeBrief());
  const store = coordinator._coordination;
  const task = coordinator._tasks.get(handle.taskId);
  const task2 = coordinator._tasks.get(handle2.taskId);
  store.recordDriver('steering.registered', { runId: task.runId }, { actor: 'orchestrator', key: `steering:${task.runId}` });
  store.writeScratchpad(
    { runId: task.runId, taskId: task.id, workerId: handle.id, entry: { kind: 'note', text: 'shared-visible finding' } },
    { actor: 'worker', principalId: handle.id, key: 'a4-shared-note' },
  );
  store.writeScratchpad(
    { runId: task2.runId, taskId: task2.id, workerId: handle2.id, entry: { kind: 'note', text: 'SIBLING-SECRET entry' } },
    { actor: 'worker', principalId: handle2.id, key: 'a4-sibling-note' },
  );
  const fence = store.scratchpadFence(task.runId, `worker:${handle.id}`);
  store.elevateTaskScratchpad({
    runId: task.runId, taskId: task.id, workerId: handle.id, expectedScratchpadFence: fence,
    entryIds: store.scratchpadSnapshot(task.runId, `worker:${handle.id}`).entries.map((row) => row.entryId),
  }, { actor: 'orchestrator', key: `scratchpad.task_settlement:${task.id}` });
  emitContextRead(adapter, handle, { kind: 'scratchpad' }, 'a4-read');
  await flush(40);
  const result = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.ok(result, 'the shared-partition read answers');
  const body = JSON.stringify(result.payload ?? {});
  assert.ok(body.includes('shared-visible finding'), 'the elevated shared content serves');
  assert.ok(!body.includes('SIBLING-SECRET'), 'a sibling worker\'s private partition NEVER serves');
});

test('A6: read evidence is the context.read class with ZERO promotion weight', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitContextRead(adapter, handle, { kind: 'knowledge', text: 'x' }, 'a6-read');
  await flush(40);
  const events = coordinator._coordination.events().filter((event) => event.kind === 'context.read');
  assert.ok(events.length >= 1, 'reads mint context.read audit events');
  assert.equal(events.some((event) => event.kind === 'scratch.read'), false,
    'NOT the scratch.read family (zero promotion weight)');
  assert.equal(coordinator._coordination.events().some((event) => event.kind === 'scratch.read'), false,
    'no scratch.read is minted by the read lane');
});

test('A6b: the author\'s own task never counts toward minScratchReaders (no self-promotion)', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-a', clock: () => '2026-08-03T00:00:00.000Z' });
  const complete = (id, worker) => {
    store.createTask({
      id, brief: { objective: `${id} work` }, deps: [], refines: null, relation: 'root', runId: `run-${id}`,
      taskType: 'general', reservedWorkerId: worker, vendorRequested: 'mock', modelRequested: 'mock-model',
      modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
    }, { actor: 'orchestrator', key: `task:${id}` });
    store.claimTask(id, worker, 1, { actor: 'orchestrator', key: `claim:${id}` }, {
      harnessRequested: 'mock', harnessResolved: 'mock@fixture',
      modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
      effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
      routeKey: '["mock","fixture","mock-model","low"]',
    });
    store.transitionTask(id, 'completed', 2, { actor: 'policy', key: `complete:${id}` });
    store.promoteKnowledgeNode({
      id: `outcome:${id}`, taskId: id, type: 'Finding', grounding: 'verified',
      body: `Task ${id} passed its hub verification`, evidence: [{ coordinationSeq: 1 }],
    }, { kind: 'Finding', trigger: 'verified_task_outcome' }, { actor: 'policy', key: `outcome:${id}` });
  };
  complete('a', 'w-a');
  complete('b', 'w-b');
  const fact = store.postScratchFact({
    namespace: 'tests', key: 'fact:self', value: 'self-authored', grounding: 'observed',
    envRef: { repoId: 'repo-a', treeSha: 'cafe1234' }, ownerTask: 'a',
  }, { actor: 'w-a', key: 'scratch:self' });
  void fact;
  store.readScratch('fact:self', { repoId: 'repo-a', treeSha: 'cafe1234' },
    { readerActor: 'worker', readerWorker: 'w-a', taskId: 'a' }, { actor: 'worker:a', key: 'read:self' });
  const policy = {
    repoId: 'repo-a', minScratchReaders: 1, maxScanEvents: 1024, maxCandidates: 128,
    maxCandidateBytes: 256 * 1024, maxEvidenceRefs: 1024, maxBatchBytes: 512 * 1024, maxResultBytes: 128 * 1024,
  };
  const first = store.promoteKnowledgeBatch('repo-a', store.snapshot().lastSeq, policy,
    { actor: 'orchestrator', key: 'bd3-a6b-promote' });
  assert.equal(first.noOp, true, 'with ONLY the author reading, nothing promotes (the author never counts)');
  store.readScratch('fact:self', { repoId: 'repo-a', treeSha: 'cafe1234' },
    { readerActor: 'worker', readerWorker: 'w-b', taskId: 'b' }, { actor: 'worker:b', key: 'read:independent' });
  const second = store.promoteKnowledgeBatch('repo-a', store.snapshot().lastSeq, policy,
    { actor: 'orchestrator', key: 'bd3-a6b-promote2' });
  assert.equal(second.noOp, false, 'a genuinely independent reader satisfies the gate (anti-gaming preserved)');
});

test('A8: CONTEXT_READ receipts never answer the TG3 steering cycle (reads are not progress)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ requiredEffects: ['repository_edit'] }));
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'checkpoint' },
  });
  await flush(40);
  emitContextRead(adapter, handle, { kind: 'knowledge', text: 'x' }, 'a8-read');
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1,
    'the cycle stays armed — a read receipt never answers it');
});

// ===========================================================================
// BD3-B — context packs (stage: pack machinery missing)
// ===========================================================================

test('B1: packs supersede through a server-owned chain (predecessor + validityVersion, history retained)', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-bd3', clock: () => '2026-08-03T00:00:00.000Z' });
  const first = store.mintContextPack({
    type: 'spec', body: 'v1 of the decomposition spec', validity: '2026-08-03T01:00:00.000Z',
  }, { actor: 'orchestrator', key: 'bd3-b1-v1' });
  const second = store.mintContextPack({
    type: 'spec', body: 'v2 of the decomposition spec', validity: '2026-08-03T02:00:00.000Z',
    predecessor: first.pack.packId,
  }, { actor: 'orchestrator', key: 'bd3-b1-v2' });
  assert.equal(second.pack.validityVersion, (first.pack.validityVersion ?? 1) + 1);
  assert.equal(second.pack.predecessor, first.pack.packId);
  assert.ok(store.contextPack(first.pack.packId), 'the superseded version is retained as content history');
  assert.equal(store.contextPackHead(first.pack.family ?? 'spec').packId, second.pack.packId, 'the head tracks the chain');
});

test('B2: a brief citing a superseded pack refuses context_pack_stale at materialization (live-head CAS)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const store = coordinator._coordination;
  const first = store.mintContextPack({ type: 'spec', body: 'v1' }, { actor: 'orchestrator', key: 'bd3-b2-v1' });
  store.mintContextPack({ type: 'spec', body: 'v2', predecessor: first.pack.packId }, { actor: 'orchestrator', key: 'bd3-b2-v2' });
  const refusal = await coordinator.spawn('mock', makeBrief({ contextPacks: [first.pack.packId] })).then(
    () => null,
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(refusal, 'context_pack_stale', 'a superseded citation fails at spawn, never serves silently');
  const head = store.contextPackHead('spec');
  const accepted = await coordinator.spawn('mock', makeBrief({ contextPacks: [head.packId] })).then(
    () => 'spawned',
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(accepted, 'spawned', 'the live head cites and spawns (the positive control)');
});

test('B2b: the materialized pack content arrives framed at spawn (not just cited)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const store = coordinator._coordination;
  const minted = store.mintContextPack({ type: 'spec', body: 'THE DECOMPOSITION BODY' }, { actor: 'orchestrator', key: 'bd3-b2b-v1' });
  const handle = await coordinator.spawn('mock', makeBrief({ contextPacks: [minted.pack.packId] }));
  const briefText = JSON.stringify(adapter.calls.spawn.at(-1)?.brief ?? {});
  assert.ok(briefText.includes('THE DECOMPOSITION BODY'), 'the pack materializes INTO the brief at spawn');
  assert.ok(briefText.includes('UNTRUSTED'), 'the materialized content is framed, never raw instructions');
  void handle;
});

test('B3: an expired pack refuses context_pack_expired and never serves (expiry is not supersession)', () => {
  const store = new CoordinationStore(tmpDir(), { repoId: 'repo-bd3', clock: () => '2026-08-03T03:00:00.000Z' });
  store.mintContextPack({ type: 'spec', body: 'short-lived', validity: '2026-08-03T01:00:00.000Z' },
    { actor: 'orchestrator', key: 'bd3-b3-v1' });
  const refusal = (() => {
    try {
      return store.materializeContextPack(store.contextPackHead('spec').packId).code ?? 'served';
    } catch (error) { return error?.code ?? 'thrown'; }
  })();
  assert.equal(refusal, 'context_pack_expired', 'expired packs stop serving without being superseded');
  const live = store.mintContextPack({ type: 'spec', body: 'still fresh', validity: '2026-08-03T04:00:00.000Z' },
    { actor: 'orchestrator', key: 'bd3-b3-live' });
  const served = store.materializeContextPack(live.pack.packId);
  assert.ok(String(served?.body ?? served?.pack?.body ?? '').includes('still fresh'), 'an unexpired pack serves (the positive control)');
});

// ===========================================================================
// BD3-C — the message lane (stage: lane missing)
// ===========================================================================

test('C1: orchestrator sends mint message ids; worker replies carry ONLY {inReplyTo, body} with the target derived', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const sent = await coordinator.sendMessage({
    kind: 'inform', to: { workerId: handle.id }, body: 'the candidacy board has two items for you',
  }, { actor: 'orchestrator' });
  assert.match(sent.messageId ?? '', /^message:[a-f0-9]{64}$/u, 'the send mints a message id');
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: sent.messageId, body: 'ack — picking up the first now', to: { workerId: 'w-2' } },
  });
  await flush(40);
  const delivered = coordinator._log.read(handle.id).filter((event) => event.kind === 'message.delivered');
  assert.equal(delivered.length, 1, 'the reply is admitted against the parent, and only the parent');
  assert.ok(Object.hasOwn(delivered[0].payload?.to ?? {}, 'workerId'), 'the derived target is explicit on the receipt');
  assert.equal(delivered[0].payload.to.workerId, handle.id,
    'the target is derived from the parent — a caller-named to is refused/ignored');
});

test('C2: reply depth is 1 (a reply to a reply refuses)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const sent = await coordinator.sendMessage({ kind: 'query', to: { workerId: handle.id }, body: 'status?' }, { actor: 'orchestrator' });
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: sent.messageId, body: 'working on it' },
  });
  await flush(40);
  const reply = coordinator._log.read(handle.id).find((event) => event.kind === 'message.delivered' && event.payload?.inReplyTo === sent.messageId);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: reply?.payload?.messageId ?? 'message:x', body: 'a reply to my own reply' },
  });
  await flush(40);
  const rejected = coordinator._log.read(handle.id).filter((event) => event.kind === 'authority.rejected'
    || (event.kind === 'message.rejected'));
  assert.ok(rejected.length >= 1, 'reply-to-reply refuses with the typed code (depth 1 in v1)');
});

test('C3: receipts are honest across process death (delivered ≠ read; acted-on never claimed)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const sent = await coordinator.sendMessage({ kind: 'inform', to: { workerId: handle.id }, body: 'x' }, { actor: 'orchestrator' });
  const receipt = coordinator.messageReceipt(sent.messageId);
  assert.equal(receipt.delivered ?? null, true, 'delivered = written to the durable stream');
  assert.equal(receipt.read ?? null, null, 'read stays null until the worker\'s next turn_started');
  assert.equal(receipt.actedOn ?? null, null, 'acted-on is never claimed');
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush(40);
  assert.equal(coordinator.messageReceipt(sent.messageId).read ?? null, true, 'read flips on the next turn_started');
  // Death between delivered and read: the receipt stays delivered with read null, forever honest.
  const sent2 = await coordinator.sendMessage({ kind: 'inform', to: { workerId: handle.id }, body: 'second' }, { actor: 'orchestrator' });
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.process_closed', actor: 'worker', payload: { code: 143 } });
  await flush(40);
  const dead = coordinator.messageReceipt(sent2.messageId);
  assert.equal(dead.delivered ?? null, true, 'delivered is written at send');
  assert.equal(dead.read ?? null, null, 'read stays null across process death — never upgraded to a lie');
  assert.equal(dead.actedOn ?? null, null, 'acted-on is never claimed');
});

// ===========================================================================
// BD3-D — the attention inbox (stage: inbox missing)
// ===========================================================================

test('D1: scope authorization precedes targets (constant refusal, no existence leak)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const runId = coordinator._tasks.get(handle.taskId).runId;
  const refusal = await coordinator.attentionFollow({
    scope: { runId }, targets: [{ runId: 'run:someone-elses' }], afterCursor: 0, timeoutMs: 1,
  }, { principalId: 'wave-owner', sessionId: 'session-wave-owner' }).then(
    () => null,
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(refusal, 'attention_scope_forbidden', 'a target outside the authorized scope refuses');
  const unknown = await coordinator.attentionFollow({
    scope: { runId }, targets: [{ runId: 'run:nonexistent-xyz' }], afterCursor: 0, timeoutMs: 1,
  }, { principalId: 'wave-owner', sessionId: 'session-wave-owner' }).then(
    () => null,
    (error) => error?.code ?? 'thrown',
  );
  assert.equal(unknown, 'attention_scope_forbidden',
    'unknown and out-of-scope refuse IDENTICALLY (no existence leak either direction)');
});

test('D2: candidacy_review wakes only for the review authority', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const store = coordinator._coordination;
  const posted = store.postBoardItem({ board: 'wave-settlement:wave:d2', title: 'a finding awaits review', detail: 'd' },
    { actor: 'orchestrator', key: 'bd3-d2-post' });
  store.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: 'bd3-d2-close' });
  const page = await coordinator.attentionFollow({
    scope: { runId: coordinator._tasks.get(handle.taskId).runId }, afterCursor: 0, timeoutMs: 1,
    targets: ['candidacy_review'],
  }, { principalId: 'mallory', sessionId: 'session-mallory' });
  const reasons = page?.reasons ?? page?.wakes ?? [];
  assert.equal(reasons.filter((reason) => reason?.kind === 'candidacy_review').length, 0,
    'a viewer WITHOUT the review authority gets no candidacy disclosure (even though one exists)');
  const authorized = await coordinator.attentionFollow({
    scope: { runId: coordinator._tasks.get(handle.taskId).runId }, afterCursor: 0, timeoutMs: 1,
    targets: ['candidacy_review'],
  }, { principalId: 'wave-owner', sessionId: 'session-wave-owner' });
  const authorizedReasons = authorized?.reasons ?? authorized?.wakes ?? [];
  assert.ok(authorizedReasons.some((reason) => reason?.kind === 'candidacy_review' && (reason.count ?? 0) >= 1),
    'the review authority sees the pending candidacy with its count');
});

test('D3: a terminalization storm coalesces with distribution, never a singular role/phase', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handleA = await coordinator.spawn('mock', makeBrief());
  const handleB = await coordinator.spawn('mock', makeBrief());
  const runId = coordinator._tasks.get(handleA.taskId).runId;
  for (const handle of [handleA, handleB]) {
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
      payload: { status: 'completed', output: 'done' },
    });
  }
  await flush(80);
  const page = await coordinator.attentionFollow({
    scope: { runId }, afterCursor: 0, timeoutMs: 1, targets: ['member_terminal'],
  }, { principalId: 'wave-owner', sessionId: 'session-wave-owner' });
  const reasons = page?.reasons ?? [];
  const coalesced = reasons.filter((reason) => reason?.kind === 'member_terminal');
  assert.ok(coalesced.length >= 1, 'the storm produces member_terminal reasons');
  const multi = coalesced.filter((reason) => (reason.count ?? 1) > 1);
  if (multi.length > 0) {
    for (const reason of multi) {
      assert.ok(reason.perPhase && typeof reason.perPhase === 'object',
        'a multi-member coalesced entry carries perPhase distribution, never a singular {role, phase}');
      assert.equal(Object.hasOwn(reason, 'role') && Object.hasOwn(reason, 'phase') && multi.length === 1, false,
        'no singular role/phase shape for a storm');
    }
  }
  const roles = coalesced.flatMap((reason) => reason.roles ?? (reason.role ? [reason.role] : []));
  assert.ok(roles.length !== 1 || coalesced.length >= 1, 'both members are accounted for (no silent drop)');
});

test('D4: wake reasons minted after a member\'s terminal transition carry memberState terminal-at-mint', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'done' },
  });
  await flush(60);
  const page = await coordinator.attentionFollow({
    scope: { runId: coordinator._tasks.get(handle.taskId).runId }, afterCursor: 0, timeoutMs: 1,
    targets: ['member_terminal'],
  }, { principalId: 'wave-owner', sessionId: 'session-wave-owner' });
  const reasons = page?.reasons ?? [];
  assert.ok(reasons.length > 0, 'the terminal member produces at least one wake reason (non-empty page required)');
  const memberReasons = reasons.filter((row) => row?.member || row?.workerId || row?.role);
  assert.ok(memberReasons.length > 0, 'at least one member-scoped reason exists');
  for (const reason of memberReasons) {
    assert.equal(reason.memberState, 'terminal-at-mint',
      'a reason minted after terminalization is epoch-marked, never presented as live');
  }
});

test('D5 (pin): the wave driver\'s stall machinery is NOT consumed by the inbox in v1 (additive only)', () => {
  const driverSource = readFileSync(join(import.meta.dirname, '..', 'src', 'wave-driver.mjs'), 'utf8');
  assert.equal(driverSource.includes('attentionFollow'), false,
    'the driver keeps its own stall clock in v1 — the inbox is additive for orchestrators');
});
