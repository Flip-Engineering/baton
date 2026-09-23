// Issue #572 supersedes #414's nudge-retirement rule. A delivery counter does not decide that
// live work is done. The wave orchestrator retries the same pause until delivery succeeds or its
// caller explicitly aborts the drive.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';

const repoId = 'repo-wave-driver-414';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-414-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// Scripted pausable turns; each turn is `{ edits, failNudge? }`. Mirrors
// wave-driver-policy-red.test.mjs:56-141 (turnEpoch +1 per nudge keeps the fence lockstep;
// a NEW report path per productive turn grows the changedPathsDigest set).
class PausableWaveAdapter extends MockAdapter {
  constructor({ scriptsByMarker, onNudgeAttempt = null, ...config } = {}) {
    super(config);
    this._scriptsByMarker = scriptsByMarker ?? {};
    this._onNudgeAttempt = onNudgeAttempt;
  }

  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'wave-driver-414', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker).find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  _scriptForMarker(marker) {
    return this._scriptsByMarker[marker] ?? this._scriptsByMarker.default ?? [{ edits: [] }];
  }

  async spawn(worker, brief, options = {}) {
    const goal = brief?.goal ?? '';
    const marker = this._markerIn(goal);
    this._markerByWorker = this._markerByWorker ?? new Map();
    this._markerByWorker.set(worker, marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    return super.spawn(worker, brief, { ...options, scenario: this._scenarioForTurn(this._scriptForMarker(marker), 0), turnEpoch: 0 });
  }

  _scenarioForTurn(script, index) {
    const turn = script[index] ?? script.at(-1) ?? { edits: [] };
    return {
      outcome: 'completed',
      summary: `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
    };
  }

  async prompt(worker, message, mode) {
    if (mode === 'turn') {
      const script = this._scriptForMarker(this._markerByWorker?.get(worker) ?? 'default');
      const count = (this._turnCount?.get(worker) ?? 0) + 1;
      this._turnCount.set(worker, count);
      const turn = script[count] ?? script.at(-1) ?? { edits: [] };
      this._onNudgeAttempt?.({ count, worker, failNudge: turn.failNudge === true });
      if (turn.failNudge) {
        throw Object.assign(new Error('pausable adapter: scripted nudge failure'), { code: 'pausable_nudge_failed' });
      }
      const session = this._sessions.get(worker);
      if (session) {
        session.terminal = false;
        session.runStarted = false;
        session.stopKind = null;
        session.crashed = false;
        session.timeoutHit = false;
        session.deniedApproval = false;
        session.askHandled = false;
        session.scenario = this._scenarioForTurn(script, count);
        session.opts = { ...session.opts, turnEpoch: count };
        this._startSession(session);
      }
    }
    return super.prompt(worker, message, mode);
  }
}

function harness(t, scriptsByMarker, { onNudgeAttempt = null } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new PausableWaveAdapter({ harness: 'mock', scriptsByMarker, onNudgeAttempt });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
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
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
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
    defaults: { profile: 'default', route: null },
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
  return { baton, repo };
}

const member = (role, objective, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

const edit = (role, turn, content = `${role} turn ${turn}\n`) => ({
  path: `reports/${role}-${turn}.md`, content,
});

const FAST = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 15,
  stallTimeoutMs: 1_500,
  settleTimeoutMs: 1_500,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: true,
  preflight: false,
});

const alwaysFailing = (role) => ({
  default: [
    { edits: [edit(role, 1)] },
    { edits: [edit(role, 1)], failNudge: true },
    { edits: [edit(role, 1)], failNudge: true },
    { edits: [edit(role, 1)], failNudge: true },
    { edits: [edit(role, 1)], failNudge: true },
    { edits: [edit(role, 1)], failNudge: true },
  ],
});

async function driveUntilAttempts(t, scriptsByMarker, attempts) {
  const controller = new AbortController();
  const { baton, repo } = harness(t, scriptsByMarker, {
    onNudgeAttempt: ({ count }) => {
      if (count >= attempts) controller.abort();
    },
  });
  const backstop = setTimeout(() => controller.abort(), 30_000);
  try {
    return await createWaveDriver(baton, { ...FAST, signal: controller.signal }).run({
      repoRoot: repo, members: [member('worker', 'write the worker report')],
    });
  } finally {
    clearTimeout(backstop);
  }
}

test('572a: delivery failures do not retire a live member', async (t) => {
  const receipt = await driveUntilAttempts(t, alwaysFailing('worker'), 5);
  assert.equal(receipt.basis, 'aborted', 'the caller is the authority that stops the drive');
  const failed = receipt.nudges.filter((entry) => entry.role === 'worker' && entry.error);
  assert.ok(failed.reduce((sum, entry) => sum + entry.attempts, 0) >= 5,
    `expected at least five retries, got ${JSON.stringify(receipt.nudges)}`);
  const requestId = failed[0].requestId;
  assert.ok(failed.every((entry) => entry.requestId === requestId), 'every failure is on the same rolled-back pause');
  assert.equal(receipt.nudges.some((entry) => entry.outcome === 'nudge_retired'), false);
  assert.equal(receipt.claims.length, 0, 'delivery failures do not manufacture completion claims');
});

test('572b: a delivery can recover after the former three-failure boundary', async (t) => {
  const script = {
    default: [
      { edits: [edit('worker', 1)] },
      { edits: [edit('worker', 1)], failNudge: true },
      { edits: [edit('worker', 1)], failNudge: true },
      { edits: [edit('worker', 1)], failNudge: true },
      { edits: [edit('worker', 1)], failNudge: true },
      { edits: [edit('worker', 2)] },
    ],
  };
  const receipt = await driveUntilAttempts(t, script, 5);
  assert.equal(receipt.basis, 'aborted');
  const failed = receipt.nudges.filter((entry) => entry.error);
  const succeeded = receipt.nudges.filter((entry) => !entry.error);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].attempts, 4);
  assert.ok(succeeded.some((entry) => entry.requestId === failed[0].requestId),
    'the same pause is delivered after four failures');
  assert.equal(receipt.nudges.some((entry) => entry.outcome === 'nudge_retired'), false);
});

test('572c: an unchanged digest does not end or claim a member', async (t) => {
  const script = { default: [{ edits: [edit('worker', 1)] }] };
  const receipt = await driveUntilAttempts(t, script, 4);
  const succeeded = receipt.nudges.filter((entry) => !entry.error);
  assert.equal(receipt.basis, 'aborted');
  assert.ok(succeeded.length >= 4, `unchanged turns continue past the old budget: ${JSON.stringify(receipt.nudges)}`);
  assert.equal(new Set(succeeded.map((entry) => entry.requestId)).size, succeeded.length,
    'each completed turn is a new orchestrator decision point');
  assert.equal(receipt.claims.length, 0, 'a repeated digest is observation, not assignment completion');
});

test('572d: an implicit checkpoint policy refuses before a wave starts', () => {
  let starts = 0;
  const baton = { waves: { start: async () => { starts += 1; } } };
  assert.throws(
    () => createWaveDriver(baton),
    (error) => error?.code === 'wave_driver_turn_policy_required',
  );
  assert.throws(
    () => createWaveDriver(baton, { steering: 'none' }),
    (error) => error?.code === 'wave_driver_turn_policy_required',
    'steering none requires an active checkpoint decision callback',
  );
  assert.equal(starts, 0);
});

test('572e: onCheckpoint continues one turn and explicitly declares the next turn done', async (t) => {
  const { baton, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  let calls = 0;
  const receipt = await createWaveDriver(baton, {
    ...FAST,
    onCheckpoint: () => {
      calls += 1;
      return calls === 1 ? 'continue' : 'done';
    },
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.equal(receipt.nudges.length, 1);
  assert.equal(receipt.claims.length, 1);
  assert.deepEqual(receipt.checkpointDecisions.map((entry) => entry.outcome), ['continue', 'done']);
});

test('572f: callback errors and invalid returns retry without a failure-count fate', async (t) => {
  const { baton, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  let calls = 0;
  const receipt = await createWaveDriver(baton, {
    ...FAST,
    onCheckpoint: () => {
      calls += 1;
      if (calls <= 4) throw Object.assign(new Error('temporary parent failure'), { code: 'parent_unavailable' });
      if (calls <= 8) return 'later';
      return 'stop';
    },
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.equal(calls, 9);
  assert.equal(receipt.checkpointDecisions.filter((entry) => entry.error)
    .reduce((sum, entry) => sum + entry.attempts, 0), 8);
  assert.equal(receipt.checkpointDecisions.at(-1).outcome, 'stop');
  assert.equal(receipt.nudges.length, 0);
  assert.equal(receipt.claims.length, 0);
});

test('572g: a stop decision is scoped to its member while a sibling completes', async (t) => {
  const scripts = {
    alpha: [{ edits: [edit('alpha', 1)] }],
    beta: [{ edits: [edit('beta', 1)] }],
  };
  const { baton, repo } = harness(t, scripts);
  const receipt = await createWaveDriver(baton, {
    ...FAST,
    onCheckpoint: ({ role }) => (role === 'alpha' ? 'stop' : 'done'),
  }).run({
    repoRoot: repo,
    members: [member('alpha', 'write alpha'), member('beta', 'write beta')],
  });
  assert.equal(receipt.basis, 'completed');
  const alpha = receipt.checkpointDecisions.filter((entry) => entry.role === 'alpha');
  const beta = receipt.checkpointDecisions.filter((entry) => entry.role === 'beta');
  assert.equal(alpha.length, 1);
  assert.equal(alpha[0].outcome, 'stop');
  assert.equal(beta.length, 1);
  assert.equal(beta[0].outcome, 'done');
  assert.equal(receipt.claims.filter((entry) => entry.role === 'beta').length, 1,
    'the sibling reaches its own explicit done decision');
  assert.equal(receipt.claims.filter((entry) => entry.role === 'alpha').length, 0);
});
