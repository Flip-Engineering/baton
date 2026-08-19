import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProductionConvergenceRuntime,
  createProductionCommandRegistry,
  wrapProductionClient,
  wrapProductionDeployment,
} from '../src/production-convergence.mjs';
import { BatonControlError, UnifiedCommandRegistry, canonicalTransportNames } from '../src/holistic-runtime.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function runtime(options = {}) {
  return new ProductionConvergenceRuntime({
    repoRoot: '/repo', worktreeRoot: '/sandbox/worktrees', concurrency: 8, ...options,
  });
}

test('production convergence lands the complete holistic contract matrix atomically', async () => {
  const rt = runtime();

  let releaseReconcile;
  let releaseBulk;
  const reconcile = rt.scheduler.enqueue('background_reconcile', () => new Promise((resolve) => { releaseReconcile = resolve; }));
  const bulk = rt.scheduler.enqueue('bulk_evidence', () => new Promise((resolve) => { releaseBulk = resolve; }));
  assert.equal(await rt.scheduler.enqueue('interactive_control', async () => 'status-ok'), 'status-ok');
  assert.equal(await rt.scheduler.enqueue('emergency_control', async () => 'stop-ok'), 'stop-ok');
  assert.equal(rt.journal.assertExternalAwaitAllowed(), true);
  releaseReconcile(); releaseBulk(); await Promise.all([reconcile, bulk]);

  const sub = rt.subscribe({ principalId: 'operator', runId: 'run:1' });
  const attentionId = rt.createAttention({ runId: 'run:1', kind: 'answer_question', detail: { prompt: 'x' } });
  const attentionPage = rt.poll(sub.subscriptionId);
  assert.equal(attentionPage.events.some((event) => event.data.id === attentionId), true);
  assert.equal(rt.poll(sub.subscriptionId).cursor, 0);
  rt.acknowledgeCursor(sub.subscriptionId, attentionPage.nextCursor);
  const cp = rt.checkpoint({ active: [{ runId: 'run:1', memberId: 'member:1', attempt: 1, fence: 4 }], subscriptions: [sub.subscriptionId] });
  assert.equal(cp.subscriptions[0].cursor, attentionPage.nextCursor);

  const registry = createProductionCommandRegistry();
  for (const surface of ['cli', 'mcp', 'web', 'embedded']) {
    for (const row of registry.inventory(surface)) assert.equal(registry.resolve(row.name).key, row.key);
  }
  assert.equal(canonicalTransportNames('run.attention.watch').mcp, 'baton_run_attention_watch');
  const collision = new UnifiedCommandRegistry();
  collision.register({ key: 'run.one', aliases: ['legacy'] });
  assert.throws(() => collision.register({ key: 'run.two', aliases: ['legacy'] }), (error) => error.code === 'command_alias_collision');

  await assert.rejects(rt.invoke('run.start', { objective: 'x' }, async () => {
    throw new BatonControlError('route_unavailable', 'route unavailable', {
      detail: { provider: 'x' }, field: 'route', retryable: true, action: 'inspect_readiness',
    });
  }, { commandId: 'cmd:error', principalId: 'operator' }), /route unavailable/u);
  const failed = rt.receipt('cmd:error');
  assert.equal(failed.state, 'failed');
  assert.deepEqual(failed.error, {
    code: 'route_unavailable', message: 'route unavailable', detail: { provider: 'x' },
    field: 'route', retryable: true, action: 'inspect_readiness',
  });

  rt.addMember({ memberId: 'member:1', objective: 'build', role: 'worker', scope: ['src'] });
  rt.startAttempt('member:1', { baseSha: 'base', worktreeId: 'wt:1', route: 'kimi', providerSession: 'session:1', fence: 1 });
  rt.classifyDeath('member:1', { kind: 'transport_uncertain', retriable: true, reattachEligible: true });
  assert.equal(rt.recoverMember('member:1', { exactSessionAlive: true, runId: 'run:1' }).action, 'reattached');
  const liveBefore = rt.members.member('member:1').currentAttempt;
  await tick(); await tick();
  assert.equal(rt.members.member('member:1').currentAttempt.state, liveBefore.state);

  const retryRt = runtime({ retryBudget: 1 });
  retryRt.addMember({ memberId: 'member:2', objective: 'build', role: 'worker' });
  retryRt.startAttempt('member:2', { baseSha: 'base', worktreeId: 'wt:2', route: 'kimi', fence: 1 });
  retryRt.classifyDeath('member:2', { kind: 'provider_unavailable', retriable: true });
  const retried = retryRt.recoverMember('member:2', { runId: 'run:2' });
  assert.equal(retried.action, 'retried');
  assert.equal(retried.attempt.worktreeId, 'wt:2');
  retryRt.classifyDeath('member:2', { kind: 'provider_unavailable', retriable: true });
  const exhausted = retryRt.recoverMember('member:2', { runId: 'run:2' });
  assert.equal(exhausted.action, 'attention_required');
  await tick();
  assert.equal(retryRt.collaborationCensus().openAttention.length, 1);

  const messageId = rt.sendMessage({ runId: 'run:1', recipient: 'member:1', body: 'hello' });
  await tick();
  assert.equal(rt.collaborationCensus().unresolvedMessages.some((item) => item.id === messageId), true);
  rt.classifyMessage(messageId, 'delivered');
  await tick();
  assert.equal(rt.collaborationCensus().unresolvedMessages.some((item) => item.id === messageId), false);

  await tick();
  const projectionBeforeRestore = rt.projections.digest();
  const restored = rt.restore(cp);
  assert.equal(restored.active[0].fence, 4);
  assert.equal(restored.subscriptions[0].cursor, cp.subscriptions[0].cursor);
  assert.equal(rt.projections.digest(), projectionBeforeRestore);

  const root = mkdtempSync(join(tmpdir(), 'baton-production-convergence-'));
  try {
    const path = join(root, 'checkpoint.json');
    writeFileSync(path, JSON.stringify({ generation: 1 }));
    assert.throws(() => rt.compact(path, { generation: 2 }, { failAt: 'after_write' }), /injected crash/u);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { generation: 1 });
    rt.compact(path, { generation: 2 });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { generation: 2 });
  } finally { rmSync(root, { recursive: true, force: true }); }
  const retained = rt.reap([
    { pin: 'live', bytes: 20 }, { pin: 'cmd:error', bytes: 20 },
  ], { terminalPins: new Set(['cmd:error']), maxBytes: 20 });
  assert.equal(retained.retained.some((item) => item.pin === 'live'), true);
  assert.equal(retained.reaped.every((item) => item.pin !== 'live'), true);

  const readyRt = runtime({ resolveRoute: (route, { dryRun }) => {
    if (route !== 'good') throw new BatonControlError('route_unavailable', 'bad route');
    return { route, predicates: { processLive: true, busResponsive: true, credential: true, dryRun } };
  } });
  assert.equal(readyRt.readiness('good').ready, true);
  assert.equal(readyRt.readiness('good').predicates.processLive, true);
  assert.equal(readyRt.assertDispatchEquivalent('good'), true);
  assert.equal(readyRt.readiness('bad').ready, false);

  assert.throws(() => rt.authorizeWrite({ worktree: '/repo', path: 'README.md', scope: ['README.md'] }), (error) => error.code === 'scope_violation');
  assert.equal(rt.authorizeWrite({ worktree: '/sandbox/worktrees/w1', path: 'src/a.mjs', scope: ['src'] }).allowed, true);
  assert.equal(rt.authorizeRun({ runIds: ['run:1'] }, 'run:1'), true);
  assert.throws(() => rt.authorizeRun({ runIds: ['run:1'] }, 'run:2'), (error) => error.code === 'forbidden');

  const fakeDeployment = {
    async run(objective) { return { runId: 'run:e2e', objective }; },
    async startMany(requests) { return requests.map((request, index) => ({ runId: `run:${index}`, ...request })); },
    async workflow(objective) { return { objective, kind: 'workflow' }; },
    async explore(objective) { return { objective, kind: 'explore' }; },
    async review(objective) { return { objective, kind: 'review' }; },
    async close() { return { state: 'closed' }; },
    doctorReadiness() { return { routes: [{ harness: 'kimi', model: 'k3', effort: 'high', state: 'ready', runtime: { authentication: { state: 'ready' } } }] }; },
  };
  const governed = wrapProductionDeployment(fakeDeployment, { repoRoot: '/repo', worktreeRoot: '/sandbox/worktrees' });
  assert.deepEqual(await governed.run('ship everything'), { runId: 'run:e2e', objective: 'ship everything' });
  assert.equal(governed.convergence.audit().journalDigest.length, 64);
  assert.deepEqual(await governed.close(), { state: 'closed' });

  const rawClient = { async run(value) { return `ok:${value}`; }, async inspect() { return 'read'; } };
  const client = wrapProductionClient(rawClient, { runtime: runtime() });
  assert.equal(await client.run('x'), 'ok:x');
  assert.equal(await client.inspect(), 'read');

  const evaluation = rt.evaluation([
    { mode: 'solo', verifiedSuccess: true, operatorInterventions: 2, wallMs: 100, tokens: 10, costUsd: 0.1, retries: 1, strandedAttention: 0, integrationDefects: 0, cleanupFailures: 0 },
    { mode: 'parallel', verifiedSuccess: true, operatorInterventions: 1, wallMs: 80, tokens: 14, costUsd: 0.14, retries: 0, strandedAttention: 1, integrationDefects: 0, cleanupFailures: 0 },
    { mode: 'baton', verifiedSuccess: true, operatorInterventions: 0, wallMs: 70, tokens: 12, costUsd: 0.12, retries: 0, strandedAttention: 0, integrationDefects: 0, cleanupFailures: 0 },
  ]);
  assert.deepEqual(evaluation.metrics, [
    'verifiedSuccess', 'operatorInterventions', 'wallMs', 'tokens', 'costUsd', 'retries',
    'strandedAttention', 'integrationDefects', 'cleanupFailures',
  ]);
});
