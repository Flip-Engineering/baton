// Issue #207 root — row-admission-align. Red-first suite: the interpreter must refuse AT
// ADMISSION when an objectiveRef brief exceeds the run.start objective cap, naming both byte
// counts — never the pre-change phantom: admit the wave, then every member fails at start with
// spill_body_exceeded (the run.objective admission refusal the machinery fires per member).
//
// Contract (row-admission-align, closed):
//   1. Admission-time refusal: brief > run.objective cap -> typed workflow_spec_invalid-class
//      refusal at compile/admit with measured bytes in the message.
//   2. The 64KiB OBJECTIVE_REF_MAX_BYTES stays the D5 envelope (judgment call, recorded): the
//      interpreter does NOT split, so the effective admission ceiling is the run.objective cap;
//      the 64KiB bound remains the absolute objective_ref_invalid ceiling (F8b, W1-03 parity).
//   3. This file: a 4-64KiB brief refuses at admission naming byte counts. RED at pre-change
//      head (admits, then every member spill_body_exceeded); GREEN only on the alignment.
//
// Rows:
//   A1  RED->PIN  a 16 KiB brief (over the 4096 run.objective cap, under the 64KiB D5 bound)
//                 refuses workflow_spec_invalid at admission naming the measured brief bytes AND
//                 the run.objective cap, plus the offending member's role and objectiveRef.
//                 (RED at pre-change head: runWorkflow ADMITS the spec and every member fails at
//                 start with spill_body_exceeded — the per-member phantom this row deletes.)
//   A2  PIN       a brief at EXACTLY the run.objective cap is NOT refused at admission — the
//                 boundary is strictly `brief > cap`; the machinery spills the salted objective
//                 at run.start exactly like run.objective (OQ5 spill-aware admission).
//   A3  PIN       a brief over the 64KiB D5 bound still refuses workflow_objective_ref_invalid
//                 (F8b — the D5 envelope is untouched by the alignment).
//
// Hermetic: real createDriver stack over MockAdapter, mkdtemp repos + log dirs, no network, no
// real provider, git created and removed inside t.after. The fixture is the workflow-as-data-red
// idiom (wadFixture) — the interpreter lane driven with the pinned fast driver policy.
//
// Run: `node --test impl/test/objective-admission-align-red.test.mjs` from the repo root.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const REPO = 'repo-objective-admission-align';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-oaa-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
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
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

// The run.objective admission cap — the alignment target. Read from the registry (Decision 8:
// the registry is the only source; never a re-declared literal in the suite).
const RUN_OBJECTIVE_CAP = FRAME_LIMITS['run.objective'].value;
// The interpreter's D5 absolute bound (workflow-interpreter.mjs:46) — the envelope this row
// documents, never the admission ceiling.
const OBJECTIVE_REF_MAX_BYTES = 64 * 1024;

// The suite's default mock: marker-routed scenarios + a spawn ledger (workflow-as-data-red
// idiom). A default { outcome: 'completed' } spawn settles the member without edits.
class TrackingMarkerAdapter extends MockAdapter {
  constructor({ scenariosByMarker = {}, ...config } = {}) {
    super(config);
    this._scenariosByMarker = scenariosByMarker;
    this.calls = { spawn: [] };
  }

  _markerIn(goal) {
    return Object.keys(this._scenariosByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    const scenario = this._scenariosByMarker[marker]
      ?? this._scenariosByMarker.default ?? { outcome: 'completed' };
    this.calls.spawn.push({ worker, marker, brief });
    return super.spawn(worker, brief, { ...options, scenario });
  }
}

// F11 (workflow-as-data): the lane's driver policy, pinned FAST — never the 20 s default poll.
const LANE_DRIVER = Object.freeze({ pollIntervalMs: 15, stallTimeoutMs: 400 });

async function wadFixture(t, { adapter } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  const coordAdapter = adapter ?? new TrackingMarkerAdapter({
    harness: 'mock',
    scenariosByMarker: { default: { outcome: 'completed' } },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: coordAdapter },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('oaa-planner'),
      dispatcher: principalOf('oaa-dispatcher'),
      observer: principalOf('oaa-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principalOf('oaa-owner'));
  t.after(async () => {
    try { await application.shutdown(principalOf('oaa-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter: coordAdapter, coordination: driver.coordination };
}

function validSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: 'oaa-valid',
    members: [wadMember('alpha')],
    steering: {},
    harvest: { paths: [] },
    ...overrides,
  };
}

function wadMember(role, overrides = {}) {
  return {
    role,
    exact: { ...ROUTE },
    scope: ['reports/**'],
    objectiveRef: `objectives/${role}.md`,
    report: `reports/${role}.md`,
    ...overrides,
  };
}

// The ONE invented interpreter lane (workflow-as-data-red laneOf/driveLane idiom).
function laneOf(baton, stage) {
  const lane = baton?.recipes?.runWorkflow;
  assert.equal(typeof lane, 'function',
    `stage[${stage}]: baton.recipes.runWorkflow(spec|specPath) must exist — the workflow-as-data interpreter lane (issue #114) is absent at HEAD`);
  return lane;
}

function driveLane(baton, stage, spec) {
  return laneOf(baton, stage)(spec, { driver: LANE_DRIVER, detach: false });
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

test('A1 (RED->PIN): a brief over the run.objective cap refuses workflow_spec_invalid at admission naming both byte counts', async (t) => {
  const fx = await wadFixture(t);
  const briefBytes = 16 * 1024; // 4-64KiB band: over the 4096 run cap, under the 64KiB D5 bound.
  assert.ok(briefBytes > RUN_OBJECTIVE_CAP && briefBytes < OBJECTIVE_REF_MAX_BYTES,
    'the probe brief sits in the 4-64KiB band this row owns');
  writeFileSync(join(fx.repo, 'objectives', 'alpha.md'), 'x'.repeat(briefBytes));
  const spec = validSpec({ idempotencyKey: 'oaa-a1', members: [wadMember('alpha')] });
  await assert.rejects(
    driveLane(fx.baton, 'admission-align', spec),
    (error) => {
      assert.equal(error.code, 'workflow_spec_invalid',
        'stage[admission-align-missing]: at pre-change head runWorkflow ADMITS the spec (the D5 64KiB bound passes) and every member then fails at start with spill_body_exceeded — the per-member phantom; the fix refuses the workflow_spec_invalid-class refusal AT the admission seam');
      assert.ok(String(error.message).includes(String(briefBytes)),
        'the refusal names the MEASURED brief bytes');
      assert.ok(String(error.message).includes(String(RUN_OBJECTIVE_CAP)),
        'the refusal names the run.objective admission cap');
      assert.ok(String(error.message).includes('alpha'),
        'the refusal names the offending member role');
      assert.ok(String(error.message).includes('objectives/alpha.md'),
        'the refusal names the offending objectiveRef');
      return true;
    },
  );
});

test('A2 (PIN): a brief at EXACTLY the run.objective cap is not refused at admission — the boundary is strictly over-cap, and the machinery spills the salted objective at run.start (OQ5)', async (t) => {
  const fx = await wadFixture(t);
  // Exactly at the cap: admission must PASS (the interpreter's seam is `brief > cap`), and the
  // rendered salted objective rides run.start's spill-aware admission exactly like run.objective
  // (OQ5 — over-cap bodies spill to a durable artifact, never a phantom).
  writeFileSync(join(fx.repo, 'objectives', 'alpha.md'), 'x'.repeat(RUN_OBJECTIVE_CAP));
  const spec = validSpec({ idempotencyKey: 'oaa-a2', members: [wadMember('alpha')] });
  const receipt = await driveLane(fx.baton, 'cap-boundary', spec);
  assert.equal(receipt.outcomes.length, 1, 'the at-cap member admits and settles');
  const outcome = receipt.outcomes[0];
  assert.ok(outcome.phase === 'result_ready' || outcome.terminal === true,
    `the at-cap member settles (phase ${outcome.phase})`);
});

test('A3 (PIN): a brief over the 64KiB D5 bound still refuses workflow_objective_ref_invalid — the envelope is untouched by the alignment (F8b)', async (t) => {
  const fx = await wadFixture(t);
  writeFileSync(join(fx.repo, 'objectives', 'alpha.md'), 'x'.repeat(OBJECTIVE_REF_MAX_BYTES + 1));
  const spec = validSpec({ idempotencyKey: 'oaa-a3', members: [wadMember('alpha')] });
  await assert.rejects(
    driveLane(fx.baton, 'd5-envelope', spec),
    (error) => {
      assert.equal(error.code, 'workflow_objective_ref_invalid',
        'F8b: the D5 byte bound stays pinned at its EXACT value (64KiB + 1 refuses) — the alignment adds the run-cap seam, never replaces the envelope');
      assert.ok(String(error.message).includes(String(OBJECTIVE_REF_MAX_BYTES)),
        'the D5 refusal names the 64KiB bound');
      return true;
    },
  );
});
