// Wave-attention-watch (#208 item 1) — RED-first pin suite.
//
// Contract (closed, from the row brief): `waves.attention.watch` is the ONE new application verb.
// A watcher subscribes by waveId; the lane emits the AGGREGATE — wave X has N parked members,
// oldest parked at event-seq S, per-member attention kinds — on member input_required entry,
// decision.requested uncovered by policy, member terminal (failed/stopped with cause), and wave
// settle. NO polling semantics at the consumer: watch delivers (callback/envelope). Store-side:
// the lane rides the event fold, no per-subscription rescan.
//
// RED at pre-change head: `waves.attention.watch` is not a verb → `application_command_unavailable`.
// The pin below is GREEN-side: a registered watcher receives the aggregate when a member parks at
// input_required, WITHOUT any consumer poll call. The no-poll contract is pinned by asserting the
// only plausible poll verb (`waves.attention.poll`) refuses with application_command_unavailable —
// the watch callback is the sole delivery surface.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';

const repoId = 'repo-wave-attention-watch';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-watch-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

// The wave identity (createWave path, wave.mjs:207): the idempotencyKey digest alone. The driver
// passes the SAME key to waves.start, so a watcher registered before the drive knows the waveId.
function waveIdFor(idempotencyKey) {
  return `wave:${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

// A real single-member wave over a decision-asking MockAdapter. The member completes its first turn
// and parks at input_required with an `answer_decision` attention item (adapter ask).
function realWaveKit(t, ask, label = 'w') {
  const repo = root('wave-repo');
  const logDir = root('wave-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 5, summary: 'decision turn',
      edits: [{ path: `reports/${label}.md`, content: 'work\n' }],
      ask,
    },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'wave-attention-watch-red', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo };
}

const waveMember = (role) => ({
  role, objective: `do the work (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'], report: `reports/${role}.md`,
});

const decisionAsk = (overrides = {}) => ({
  kind: 'decision', question: 'Which path?',
  options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
  allowFreeResponse: false, recommended: null, deadlineMs: 120_000, afterEditIndex: 0,
  ...overrides,
});

const DRIVER_POLICY = Object.freeze({
  preflight: false, steering: 'nudge-on-checkpoint',
  pollIntervalMs: 30, stallTimeoutMs: 800, settleTimeoutMs: 1_500,
  finalization: 'none', unproductiveNudgeBudget: 1, saltObjectives: false,
});

// ---------------------------------------------------------------------------
// WAW-1 (the pin): a member entering input_required delivers the aggregate to a
// REGISTERED WATCHER — the lane emits, the consumer never polls. Registered by
// waveId (pre-computed from the fixed idempotencyKey) BEFORE the drive starts.
// ---------------------------------------------------------------------------
test('WAW-1 (red-first pin): input_required delivers the aggregate to a registered watcher — no consumer poll', async (t) => {
  const ik = 'watch-red-1';
  const waveId = waveIdFor(ik);
  const kit = realWaveKit(t, decisionAsk());

  const deliveries = [];
  const watch = await kit.application.command(
    'waves.attention.watch',
    { waveId, onAggregate: (aggregate) => deliveries.push(aggregate) },
    principal('wave-owner'),
  );

  // The watch response is the pull-on-open + subscription ticket: the caller learns the waveId is
  // bound, receives the OPEN aggregate (empty before any member parks), and the subscription id.
  assert.equal(watch.schemaVersion, 1);
  assert.equal(watch.waveId, waveId);
  assert.match(watch.subscriptionId, /^watch:wave:[a-f0-9]{32}:[a-f0-9]{8}$/u);
  assert.equal(watch.aggregate.parkedCount, 0, 'open aggregate is empty before the drive parks anyone');

  // Drive with NO onDecision — the decision is uncovered by policy, so the member parks at
  // input_required and the lane's attention fold emits the aggregate (trigger 'change').
  const receipt = await createWaveDriver(kit.baton, {
    ...DRIVER_POLICY, stallTimeoutMs: 800,
  }).run({ repoRoot: kit.repo, members: [waveMember('w')], idempotencyKey: ik });

  assert.equal(receipt.basis, 'stall', 'an uncovered decision parks the member and the wave stalls');
  assert.ok(deliveries.length > 0, 'the watcher received at least one aggregate WITHOUT polling');

  const parked = deliveries.find((aggregate) => aggregate.parkedCount >= 1);
  assert.ok(parked, 'an aggregate with a parked member arrived (the lane emitted on input_required)');
  assert.equal(parked.waveId, waveId);
  assert.equal(parked.parkedCount, 1);
  assert.equal(parked.members.length, 1);
  assert.equal(parked.members[0].role, 'w');
  assert.equal(parked.members[0].attention, 'decision', 'the parked attention kind is the decision class');
  assert.equal(parked.members[0].terminal, false);
  assert.ok(parked.members[0].phase !== null && parked.members[0].phase !== undefined,
    'the aggregate carries the member phase');
  assert.ok(Number.isSafeInteger(parked.oldestParkedAtEventSeq) || parked.oldestParkedAtEventSeq === null,
    'oldest parked cursor is present or explicitly null');
});

// ---------------------------------------------------------------------------
// WAW-2 (no-polling contract): the only delivery surface is the watch callback.
// A plausible `waves.attention.poll` verb does not exist — application_command_unavailable.
// ---------------------------------------------------------------------------
test('WAW-2 (no-poll semantics): there is no waves.attention.poll verb — the watch callback is the delivery surface', async (t) => {
  const kit = realWaveKit(t, decisionAsk());
  await assert.rejects(
    () => kit.application.command('waves.attention.poll', { waveId: waveIdFor('watch-red-2') }, principal('wave-owner')),
    (error) => error?.code === 'application_command_unavailable',
    'a poll verb would violate the closed contract (watch delivers, consumers never poll)',
  );
});

// ---------------------------------------------------------------------------
// WAW-3 (authority + shape): the verb draws Decision 5's scope seam — a wave-owner and any
// authenticated principal may subscribe; a malformed request refuses the closed-shape code.
// ---------------------------------------------------------------------------
test('WAW-3 (authority mirrors Decision 5): an authenticated non-owner principal subscribes; malformed request refuses typed', async (t) => {
  const ik = 'watch-red-3';
  const waveId = waveIdFor(ik);
  const kit = realWaveKit(t, decisionAsk());

  // Any authenticated principal is admitted for a deployment scope (null runId → review authority).
  const watch = await kit.application.command(
    'waves.attention.watch',
    { waveId, onAggregate: () => {} },
    principal('observer'),
  );
  assert.equal(watch.waveId, waveId);

  // Closed request shape: only {waveId, onAggregate}; anything else refuses typed.
  await assert.rejects(
    () => kit.application.command(
      'waves.attention.watch',
      { waveId, onAggregate: () => {}, cursor: 0 },
      principal('wave-owner'),
    ),
    (error) => error?.code === 'application_wave_attention_watch_invalid',
    'the closed watch request refuses unknown fields',
  );
  await assert.rejects(
    () => kit.application.command(
      'waves.attention.watch',
      { waveId: 'wave:not-hex', onAggregate: () => {} },
      principal('wave-owner'),
    ),
    (error) => error?.code === 'application_wave_attention_watch_invalid',
    'the waveId digest shape is validated',
  );
});
