import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CairnRunScorecard, CoordinationStore, MockAdapter, createBrief, createDriver } from '../src/index.mjs';

import { reapFixtureDirectories } from '../scripts/suite-hygiene.mjs';

reapFixtureDirectories();

const root = (name) => mkdtempSync(join(tmpdir(), `baton-cairn-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(10); }
  throw new Error(`timeout waiting for ${label}`);
}
function repo() {
  const path = root('repo'); execFileSync('git', ['init', '-q'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: path });
  return path;
}
function brief(target = 'done.txt') {
  return createBrief({
    goal: `write ${target}`, constraints: [], pathScope: [target], definitionOfDone: `the free-form file ${target} exists`,
    verification: { command: `test -s ${target}`, expectExit: 0, timeoutMs: 5000 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  });
}
function driver({ delayed = false } = {}) {
  const repoRoot = repo(); const logDir = root('log'); const artifactRoot = root('artifacts');
  const adapter = new MockAdapter({
    card: { harness: 'mock-cairn', version: '1' },
    scenario: { outcome: 'completed', edits: [{ path: 'done.txt', content: 'done\n', ...(delayed ? { delayMs: 500 } : {}) }] },
  });
  const instance = createDriver({
    repoRoot, logDir, adapters: { mock: adapter },
    capabilityFactories: {
      cairn: ({ coordination, readOperational }) => new CairnRunScorecard({ coordination, readOperational, artifactRoot }),
    },
    maxCapabilityBudgetTokens: 10_000, maxCapabilityEnvelopeBytes: 128 * 1024,
  });
  return { ...instance, adapter, repoRoot, logDir, artifactRoot };
}

test('CR1/CR3/CR4/CR5: exact run identity builds one verified scorecard artifact through createDriver ACI', async () => {
  const d = driver();
  const handle = await d.coordinator.spawn('mock', brief(), { taskId: 'run-task', taskType: 'implementation', runId: 'run-a' });
  await until(async () => (await d.coordinator.result(handle.id)).ready, 'verified task');
  const publicHandle = d.coordinator.list().find((worker) => worker.id === handle.id);
  assert.equal(publicHandle.runId, 'run-a');
  assert.equal(d.coordination.task('run-task').runId, 'run-a');
  assert.equal(d.log.read(handle.id).every((event) => event.taskId === 'run-task' && event.runId === 'run-a'), true);
  const spoof = d.log.append({ worker: handle.id, taskId: 'forged-task', runId: 'forged-run', harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'content.message', payload: { text: 'untrusted attribution' } });
  assert.equal(spoof.taskId, 'run-task'); assert.equal(spoof.runId, 'run-a');

  const ctx = { budgetTokens: 4_000, actor: 'orchestrator' };
  const result = await d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-a' }, ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.payload.length, 1);
  const row = result.payload[0];
  assert.equal(row.runId, 'run-a'); assert.equal(row.tasks.total, 1);
  assert.deepEqual(row.completions, { verified: 1, asserted: 0 });
  assert.equal(row.definitionOfDoneCoverage.status, 'unavailable');
  assert.match(result.refs[0].digest, /^[a-f0-9]{64}$/u);
  assert.equal(existsSync(join(d.artifactRoot, `${result.refs[0].digest}.json`)), true, 'the scorecard artifact is content-addressed on disk');

  const reverified = await d.coordinator.reverifyCapability('cairn', 'run.scorecard', result, { runId: 'run-a' }, ctx);
  assert.equal(reverified.status, 'ok'); assert.equal(reverified.payload[0].ok, true);
  await d.coordinator.kill(handle.id, 'policy');
});

test('CR2/CR7: unknown and nonterminal runs refuse, and a tampered artifact diverges', async () => {
  const d = driver({ delayed: true }); const ctx = { budgetTokens: 4_000, actor: 'orchestrator' };
  await assert.rejects(d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'missing' }, ctx), (error) => error.code === 'run_not_found');
  const handle = await d.coordinator.spawn('mock', brief(), { taskId: 'slow-task', runId: 'run-slow' });
  await assert.rejects(d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-slow' }, ctx), (error) => error.code === 'run_not_terminal');
  await until(async () => (await d.coordinator.result(handle.id)).ready, 'slow terminal task');
  const result = await d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-slow' }, ctx);
  // Epic #81 (O-5): the coordinator boundary strips ref.path (worker-visible refs carry
  // {kind, handle, digest, bytes, mediaType} only) — the internal tamper derives the artifact
  // path from the fixture root + digest (cairn layout: <artifactRoot>/<digest>.json).
  writeFileSync(join(d.artifactRoot, `${result.refs[0].digest}.json`), 'tampered\n');
  const reverified = await d.coordinator.reverifyCapability('cairn', 'run.scorecard', result, { runId: 'run-slow' }, ctx);
  assert.equal(reverified.status, 'diverged'); assert.equal(reverified.payload[0].ok, false);
  await d.coordinator.kill(handle.id, 'policy');
});

test('CR2/CR5/CR7: the run knowledge projection replays byte-identically', async () => {
  const d = driver(); const handle = await d.coordinator.spawn('mock', brief(), { taskId: 'replay-task', runId: 'run-replay' });
  await until(async () => (await d.coordinator.result(handle.id)).ready, 'replay task');
  const result = await d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-replay' }, { budgetTokens: 4_000 });
  const replay = new CoordinationStore(join(d.logDir, 'coordination'), { operationalRead: (worker, seq) => d.log.read(worker, seq).find((event) => event.seq === seq) ?? null });
  assert.deepEqual(replay.snapshot().knowledge, d.coordination.snapshot().knowledge);
  await d.coordinator.kill(handle.id, 'policy');
});

test('CR3/CR4: concurrent task rows deterministically ground usage, interventions and approvals', async () => {
  const d = driver();
  const first = await d.coordinator.spawn('mock', brief(), { taskId: 'score-a', runId: 'run-metrics' });
  const second = await d.coordinator.spawn('mock', brief(), { taskId: 'score-b', runId: 'run-metrics' });
  await until(async () => (await d.coordinator.result(first.id)).ready && (await d.coordinator.result(second.id)).ready, 'concurrent run');
  d.log.append({ worker: first.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { tokens: 11, usd: 0.25 } });
  d.log.append({ worker: second.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { tokens: 7, usd: 0.1 } });
  d.adapter._userCb({ worker: first.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { source: 'provider-cumulative', accounting: 'cumulative', totalTokens: 5, totalCostUsd: 0.1 } });
  d.adapter._userCb({ worker: first.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { source: 'provider-cumulative', accounting: 'cumulative', totalTokens: 8, totalCostUsd: 0.15 } });
  d.log.append({ worker: first.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'human:operator-a', kind: 'control.nudge', payload: { message: 'check it' } });
  d.log.append({ worker: first.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'approval.requested', payload: { requestId: 'approval-open' } });
  d.log.append({ worker: second.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'worker', kind: 'approval.requested', payload: { requestId: 'approval-closed' } });
  d.log.append({ worker: second.id, harness: 'mock-cairn@1', turnEpoch: 2, actor: 'human:operator-a', kind: 'approval.resolved', payload: { requestId: 'approval-closed' } });

  const ctx = { budgetTokens: 8_000, actor: 'orchestrator' };
  const firstSeal = await d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-metrics' }, ctx);
  const retry = await d.coordinator.invokeCapability('cairn', 'run.scorecard', { runId: 'run-metrics' }, ctx);
  assert.deepEqual(retry.payload, firstSeal.payload);
  const row = firstSeal.payload[0];
  assert.equal(row.tasks.total, 2); assert.deepEqual(row.tasks.byOutcome, { completed: 2 });
  assert.deepEqual(row.completions, { verified: 2, asserted: 0 });
  assert.deepEqual(row.usage, { tokens: 26, usd: 0.5 });
  assert.deepEqual(row.interventions, { total: 1, byKind: { 'control.nudge': 1 }, byActor: { 'human:operator-a': 1 } });
  assert.deepEqual(row.approvals, { requested: 2, resolved: 1, unresolved: ['approval-open'] });
  assert.deepEqual(row.workers.map((worker) => worker.taskId), ['score-a', 'score-b']);
  await d.coordinator.kill(first.id, 'policy'); await d.coordinator.kill(second.id, 'policy');
  const later = await d.coordinator.reverifyCapability('cairn', 'run.scorecard', firstSeal, { runId: 'run-metrics' }, ctx);
  assert.equal(later.status, 'ok'); assert.equal(later.payload[0].ok, true);
});

test('CR1/CR2/CR7: an invalid run identity refuses without effects', async () => {
  const d = driver();
  const before = d.coordination.snapshot().lastSeq;
  await assert.rejects(d.coordinator.spawn('mock', brief(), { taskId: 'invalid-run', runId: '../escape' }), (error) => error.code === 'invalid_run_id');
  assert.equal(d.coordination.snapshot().lastSeq, before);
  const handle = await d.coordinator.spawn('mock', brief(), { taskId: 'sealed-task', runId: 'run-conflict' });
  await until(async () => (await d.coordinator.result(handle.id)).ready, 'conflict task');
  await d.coordinator.kill(handle.id, 'policy');
});

test('CR1/CR2: review tasks inherit run identity', async () => {
  const d = driver(); const baseCard = d.adapter.card.bind(d.adapter);
  d.adapter.card = () => ({ ...baseCard(), sessions: { multiTurn: 'native', resume: 'native', fork: 'planned', rewind: 'planned' } });
  const parent = await d.coordinator.spawn('mock', brief(), { taskId: 'review-parent', runId: 'run-review' });
  await until(async () => (await d.coordinator.result(parent.id)).ready, 'review parent');
  const child = await d.coordinator.spawnReview(parent.id, 'mock', { taskId: 'review-child', verification: { command: 'test -s done.txt', expectExit: 0, timeoutMs: 5000 } });
  assert.equal(child.runId, 'run-review'); assert.equal(d.coordination.task('review-child').runId, 'run-review');
  await until(async () => (await d.coordinator.result(child.id)).ready, 'review child');
  await d.coordinator.kill(parent.id, 'policy'); await d.coordinator.kill(child.id, 'policy');
});

test('CR3/CR7: unmapped completion is asserted, and missing/mixed operational evidence refuses', async () => {
  const events = [{ seq: 1, worker: 'w-asserted', taskId: 'asserted-task', runId: 'run-asserted', kind: 'lifecycle.turn_completed', actor: 'worker', payload: { status: 'completed' } }];
  const store = new CoordinationStore(root('asserted-store'));
  const created = store.createTask({ id: 'asserted-task', runId: 'run-asserted', deps: [], reservedWorkerId: 'w-asserted' }, { actor: 'test', key: 'asserted-create' });
  const claimed = store.claimTask('asserted-task', 'w-asserted', created.task.version, { actor: 'test', key: 'asserted-claim' });
  store.transitionTask('asserted-task', 'completed', claimed.task.version, { actor: 'test', key: 'asserted-terminal' });
  const cairn = new CairnRunScorecard({ coordination: store, readOperational: () => events, artifactRoot: root('asserted-artifact') });
  const result = await cairn.invoke('run.scorecard', { runId: 'run-asserted' }, { actor: 'test' });
  assert.deepEqual(result.payload[0].completions, { verified: 0, asserted: 1 });

  const missingStore = new CoordinationStore(root('missing-store'));
  const missingCreated = missingStore.createTask({ id: 'missing-task', runId: 'run-missing', deps: [], reservedWorkerId: 'w-missing' }, { actor: 'test', key: 'missing-create' });
  const missingClaimed = missingStore.claimTask('missing-task', 'w-missing', missingCreated.task.version, { actor: 'test', key: 'missing-claim' });
  missingStore.transitionTask('missing-task', 'completed', missingClaimed.task.version, { actor: 'test', key: 'missing-terminal' });
  const unavailable = new CairnRunScorecard({ coordination: missingStore, readOperational: () => null, artifactRoot: root('missing-artifact') });
  await assert.rejects(unavailable.invoke('run.scorecard', { runId: 'run-missing' }, { actor: 'test' }), (error) => error.code === 'run_evidence_unavailable');
  const mixed = new CairnRunScorecard({ coordination: missingStore, readOperational: () => [{ seq: 1, worker: 'w-missing', taskId: 'missing-task', runId: 'other-run', kind: 'resource.tokens', actor: 'worker', payload: { tokens: 50 } }], artifactRoot: root('mixed-artifact') });
  await assert.rejects(mixed.invoke('run.scorecard', { runId: 'run-missing' }, { actor: 'test' }), (error) => error.code === 'run_attribution_mismatch');
  const gapped = new CairnRunScorecard({ coordination: missingStore, readOperational: () => [{ seq: 2, worker: 'w-missing', taskId: 'missing-task', runId: 'run-missing', kind: 'resource.tokens', actor: 'worker', payload: { tokens: 50 } }], artifactRoot: root('gapped-artifact') });
  await assert.rejects(gapped.invoke('run.scorecard', { runId: 'run-missing' }, { actor: 'test' }), (error) => error.code === 'run_evidence_gap');
});
