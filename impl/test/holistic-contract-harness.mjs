import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BatonControlError,
  DeploymentContinuity,
  EventJournal,
  IsolationAuthority,
  LaneScheduler,
  MemberSupervisor,
  NotificationBus,
  ProjectionStore,
  ReadinessResolver,
  UnifiedCommandRegistry,
  UnifiedControlPlane,
  canonicalTransportNames,
  crashSafeWriteJson,
  createUnifiedNotificationCommands,
  preregisterEvaluation,
  reapEligibleArtifacts,
  replayProjection,
} from '../src/holistic-runtime.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export const contractTests = {
  async 'CP-001'() {
    const scheduler = new LaneScheduler({ concurrency: 2 });
    let release;
    const blocked = scheduler.enqueue('background_reconcile', () => new Promise((resolve) => { release = resolve; }));
    const urgent = await scheduler.enqueue('interactive_control', async () => 'status-ok');
    assert.equal(urgent, 'status-ok');
    release('done');
    await blocked;
  },
  async 'CP-002'() {
    const scheduler = new LaneScheduler({ concurrency: 2 });
    let release;
    const bulk = scheduler.enqueue('bulk_evidence', () => new Promise((resolve) => { release = resolve; }));
    const stop = await scheduler.enqueue('emergency_control', async () => 'stopped');
    assert.equal(stop, 'stopped');
    release(); await bulk;
  },
  async 'CP-003'() {
    const journal = new EventJournal();
    const bus = new NotificationBus(journal);
    const sub = bus.subscribe({ principalId: 'p1', runId: 'r1' });
    const id = bus.publishAttention({ runId: 'r1', kind: 'answer_question' });
    const page = bus.poll(sub.subscriptionId);
    assert.equal(page.events.some((event) => event.data.id === id), true);
    const restored = bus.subscription(sub.subscriptionId);
    assert.equal(restored.cursor, 0);
  },
  async 'CP-004'() {
    const journal = new EventJournal();
    assert.equal(journal.assertExternalAwaitAllowed(), true);
    journal.append('x', {});
    assert.equal(journal.events().length, 1);
  },
  async 'REG-001'() {
    const registry = createUnifiedNotificationCommands(new UnifiedCommandRegistry());
    for (const surface of ['cli', 'mcp', 'web', 'embedded']) {
      const inventory = registry.inventory(surface);
      assert.equal(inventory.length, registry.rows({ surface }).length);
      for (const row of inventory) assert.equal(registry.resolve(row.name).key, row.key);
    }
  },
  async 'REG-002'() {
    const registry = new UnifiedCommandRegistry();
    registry.register({ key: 'run.stop', aliases: ['baton_run_stop_legacy'], mode: 'effect', capabilities: ['emergency_stop'] });
    const canonical = registry.resolve('run.stop');
    const alias = registry.resolve('baton_run_stop_legacy');
    assert.equal(alias, canonical);
    assert.deepEqual(alias.capabilities, canonical.capabilities);
  },
  async 'ERR-001'() {
    const error = new BatonControlError('bad_request', 'bad input', { detail: { why: 'x' }, field: 'runId', retryable: false, action: 'fix_run_id' });
    const envelope = error.envelope();
    for (const surface of ['web', 'mcp', 'cli', 'embedded']) {
      const serialized = JSON.parse(JSON.stringify({ surface, ...envelope }));
      assert.equal(serialized.error.code, 'bad_request');
      assert.equal(serialized.error.field, 'runId');
      assert.deepEqual(serialized.error.detail, { why: 'x' });
    }
  },
  async 'LIF-001'() {
    const journal = new EventJournal();
    const supervisor = new MemberSupervisor(journal, { retryBudget: 2 });
    supervisor.addMember({ memberId: 'm1', objective: 'x', role: 'worker' });
    supervisor.startAttempt('m1', { baseSha: 'a', worktreeId: 'wt1', route: 'r', fence: 1 });
    const cert = supervisor.classifyDeath('m1', { kind: 'provider_unavailable', retriable: true });
    assert.equal(cert.classification, 'provider_unavailable');
    const recovery = supervisor.recover('m1');
    assert.equal(recovery.action, 'retried');
    assert.equal(recovery.attempt.worktreeId, 'wt1');
  },
  async 'LIF-002'() {
    const supervisor = new MemberSupervisor(new EventJournal(), { retryBudget: 2 });
    supervisor.addMember({ memberId: 'm1', objective: 'x', role: 'worker' });
    supervisor.startAttempt('m1', { baseSha: 'a', worktreeId: 'wt1', route: 'r', fence: 1 });
    supervisor.classifyDeath('m1', { kind: 'transport_uncertain', retriable: true, reattachEligible: true });
    const recovery = supervisor.recover('m1', { exactSessionAlive: true });
    assert.equal(recovery.action, 'reattached');
    assert.equal(supervisor.member('m1').attempts.length, 1);
  },
  async 'LIF-003'() {
    const supervisor = new MemberSupervisor(new EventJournal(), { retryBudget: 0 });
    supervisor.addMember({ memberId: 'm1', objective: 'x', role: 'worker' });
    supervisor.startAttempt('m1', { baseSha: 'a', worktreeId: 'wt1', route: 'r', fence: 1 });
    supervisor.classifyDeath('m1', { kind: 'provider_unavailable', retriable: true });
    assert.equal(supervisor.recover('m1').action, 'attention_required');
  },
  async 'LIF-004'() {
    const supervisor = new MemberSupervisor(new EventJournal());
    supervisor.addMember({ memberId: 'm1', objective: 'x', role: 'worker' });
    supervisor.startAttempt('m1', { baseSha: 'a', worktreeId: 'wt1', route: 'r', fence: 1 });
    const before = supervisor.member('m1');
    await tick(); await tick();
    assert.equal(supervisor.member('m1').currentAttempt.state, before.currentAttempt.state);
  },
  async 'ATT-001'() {
    const journal = new EventJournal(); const bus = new NotificationBus(journal);
    const sub = bus.subscribe({ principalId: 'p1', runId: 'r1' });
    const id = bus.publishAttention({ runId: 'r1', kind: 'answer_question' });
    const page = bus.poll(sub.subscriptionId);
    assert.equal(page.events.some((event) => event.data.id === id), true);
  },
  async 'ATT-002'() {
    const journal = new EventJournal(); const bus = new NotificationBus(journal);
    const sub = bus.subscribe({ principalId: 'p1', runId: 'r1' });
    bus.publishAttention({ runId: 'r1', kind: 'answer_question' });
    const saved = bus.subscription(sub.subscriptionId);
    const restarted = new NotificationBus(new EventJournal().restore(journal.snapshot()));
    restarted.restoreSubscription(saved);
    assert.equal(restarted.poll(sub.subscriptionId).events.length > 0, true);
  },
  async 'MSG-001'() {
    const journal = new EventJournal(); const bus = new NotificationBus(journal);
    const id = bus.sendMessage({ runId: 'r1', recipient: 'worker', body: 'hello' });
    assert.equal(bus.census().unresolvedMessages.length, 1);
    bus.messageFate(id, 'delivered'); await tick();
    assert.equal(bus.census().unresolvedMessages.length, 0);
  },
  async 'STORE-001'() {
    const events = [
      { seq: 1, type: 'inc', data: { value: 2 } },
      { seq: 2, type: 'inc', data: { value: 3 } },
      { seq: 3, type: 'inc', data: { value: 4 } },
    ];
    const projectors = [{ name: 'count', initial: 0, reducer: (state, event) => event.type === 'inc' ? state + event.data.value : state }];
    const full = replayProjection({ events, projectors });
    const first = replayProjection({ events: events.slice(0, 2), projectors });
    const snapshot = first.snapshot(2);
    const suffix = replayProjection({ events, projectors, snapshot });
    assert.equal(full.digest(), suffix.digest());
  },
  async 'STORE-002'() {
    const root = mkdtempSync(join(tmpdir(), 'baton-compact-'));
    try {
      const path = join(root, 'snapshot.json');
      writeFileSync(path, JSON.stringify({ generation: 1 }));
      assert.throws(() => crashSafeWriteJson(path, { generation: 2 }, { failAt: 'after_write' }), /injected crash/u);
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { generation: 1 });
      crashSafeWriteJson(path, { generation: 2 });
      assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { generation: 2 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  },
  async 'STORE-003'() {
    const result = reapEligibleArtifacts([
      { pin: 'live', bytes: 10 }, { pin: 'dead', bytes: 20 }, { pin: 'dead2', bytes: 20 },
    ], { terminalPins: new Set(['dead', 'dead2']), maxBytes: 25 });
    assert.equal(result.retained.some((item) => item.pin === 'live'), true);
    assert.equal(result.reaped.every((item) => item.pin !== 'live'), true);
  },
  async 'READY-001'() {
    const resolver = new ReadinessResolver((route) => {
      if (route !== 'good') throw new BatonControlError('route_unavailable', 'unavailable');
      return { route, predicates: { credential: true, provider: true } };
    });
    assert.equal(resolver.evaluate('good').ready, true);
    assert.equal(resolver.assertEquivalent('good'), true);
    assert.equal(resolver.evaluate('bad').ready, false);
  },
  async 'READY-002'() {
    const resolver = new ReadinessResolver((route, { dryRun }) => ({ route, predicates: { processLive: true, busResponsive: true, dryRun } }));
    const view = resolver.evaluate('good');
    assert.equal(view.ready, true);
    assert.equal(view.predicates.processLive, true);
    assert.equal(view.predicates.busResponsive, true);
  },
  async 'ISO-002'() {
    const authority = new IsolationAuthority({ repoRoot: '/repo', worktreeRoot: '/sandbox/worktrees' });
    assert.throws(() => authority.authorizeWrite({ worktree: '/repo', path: 'README.md', scope: ['README.md'] }), (error) => error.code === 'scope_violation');
    assert.equal(authority.authorizeWrite({ worktree: '/sandbox/worktrees/w1', path: 'src/a.mjs', scope: ['src'] }).allowed, true);
  },
  async 'ISO-004'() {
    const authority = new IsolationAuthority({ repoRoot: '/repo', worktreeRoot: '/sandbox/worktrees' });
    assert.equal(authority.authorizeRun({ runIds: ['run:a'] }, 'run:a'), true);
    assert.throws(() => authority.authorizeRun({ runIds: ['run:a'] }, 'run:b'), (error) => error.code === 'forbidden');
  },
  async 'DEP-001'() {
    const journal = new EventJournal();
    const projections = new ProjectionStore().register('count', 0, (state, event) => state + (event.type === 'x' ? 1 : 0));
    const bus = new NotificationBus(journal); const sub = bus.subscribe({ principalId: 'p1', runId: 'r1' });
    const event = journal.append('x', {}); projections.apply(event);
    const continuity = new DeploymentContinuity({ journal, projections, notifications: bus });
    const checkpoint = continuity.checkpoint({ active: [{ runId: 'r1', memberId: 'm1', attempt: 1, fence: 2, commandId: 'c1' }], subscriptions: [sub.subscriptionId] });
    const restored = continuity.restore(checkpoint, { journal, projections: new ProjectionStore().register('count', 0, (state) => state), notifications: new NotificationBus(journal) });
    assert.equal(restored.active[0].fence, 2);
    assert.equal(restored.subscriptions[0].subscriptionId, sub.subscriptionId);
  },
  async 'MOD-001'() {
    const names = canonicalTransportNames('run.attention.watch');
    assert.equal(names.mcp, 'baton_run_attention_watch');
    assert.equal(names.cli, 'baton run attention watch');
    assert.equal(names.web, 'run_attention_watch');
  },
  async 'REL-001'() {
    const registry = createUnifiedNotificationCommands(new UnifiedCommandRegistry());
    assert.equal(registry.inventory('cli').length, registry.inventory('mcp').length);
    assert.equal(registry.digest().length, 64);
  },
  async 'E2E-001'() {
    const registry = createUnifiedNotificationCommands(new UnifiedCommandRegistry());
    registry.register({ key: 'run.start', mode: 'effect', lane: 'lifecycle_effects', capabilities: ['control'] });
    const journal = new EventJournal(); const scheduler = new LaneScheduler();
    const plane = new UnifiedControlPlane({ registry, journal, scheduler });
    plane.handle('run.start', async ({ runId }) => ({ runId, phase: 'working' }));
    const receipt = plane.admit('run.start', { runId: 'r1' }, { principalId: 'p1' });
    await scheduler.drain();
    assert.equal(plane.status(receipt.commandId).state, 'succeeded');
    const bus = new NotificationBus(journal); const sub = bus.subscribe({ principalId: 'p1', runId: 'r1' });
    const attention = bus.publishAttention({ runId: 'r1', kind: 'answer_decision' });
    assert.equal(bus.poll(sub.subscriptionId).events.some((event) => event.data.id === attention), true);
    const supervisor = new MemberSupervisor(journal); supervisor.addMember({ memberId: 'm1', objective: 'x', role: 'worker' });
    supervisor.startAttempt('m1', { baseSha: 'a', worktreeId: 'wt1', route: 'r', fence: 1 });
    supervisor.classifyDeath('m1', { kind: 'provider_unavailable', retriable: true });
    assert.equal(supervisor.recover('m1').action, 'retried');
  },
  async 'EVAL-001'() {
    const result = preregisterEvaluation([
      { mode: 'solo', verifiedSuccess: true, operatorInterventions: 1, wallMs: 100, tokens: 10, costUsd: 0.1, retries: 0, strandedAttention: 0, integrationDefects: 0, cleanupFailures: 0 },
      { mode: 'baton', verifiedSuccess: true, operatorInterventions: 0, wallMs: 80, tokens: 12, costUsd: 0.12, retries: 0, strandedAttention: 0, integrationDefects: 0, cleanupFailures: 0 },
    ]);
    assert.equal(result.metrics.includes('verifiedSuccess'), true);
    assert.equal(result.digest.length, 64);
  },
};
