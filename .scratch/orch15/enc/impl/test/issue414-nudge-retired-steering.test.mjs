// Issue #414 — a wave member retired by the unproductivity budget goes quiet with no
// steering line: name the exhausted budget and the next action.
//
// Red-before suite: after K consecutive delivery failures on the same requestId the driver
// stops nudging that member and lets the stall clock judge — but pushes NO steering/evidence
// entry. These rows pin (a) the ONE retirement steering row naming role, requestId, budget,
// count and next; (b) the same retirement on the settle outcome's per-member row; (c) a
// member whose delivery succeeds records no retirement row.
//
// Fixture mirrors wave-driver-policy-red.test.mjs: the PausableWaveAdapter scripts nudge
// delivery failures (failNudge throws in prompt mode 'turn'; the coordinator catches it as
// delivery_exception and rolls the pause back onto the SAME requestId, so consecutive
// failures accumulate in the driver's failuresByRequestId).

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
  constructor({ scriptsByMarker, ...config } = {}) {
    super(config);
    this._scriptsByMarker = scriptsByMarker ?? {};
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

function harness(t, scriptsByMarker) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new PausableWaveAdapter({ harness: 'mock', scriptsByMarker });
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

// Every nudge delivery fails on the SAME rolled-back pause, so the driver's consecutive
// delivery-failure budget exhausts and it retires the member from nudging.
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

async function driveRetired(t) {
  const { baton, repo } = harness(t, alwaysFailing('worker'));
  const controller = new AbortController();
  const backstop = setTimeout(() => controller.abort(), 30_000);
  try {
    return await createWaveDriver(baton, { ...FAST, signal: controller.signal }).run({
      repoRoot: repo, members: [member('worker', 'write the worker report')],
    });
  } finally {
    clearTimeout(backstop);
  }
}

test('414a: after K failed deliveries the steering evidence carries exactly one retirement row naming role, requestId, budget, count and next', async (t) => {
  const receipt = await driveRetired(t);
  assert.equal(receipt.basis, 'stall', 'nobody steers the retired member, so the stall clock judges');
  const failed = receipt.nudges.filter((entry) => entry.role === 'worker' && entry.error);
  assert.ok(failed.length > 0, 'the scripted delivery failures are recorded');
  const requestId = failed[0].requestId;
  assert.ok(failed.every((entry) => entry.requestId === requestId), 'every failure is on the same rolled-back pause');
  const retired = receipt.nudges.filter((entry) => entry.outcome === 'nudge_retired');
  assert.equal(retired.length, 1, `expected exactly one retirement row, got ${JSON.stringify(receipt.nudges)}`);
  const row = retired[0];
  assert.equal(row.role, 'worker');
  assert.equal(row.requestId, requestId);
  assert.equal(typeof row.runId, 'string');
  assert.ok(row.runId.length > 0, 'the retirement names the run it stopped steering');
  assert.equal(typeof row.budget, 'string');
  assert.ok(row.budget.length > 0, 'the retirement names the exhausted budget');
  assert.equal(row.count, failed.length, 'the count that exhausted the budget is the observed failure count — derived, never re-typed');
  assert.equal(row.message, failed.at(-1).error.message, 'the retirement names the last delivery failure message');
  assert.equal(typeof row.next, 'string');
  assert.ok(row.next.includes('worker'), `the next action names the stall clock now judging this member: ${row.next}`);
});

test('414b: the settle outcome for the retired member carries the same retirement', async (t) => {
  const receipt = await driveRetired(t);
  const retired = receipt.nudges.filter((entry) => entry.outcome === 'nudge_retired');
  assert.equal(retired.length, 1);
  const outcome = receipt.outcomes.find((entry) => entry.role === 'worker');
  assert.ok(outcome, 'the retired member settles with a per-member outcome row');
  assert.deepEqual(outcome.retired, { budget: retired[0].budget, count: retired[0].count },
    'the settle outcome names the same exhausted budget and count as the steering row');
});

test('414c: a member whose delivery succeeds records no retirement row', async (t) => {
  const scriptsByMarker = { default: [{ edits: [edit('worker', 1)] }] }; // tail repeats: frozen path set
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, stallTimeoutMs: 60_000, unproductiveNudgeBudget: 1, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.ok(receipt.nudges.some((entry) => !entry.error), 'a delivery succeeds in this row');
  assert.equal(receipt.nudges.filter((entry) => entry.outcome === 'nudge_retired').length, 0,
    'no retirement row when delivery succeeds');
  const outcome = receipt.outcomes.find((entry) => entry.role === 'worker');
  assert.equal(outcome?.retired ?? null, null, 'no retirement on the settle outcome when delivery succeeds');
});
