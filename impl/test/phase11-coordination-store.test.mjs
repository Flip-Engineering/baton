import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationIntegrityError, CoordinationRefusal, CoordinationStore } from '../src/coordination-store.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'baton-coordination-'));
const fields = (id, deps = []) => ({ id, brief: { goal: id }, deps, refines: null, taskType: 'test', reservedWorkerId: `w-${id}` });
async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

test('CK1: duplicate idempotency key returns the original event without mutation', () => {
  const store = new CoordinationStore(dir());
  const a = store.createTask(fields('a'), { actor: 'orchestrator', key: 'create-a' });
  const b = store.createTask(fields('changed'), { actor: 'orchestrator', key: 'create-a' });
  assert.equal(b.result, 'idempotent');
  assert.equal(b.event.seq, a.event.seq);
  assert.deepEqual(store.snapshot().tasks.map((task) => task.id), ['a']);
});

test('CK1: append failure is fatal and leaves event/task projections unchanged', () => {
  const store = new CoordinationStore(dir(), { appendFile: () => { throw new Error('disk full'); } });
  assert.throws(() => store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' }), /disk full/);
  assert.deepEqual(store.snapshot(), { tasks: [], artifacts: [], evidence: [], scratch: { facts: [], claims: [] }, knowledge: { nodes: [], edges: [], reads: [], contamination: [] }, lastSeq: 0 });
});

test('CK1/CK9: operational append failure poisons the coordinator and restart closes the claimed task', async () => {
  const logRoot = dir();
  const coordination = new CoordinationStore(dir());
  const failedLog = new Log(logRoot);
  failedLog.append = () => { throw new Error('disk full'); };
  const make = (log) => new Coordinator({
    log,
    fences: new FenceTable(),
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed' } }) },
    coordination,
    worktrees: { create: async () => ({ path: dir() }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'mock',
    watchdog: { stallMs: 0 },
  });
  const poisoned = make(failedLog);
  const brief = { goal: 'must be durable', constraints: [], pathScope: [], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } };
  await assert.rejects(poisoned.spawn('mock', brief, { taskId: 'append-failure' }), (error) => error.code === 'operational_log_unavailable');
  assert.equal(coordination.task('append-failure').status, 'working', 'the durable claim records the exact crash window');
  assert.throws(() => poisoned.list(), (error) => error.code === 'operational_log_unavailable');

  const replay = make(new Log(logRoot));
  assert.equal(coordination.task('append-failure').status, 'failed');
  assert.equal(replay.list()[0].status, 'exited');
});

test('CK1: startup rejects truncated tails, sequence gaps, and duplicate keys', () => {
  const truncated = dir();
  writeFileSync(join(truncated, 'events.jsonl'), '{"schemaVersion":1');
  assert.throws(() => new CoordinationStore(truncated), (error) => error instanceof CoordinationIntegrityError && error.code === 'truncated_tail');

  const gap = dir();
  writeFileSync(join(gap, 'events.jsonl'), `${JSON.stringify({ schemaVersion: 1, seq: 2, ts: 'x', kind: 'task.created', actor: 'x', idempotencyKey: 'a', payload: fields('a') })}\n`);
  assert.throws(() => new CoordinationStore(gap), (error) => error.code === 'sequence_gap');

  const duplicate = dir();
  const one = { schemaVersion: 1, seq: 1, ts: 'x', kind: 'task.created', actor: 'x', idempotencyKey: 'a', payload: fields('a') };
  const two = { ...one, seq: 2, payload: fields('b') };
  writeFileSync(join(duplicate, 'events.jsonl'), `${JSON.stringify(one)}\n${JSON.stringify(two)}\n`);
  assert.throws(() => new CoordinationStore(duplicate), (error) => error.code === 'duplicate_key');
});

test('CK2: queued DAG and ready set replay with exact deps and reserved handle', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  store.createTask(fields('base'), { actor: 'orchestrator', key: 'base' });
  store.createTask(fields('child', ['base']), { actor: 'orchestrator', key: 'child' });
  assert.deepEqual(store.readyTasks().map((task) => task.id), ['base']);
  const replay = new CoordinationStore(root);
  assert.deepEqual(replay.task('child').deps, ['base']);
  assert.equal(replay.task('child').reservedWorkerId, 'w-child');
  assert.equal(replay.task('child').assignee, null);
  assert.deepEqual(replay.readyTasks().map((task) => task.id), ['base']);
});

test('CK2: claim CAS has one winner; stale/blocked refusals append nothing', () => {
  const store = new CoordinationStore(dir());
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' });
  const winner = store.claimTask('a', 'w1', 1, { actor: 'orchestrator', key: 'claim-a' });
  assert.equal(winner.task.assignee, 'w1');
  const before = store.events().length;
  assert.throws(() => store.claimTask('a', 'w2', 1, { actor: 'orchestrator', key: 'claim-b' }), (error) => error instanceof CoordinationRefusal && error.code === 'stale_version');
  assert.equal(store.events().length, before);
});

test('CK2: terminal state is immutable across replay', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' });
  store.claimTask('a', 'w1', 1, { actor: 'orchestrator', key: 'claim' });
  store.transitionTask('a', 'completed', 2, { actor: 'policy', key: 'done' }, { verification: 7 });
  assert.throws(() => store.transitionTask('a', 'working', 3, { actor: 'x', key: 'reopen' }), (error) => error.code === 'terminal');
  assert.equal(new CoordinationStore(root).task('a').status, 'completed');
});

test('CK8/CK9: public driver exposes coordination and queued DAG survives restart before dispatch', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  const logDir = dir();
  const make = () => createDriver({
    repoRoot: repo, logDir,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 }, scenario: { outcome: 'completed' } }) },
    watchdog: { stallMs: 0 },
  });
  const brief = { goal: 'queued', constraints: [], pathScope: [], definitionOfDone: 'never dispatch', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } };
  const first = make();
  const base = await first.coordinator.spawn('mock', brief, { taskId: 'base' });
  const child = await first.coordinator.spawn('mock', brief, { taskId: 'child', deps: ['base'] });
  assert.ok(first.coordination instanceof CoordinationStore);
  assert.deepEqual(first.coordination.readyTasks().map((task) => task.id), ['base']);
  assert.equal(first.log.workers().length, 0, 'neither queued task reached a worker log');

  const replay = make();
  assert.deepEqual(replay.coordinator.list().map((worker) => worker.taskId), ['base', 'child']);
  assert.equal(replay.coordinator.list().find((worker) => worker.id === base.id)?.status, 'pending');
  assert.equal(replay.coordinator.list().find((worker) => worker.id === child.id)?.status, 'pending');
  assert.deepEqual(replay.coordination.task('child').deps, ['base']);
  assert.equal(replay.coordination.task('child').assignee, null);
  assert.deepEqual(replay.coordination.readyTasks().map((task) => task.id), ['base']);
});

test('CK2/CK9: restart terminalizes a durable claim that crashed before operational spawn', () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });

  const logDir = dir();
  const coordination = new CoordinationStore(join(logDir, 'coordination'));
  const task = fields('claimed-before-spawn');
  coordination.createTask(task, { actor: 'orchestrator', key: 'create-crash-task' });
  coordination.claimTask(task.id, task.reservedWorkerId, 1, { actor: 'orchestrator', key: 'claim-crash-task' });

  const replay = createDriver({
    repoRoot: repo,
    logDir,
    coordination,
    adapters: { mock: new MockAdapter({ card: { concurrencyCeiling: 0 } }) },
    watchdog: { stallMs: 0 },
  });

  assert.equal(replay.coordination.task(task.id).status, 'failed');
  assert.equal(replay.coordinator.list().find((worker) => worker.taskId === task.id)?.status, 'exited');
  assert.equal(replay.log.workers().length, 0, 'recovery must not invent a lifecycle.spawned event');
  assert.equal(replay.coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'recovery.claimed_without_spawn'), true);
  assert.equal(replay.coordination.events().some((event) => event.kind === 'task.transitioned' && event.payload.to === 'failed'), true);
});

test('CK1a: operational evidence gets a global coordination order and digest validation', () => {
  const events = new Map();
  const store = new CoordinationStore(dir(), { operationalRead: (worker, seq) => events.get(`${worker}:${seq}`) });
  const a = { worker: 'w-a', seq: 7, ts: '2026-01-01T00:00:00Z', kind: 'verify.reverified', payload: { accept: true } };
  const b = { worker: 'w-b', seq: 1, ts: '2026-01-01T00:00:01Z', kind: 'review.completed', payload: { accepted: true } };
  events.set('w-a:7', a); events.set('w-b:1', b);
  const ma = store.mapOperationalEvent(a, { actor: 'policy', key: 'map-a' });
  const mb = store.mapOperationalEvent(b, { actor: 'policy', key: 'map-b' });
  assert.ok(ma.evidence.coordinationSeq < mb.evidence.coordinationSeq);
  assert.throws(() => store.mapOperationalEvent({ ...a, payload: { accept: false } }, { actor: 'policy', key: 'bad' }), (error) => error.code === 'evidence_mismatch');
});

test('CK3: artifact manifests are immutable, task-linked, and accepted artifacts require provenance', () => {
  const events = new Map();
  const store = new CoordinationStore(dir(), { operationalRead: (worker, seq) => events.get(`${worker}:${seq}`) });
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'a' });
  assert.throws(() => store.registerArtifact({ taskId: 'a', kind: 'commit', refs: { sha: 'abc' }, accepted: true }, { actor: 'policy', key: 'bad-artifact' }), (error) => error.code === 'missing_provenance');
  assert.throws(() => store.registerArtifact({ taskId: 'a', kind: 'commit', refs: { sha: 'abc' }, accepted: true, provenance: [{ coordinationSeq: 1 }] }, { actor: 'policy', key: 'wrong-provenance' }), (error) => error.code === 'unverified_provenance');
  const verifyEvent = { worker: 'w-a', seq: 1, ts: '2026-01-01T00:00:00Z', kind: 'verify.reverified', actor: 'policy', payload: { accept: true } };
  events.set('w-a:1', verifyEvent);
  const mapped = store.mapOperationalEvent(verifyEvent, { actor: 'policy', key: 'map-verify-a' });
  const registered = store.registerArtifact({ taskId: 'a', kind: 'commit', refs: { sha: 'abc' }, accepted: true, provenance: [mapped.evidence] }, { actor: 'policy', key: 'artifact-a' });
  assert.equal(store.task('a').artifactIds[0], registered.artifact.id);
  assert.equal(store.artifact(registered.artifact.id).refs.sha, 'abc');
  const copy = store.artifact(registered.artifact.id); copy.refs.sha = 'mutated';
  assert.equal(store.artifact(registered.artifact.id).refs.sha, 'abc');
  const correction = store.registerArtifact({ taskId: 'a', kind: 'commit', refs: { sha: 'def' }, accepted: false, provenance: [mapped.evidence] }, { actor: 'policy', key: 'artifact-a-correction' });
  const superseded = store.supersedeArtifact(registered.artifact.id, correction.artifact.id, 1, { actor: 'policy', key: 'supersede-artifact-a' });
  assert.equal(superseded.artifact.supersededBy, correction.artifact.id);
  assert.equal(superseded.event.kind, 'artifact.superseded');
  assert.throws(() => store.supersedeArtifact(registered.artifact.id, correction.artifact.id, 1, { actor: 'policy', key: 'supersede-artifact-a-again' }), (error) => error.code === 'stale_version');
  const replay = new CoordinationStore(store.root, { operationalRead: (worker, seq) => events.get(`${worker}:${seq}`) });
  assert.deepEqual(replay.artifact(registered.artifact.id), store.artifact(registered.artifact.id));
});

test('CK8/CK9: completed public task maps verification evidence, terminal state, and manifests', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, logDir: dir(),
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'done.txt', content: 'done\n' }] } }) },
    watchdog: { stallMs: 0 },
  });
  const brief = { goal: 'complete durably', constraints: [], pathScope: ['done.txt'], definitionOfDone: 'done', verification: { command: 'test -s done.txt', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } };
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'durable-complete' });
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  assert.equal(driver.coordination.task('durable-complete').status, 'completed');
  const snapshot = driver.coordination.snapshot();
  assert.equal(snapshot.evidence.some((item) => item.kind === 'verify.reverified'), true);
  assert.deepEqual(snapshot.artifacts.map((artifact) => artifact.kind).sort(), ['commit', 'verification']);
  assert.equal(snapshot.artifacts.every((artifact) => artifact.accepted === true && artifact.provenance.length === 1), true);
  assert.equal(snapshot.tasks[0].artifactIds.length, 2);
  assert.equal(snapshot.knowledge.nodes.some((node) => node.type === 'Finding' && node.id.startsWith('outcome:durable-complete')), true);
  const recalled = driver.coordinator.recallKnowledge({ types: ['Finding'] }, { workerId: handle.id, runId: 'run-durable' }, { actor: 'orchestrator', idempotencyKey: 'recall-durable-outcome' });
  assert.equal(recalled.nodes.length, 1);
  assert.match(recalled.frame, /UNTRUSTED_RECALLED_MEMORY/);
  assert.equal(driver.coordination.traceKnowledge(recalled.nodes[0].id).edges.some((edge) => edge.type === 'ReadBy' && edge.to === 'task:durable-complete'), true);
  const replay = new CoordinationStore(driver.coordination.root, {
    operationalRead: (worker, seq) => driver.log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  assert.deepEqual(replay.snapshot(), driver.coordination.snapshot());
});

test('CK2/CK8: blocking input and resolution transition durably before terminal verification', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, logDir: dir(),
    adapters: { mock: new MockAdapter({ scenario: {
      outcome: 'completed', edits: [{ path: 'asked.txt', content: 'asked\n' }],
      ask: { kind: 'question', question: 'continue?', blocking: true, afterEditIndex: 1 },
    } }) }, watchdog: { stallMs: 0 },
  });
  const brief = { goal: 'input durably', constraints: [], pathScope: ['asked.txt'], definitionOfDone: 'asked', verification: { command: 'test -s asked.txt', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } };
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'durable-input' });
  await until(() => driver.coordinator.list()[0]?.pendingQuestionId);
  assert.equal(driver.coordination.task('durable-input').status, 'input_required');
  const requestId = driver.coordinator.list()[0].pendingQuestionId;
  await driver.coordinator.respond(requestId, { text: 'yes' }, 'human');
  assert.equal(driver.coordination.events().some((event) => event.kind === 'task.transitioned' && event.payload.to === 'working'), true);
  await until(async () => (await driver.coordinator.result(handle.id)).ready);
  assert.equal(driver.coordination.task('durable-input').status, 'completed');
});

test('CK4: Scratch claims conservatively conflict, warn cross-tree, and expire only by event', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  const envA = { repoId: 'repo', treeSha: 'aaaa1111' };
  const envB = { repoId: 'repo', treeSha: 'bbbb2222' };
  const first = store.claimScratch({ resource: 'path:payments/**', ownerWorker: 'w1', ownerTask: 't1', intent: 'edit', envRef: envA, fence: 3, leaseDeadline: 'later' }, { actor: 'w1', key: 'claim-a' });
  assert.equal(store.claimScratch({ resource: 'changed', envRef: envB }, { actor: 'w1', key: 'claim-a' }).result, 'idempotent');
  const conflict = store.claimScratch({ resource: 'path:payments/stripe.js', ownerWorker: 'w2', ownerTask: 't2', intent: 'edit', envRef: envB, fence: 4, leaseDeadline: 'later' }, { actor: 'w2', key: 'claim-b' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict.id, first.claim.id);
  const globWitness = store.claimScratch({ resource: '*stripe.js', ownerWorker: 'w3', ownerTask: 't3', intent: 'edit', envRef: envB, fence: 5, leaseDeadline: 'later' }, { actor: 'w3', key: 'claim-glob-witness' });
  assert.equal(globWitness.ok, false, 'glob/glob pair with witness path:payments/stripe.js must conservatively conflict');
  const check = store.checkScratch('path:payments/stripe.js', envB);
  assert.equal(check.clear, false);
  assert.equal(check.claims[0].warning, 'observed on aaaa1111 — not your tree');
  assert.equal(new CoordinationStore(root).checkScratch('path:payments/stripe.js', envB).clear, false, 'wall-clock replay never expires a lease');
  store.expireScratchClaim(first.claim.id, 1, { actor: 'policy', key: 'expire-a' });
  assert.equal(store.checkScratch('path:payments/stripe.js', envB).clear, true);
  assert.equal(new CoordinationStore(root).checkScratch('path:payments/stripe.js', envB).clear, true);
});

test('CK4: Scratch facts are tree-scoped, grounded, immutable, and explicitly expired', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  const fact = store.postScratchFact({ namespace: 'tests', key: 'test:flaky', value: { seed: 42 }, grounding: 'observed', envRef: { repoId: 'repo', treeSha: 'cafe1234' }, evidence: [{ coordinationSeq: 1 }] }, { actor: 'w1', key: 'fact-a' });
  const crossTree = store.checkScratch('test:flaky', { repoId: 'repo', treeSha: 'dead5678' });
  assert.equal(crossTree.facts[0].warning, 'observed on cafe1234 — not your tree');
  assert.throws(() => store.postScratchFact({ namespace: 'x', key: 'x', value: 1, grounding: 'asserted', envRef: { repoId: 'repo', treeSha: 'cafe1234' } }, { actor: 'w1', key: 'bad' }), (error) => error.code === 'invalid_grounding');
  store.expireScratchFact(fact.fact.id, { actor: 'policy', key: 'expire-fact' });
  assert.equal(store.checkScratch('test:flaky', { repoId: 'repo', treeSha: 'cafe1234' }).facts.length, 0);
});

test('CK5: causal evidence and temporal coherence are enforced', () => {
  const store = new CoordinationStore(dir());
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'task-a' });
  assert.throws(() => store.addKnowledgeNode({ type: 'Decision', id: 'D1', body: 'choose A', grounding: 'asserted' }, { actor: 'human', key: 'd1' }), (error) => error.code === 'causal_orphan');
  assert.throws(() => store.addKnowledgeNode({ type: 'Finding', id: 'Ffuture', body: 'future', grounding: 'verified', evidence: [{ coordinationSeq: 99 }] }, { actor: 'policy', key: 'future' }), (error) => error.code === 'temporal_incoherence');
  const finding = store.addKnowledgeNode({ type: 'Finding', id: 'F1', body: 'verified outcome', grounding: 'verified', evidence: [{ coordinationSeq: 1 }], validFrom: '2026-01-01T00:00:00Z' }, { actor: 'policy', key: 'f1' });
  const decision = store.addKnowledgeNode({ type: 'Decision', id: 'D1', body: 'choose A', grounding: 'asserted', informedBy: [finding.node.id], evidence: [{ coordinationSeq: finding.event.seq }], validFrom: '2026-01-02T00:00:00Z' }, { actor: 'human', key: 'd1-ok' });
  assert.equal(store.traceKnowledge('D1').edges[0].type, 'Informed');
});

test('CK5/CK7: bitemporal query, supersession, logged reads, and contamination survive replay', () => {
  const root = dir();
  const store = new CoordinationStore(root);
  store.createTask(fields('a'), { actor: 'orchestrator', key: 'task-a' });
  store.addKnowledgeNode({ type: 'Finding', id: 'old', body: 'old belief', grounding: 'observed', evidence: [{ coordinationSeq: 1 }], validFrom: '2026-01-01T00:00:00Z' }, { actor: 'policy', key: 'old' });
  store.addKnowledgeNode({ type: 'Finding', id: 'new', body: 'new belief', grounding: 'verified', evidence: [{ coordinationSeq: 1 }], validFrom: '2026-02-01T00:00:00Z' }, { actor: 'policy', key: 'new' });
  const read = store.readKnowledge({ types: ['Finding'], asOf: '2026-01-15T00:00:00Z' }, { readerActor: 'orchestrator', readerWorker: 'w1', taskId: 'a', runId: 'r1' }, { actor: 'orchestrator', key: 'read-old' });
  assert.deepEqual(read.nodes.map((node) => node.id), ['old']);
  assert.match(read.frame, /UNTRUSTED_RECALLED_MEMORY/);
  const superseded = store.addKnowledgeEdge({ type: 'Supersedes', from: 'new', to: 'old', expectedValidityVersion: 1, validFrom: '2026-02-01T00:00:00Z' }, { actor: 'policy', key: 'supersede' });
  assert.deepEqual(superseded.contamination.payload.affectedReadEvents, [read.event.seq]);
  assert.deepEqual(store.queryKnowledge({ types: ['Finding'], asOf: '2026-01-15T00:00:00Z' }).map((node) => node.id), ['old']);
  assert.deepEqual(store.queryKnowledge({ types: ['Finding'], asOf: '2026-02-15T00:00:00Z' }).map((node) => node.id), ['new']);
  const invalidated = store.invalidateKnowledge('new', 1, 'refuted later', { actor: 'human', key: 'invalidate-new' });
  assert.equal(invalidated.contamination.payload.affectedReadEvents.length, 0);
  assert.equal(store.affectedReaders('old').length, 1);
  const replay = new CoordinationStore(root);
  assert.deepEqual(replay.snapshot(), store.snapshot());
  assert.equal(replay.affectedReaders('old')[0].taskId, 'a');
  assert.equal(replay.affectedReaders('old')[0].taskStatus, 'pending');
  assert.equal(replay.traceKnowledge('old').edges.some((edge) => edge.type === 'ReadBy' && edge.to === 'task:a'), true);
  const audit = replay.auditKnowledge();
  assert.equal(audit.temporalCoherence.invalidEvidence, 0);
  assert.equal(audit.recallUtility.reads, 1);
  assert.equal(audit.contamination.affectedReads, 1);
});

test('CK7: a failed read append returns no recalled content', () => {
  const store = new CoordinationStore(dir(), { appendFile: () => { throw new Error('read log unavailable'); } });
  assert.throws(() => store.readKnowledge({}, { readerActor: 'x' }, { actor: 'x', key: 'read' }), /read log unavailable/);
});

test('CK2/CK8: confirmed kill durably cancels an active public task', async () => {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, logDir: dir(), stopDeadlineMs: 1000,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'slow.txt', content: 'x', delayMs: 5000 }] } }) },
    watchdog: { stallMs: 0 },
  });
  const brief = { goal: 'cancel durably', constraints: [], pathScope: ['slow.txt'], definitionOfDone: 'cancel', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } };
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'durable-cancel' });
  await until(() => driver.coordinator.list()[0]?.status === 'working');
  const lease = driver.coordination.claimScratch({
    resource: 'path:slow.txt', ownerWorker: handle.id, ownerTask: 'durable-cancel', intent: 'edit',
    envRef: { repoId: 'repo', treeSha: 'deadbeef' }, fence: 1, leaseDeadline: 'terminal',
  }, { actor: handle.id, key: 'claim-slow-file' });
  const stopped = await driver.coordinator.kill(handle.id, 'human');
  assert.equal(stopped.result, 'confirmed');
  assert.equal(driver.coordination.task('durable-cancel').status, 'cancelled');
  assert.equal(driver.coordination.snapshot().evidence.some((item) => item.kind === 'kill.confirmed'), true);
  assert.equal(driver.coordination.activeScratchClaims({ workerId: handle.id }).length, 0);
  assert.equal(driver.coordination.snapshot().scratch.claims.find((claim) => claim.id === lease.claim.id).active, false);
});
