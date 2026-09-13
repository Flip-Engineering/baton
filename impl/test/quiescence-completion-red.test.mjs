// Settlement integration guards. The former #163 tests required elapsed silence,
// unknown observations and peer failures to stop live members. Those assertions were
// retired for concurrent swarm semantics. workflow-swarm-lifecycle.test.mjs exercises
// their replacements: workers survive those observations and report their own completion.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';

const REPO = 'repo-quiescence-suite';

// The suite lane driver — the fast pinned policy the two red suites share, byte-identical to
// workflow-as-data-red.test.mjs:346 (LANE_DRIVER). Restaged 2026-08-14 (operator ruling): the
// hardCapMs: 3000 suite backstop is RETIRED — clock caps never decide the fate of agentic work;
// the fast policy observes members until they report completion.
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

// F14: the D6 receipt is EXACTLY these seven keys, in ACTUAL sorted order.
const RECEIPT_KEYS = ['basis', 'harvest', 'manifestDigest', 'outcomes', 'steering', 'verdict', 'waveId'];

// ---------------------------------------------------------------------------
// Fixture (hermetic mkdtemp repos; t.after cleanup; no network / real provider / host state).
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-qs-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// A marker-dispatched MockAdapter scenario double. The card override `turnCompletion: 'pausable'` is
// applied ONLY for the park rows (R1/R2): a completed turn then parks the member instead of
// finalizing, and the first edit's delayMs lets lifecycle.turn_completed land after the wave's
// steering.registered record (deterministic park — verified 5/5 at HEAD, no provider_failure race).
// The modelSelection override is deliberately NOT touched: overriding it breaks route resolution in
// the runWorkflow path (member fails terminal:provider_failure at spawn).
class ScenarioAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, pausable = false, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this._pausable = pausable;
  }
  card() {
    return this._pausable ? { ...super.card(), turnCompletion: 'pausable' } : super.card();
  }
  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }
  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker] ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    return super.spawn(worker, brief, { ...options, scenario: JSON.parse(JSON.stringify(scenario)) });
  }
}

async function fixture(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'docs', 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  mkdirSync(join(repo, 'specs'), { recursive: true });
  const driver = createDriver({
    // Like a deployment, this fixture pins its base independently of dirty authored inputs.
    deploymentBaseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    // stallMs 60_000: far beyond any row window, so a parked turn's armed timer never fires.
    watchdog: { stallMs: 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
    progressNudgeWindowMs: 60_000_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: { default: PROFILE }, defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('q-planner'), dispatcher: principalOf('q-dispatcher'),
      observer: principalOf('q-observer'),
    },
    authorize: async () => true,
    // Decoupled-clocks double: the application clock runs 130s ahead of the coordination log's real
    // timestamps, so a parked member reads silenceMs >= 120_000 → progressClass 'silent' with no
    // wall-clock wait. A fixture double, never a completion control.
    clock: () => new Date(Date.now() + 130_000).toISOString(),
  });
  const baton = bindBaton(application, principalOf('q-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('q-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter, coordination: driver.coordination };
}

function writeObjective(repo, role, text) {
  writeFileSync(join(repo, 'objectives', `${role}.md`), `${text}\n(marker:${role})\n`);
}

function member(role) {
  return {
    role, exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], objectiveRef: `objectives/${role}.md`, report: `reports/${role}.md`,
  };
}

describe('P1 (stage[lane-driver-preserved])', () => {
  it('the fast pinned lane policy stays byte-identical and a settling wave receipts WAVE-OK + the seven-key receipt', async (t) => {
    assert.deepEqual(LANE_DRIVER, Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 }),
      'stage[lane-driver-preserved]: the suite lane driver stays byte-identical (no clock key — the #163 law, restaged 2026-08-14)');
    const adapter = new ScenarioAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'p1-a': { outcome: 'completed', summary: 'done', edits: [{ path: 'reports/p1-a.md', content: 'a\n' }] },
        'p1-b': { outcome: 'completed', summary: 'done', edits: [{ path: 'reports/p1-b.md', content: 'b\n' }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'p1-a', 'write the p1-a report');
    writeObjective(fx.repo, 'p1-b', 'write the p1-b report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-p1', members: [member('p1-a'), member('p1-b')],
      steering: {}, harvest: { paths: ['reports/p1-a.md', 'reports/p1-b.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER });
    assert.equal(receipt.verdict, 'WAVE-OK',
      'stage[lane-driver-preserved]: a settling wave receipts WAVE-OK on the fast pinned policy (A11)');
    assert.deepEqual(Object.keys(receipt).sort(), RECEIPT_KEYS,
      'stage[lane-driver-preserved]: the D6 receipt stays EXACTLY the seven sorted keys (F14)');
  });
});

describe('P2 (stage[stuck-decision-preserved])', () => {
  it('a decision-stuck roster exits via the stuck-decision early-break, never WAVE-QUIESCED (D3.3/A10)', async (t) => {
    const ask = {
      kind: 'decision', question: 'Which path?',
      options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
      allowFreeResponse: false, recommended: null, deadlineMs: 120_000, afterEditIndex: 1,
      onAnswerEdits: [{ path: 'reports/p2-a-after.md', content: 'after\n' }],
    };
    const adapter = new ScenarioAdapter({
      harness: 'mock',
      scenariosByMarker: {
        'p2-a': { outcome: 'completed', summary: 'decide', edits: [{ path: 'reports/p2-a.md', content: 'a\n' }], ask },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'p2-a', 'write the p2-a report, then decide');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-p2', members: [member('p2-a')],
      steering: { answerDecisions: { policy: { 'No such question anywhere': 'opt-a' } } },
      harvest: { paths: ['reports/p2-a.md'] },
    };
    const receipt = await fx.baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER });
    assert.equal(receipt.verdict, 'WAVE-INCOMPLETE',
      'stage[stuck-decision-preserved]: a decision-stuck roster receipts WAVE-INCOMPLETE (D3.3)');
    assert.notEqual(receipt.verdict, 'WAVE-QUIESCED',
      'stage[stuck-decision-preserved]: a decision-stuck roster is NEVER reported WAVE-QUIESCED (D1.5)');
    const deferred = (receipt.steering ?? []).find((entry) => entry?.trigger === 'answerDecisions' && entry?.deferred === true);
    assert.ok(deferred,
      'stage[stuck-decision-preserved]: the stuck-decision early-break receipts the deferred decision — the D3.3 exit, evaluated before any quiescence check');
  });
});

// ===========================================================================
// Numeric clock-cap admission remains forbidden.
// ===========================================================================

describe('N1 (stage[clock-cap-retired])', () => {
  it('a numeric hardCapMs refuses at admission naming the retirement — no clock mode exists (operator ruling 2026-08-14)', async (t) => {
    // RESTAGED to the operator ruling ("timeout/clock based control flows are not appropriate for
    // baton — an arbitrary cap/limit, just in general"): the v2 contract's null-gating question is
    // moot because no numeric clock mode survives admission. The refusal is loud, typed, and names
    // the law — a caller that still asks for a cap learns silence does not settle the work.
    const adapter = new ScenarioAdapter({
      harness: 'mock', pausable: true,
      scenariosByMarker: {
        'q-a': { outcome: 'completed', summary: 'park', edits: [{ path: 'reports/q-a.md', content: 'a\n', delayMs: 30 }] },
      },
    });
    const fx = await fixture(t, adapter);
    writeObjective(fx.repo, 'q-a', 'write the q-a report');
    const spec = {
      schemaVersion: 1, idempotencyKey: 'qs-n1', members: [member('q-a')],
      steering: {}, harvest: { paths: ['reports/q-a.md'] },
    };
    await assert.rejects(
      () => fx.baton.recipes.runWorkflow(spec, { driver: { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 } }),
      (error) => error?.code === 'workflow_spec_invalid' && /hardCapMs/.test(error?.message ?? ''),
      'stage[clock-cap-retired]: a numeric hardCapMs refuses workflow_spec_invalid naming the retired key — no clock mode exists (the #163 law, operator ruling 2026-08-14)',
    );
  });
});
