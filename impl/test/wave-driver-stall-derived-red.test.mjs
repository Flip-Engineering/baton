// stall-break (#163 follow-on): the wave-level stall window DERIVES from the wave's own observed
// marker-advance cadence — max(2x maxObservedGapMs, 8x pollIntervalMs), the same derivation the
// quiescence quiet window uses (workflow-interpreter.mjs:992, landed 8ec52a6c). A policy that
// pins stallTimeoutMs explicitly keeps the pinned value (back-compat — every existing suite pins
// it); the derived value replaces ONLY the fixed production DEFAULT (the old 20 * 60_000).
//
// The red contract: a wave whose marker advances on a cadence SLOWER than 20 min (observed gaps
// of 25 min scaled into test time via poll overrides) must NOT break at the old fixed default.
// The fixed 20-min default can never fire inside a test (it is 20 REAL minutes), so at pre-change
// head the driver HANGS on a never-settling wave — the pin bounds that hang with a race and fails
// fast (RED). After the change, the derived window judges the wave from its own cadence and the
// driver terminates (GREEN).
//
// Terminal semantics byte-stable: the same bases (stall), the same receipts (no new fields, no
// new event kinds), the same L6 unproductivity budget — only the window source changed.
//
// Clocks: short real setTimeout delays (the wave-driver-policy-red convention — no fake now() for
// this class of end-to-end fixture; fixture-clock-lint clean, no hardcoded future dates).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';

const repoId = 'repo-wave-driver-stall-derived';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-stall-der-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// The PausableWaveAdapter (wave-driver-policy-red.test.mjs:28-160): a card declaring
// `turnCompletion: 'pausable'`, scripted turns per member marker, one fresh re-park per nudge,
// turnEpoch bumped in lockstep with the coordinator fence. Each scripted turn parks a NEW
// turn_checkpoint (fresh requestId) → the cursor-stripped wave marker ADVANCES; a turn whose
// edits hit a NEW report path also grows the changedPathsDigest set (productive). After the last
// scripted turn the adapter repeats it (path set frozen → unproductive re-park → the L6 budget
// stops nudging → the view freezes → the stall window judges the wave).
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
        provenance: 'wave-driver-stall-derived-red', refreshedAt: null,
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
    const script = this._scriptForMarker(marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    this._failRemaining = this._failRemaining ?? new Map();
    const turn0 = script[0] ?? { edits: [] };
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
      // emit wire turnEpoch 0 for turn 0; the coordinator's wireEpochOffset normalizes it.
      turnEpoch: 0,
    });
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
      const session = this._sessions.get(worker);
      if (session) {
        // Drive the next scripted turn (a fresh re-park). The nudge arrives only on a parked
        // (completed) turn, so resetting the session state and re-running is always safe.
        session.terminal = false;
        session.runStarted = false;
        session.stopKind = null;
        session.crashed = false;
        session.timeoutHit = false;
        session.deniedApproval = false;
        session.askHandled = false;
        session.scenario = this._scenarioForTurn(script, count);
        session.opts = { ...session.opts, turnEpoch: count }; // +1 per nudge: lockstep with the fence
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
    // Neutralize the worker watchdog: a stallMs far longer than any test window, so a parked
    // turn's freshly armed timer never fires and writes nothing that flaps the stall marker.
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
  return { application, baton, driver, repo, adapter };
}

const member = (role, objective, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

// One edit at a report path (a NEW path per productive turn grows the changedPathsDigest set);
// delayMs paces the turn so the DRIVER observes the marker-advance cadence it must judge by.
const pacedEdit = (role, turn, delayMs) => ({
  path: `reports/${role}-${turn}.md`, content: `${role} turn ${turn}\n`, delayMs,
});

// The derived-default policy under test: NO stallTimeoutMs anywhere — the driver's derived path
// (a pinned stallTimeoutMs would be back-compat and never exercise the derivation).
// pollIntervalMs: 50 → the derived floor is 8x50 = 400 ms; turn delays of 200 ms make the
// observed marker-advance gaps ~250 ms, so 2x maxObservedGapMs (~500 ms) exceeds the floor and
// the cadence term is the window that fires. "25 min scaled into test time": the production
// cadence is 20 s polls / 25-min gaps (75 polls); the poll override scales that to 50 ms polls /
// ~250 ms gaps — the SAME 75-poll gap, with the old fixed 20-min default unscalable in a test.
const DERIVED_POLICY = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 50,
  settleTimeoutMs: 2_000,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: false,
  preflight: false,
});

// RED leg: the pre-change fixed 20-min default cannot fire inside a test (20 REAL minutes), so a
// never-settling wave HANGS the pre-change driver forever. Bound the hang with a race; on timeout,
// abort the signal so the loop breaks (basis 'aborted'), settles and closes cleanly, then fail.
// GREEN leg: the derived window terminates the wave and the race never fires.
async function driveUntilStall(t, policy, scriptsByMarker, budgetMs = 30_000) {
  const { baton, repo } = harness(t, scriptsByMarker);
  const controller = new AbortController();
  const runPromise = createWaveDriver(baton, {
    ...policy,
    signal: controller.signal,
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(
      'the wave was not terminated by any stall window — the driver hung (the fixed 20-min default cannot fire inside a test; RED at pre-change head)',
    ), { code: 'derived_stall_window_timeout' })), budgetMs);
  });
  let receipt;
  try {
    receipt = await Promise.race([runPromise, deadline]);
  } catch (error) {
    controller.abort();
    await runPromise.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return receipt;
}

// The brief's pin: a wave whose marker advances on a cadence SLOWER than 20 min (observed gaps of
// 25 min scaled into test time via poll overrides) must NOT break at the old fixed default. The
// wave stays alive through five paced productive turns (the marker advances with every fresh
// checkpoint), then the unproductive tail freezes the view and the DERIVED window — 2x the wave's
// own observed gap — judges it. Basis 'stall' via the derived default; pre-change the driver can
// never reach its 20-min fixed default and hangs (RED at pre-change head).
test('stall-break: a slow-cadence wave is judged by 2x its own observed marker gap, never the fixed 20-min default', async (t) => {
  const scriptsByMarker = {
    worker: [
      { edits: [pacedEdit('worker', 1, 200)] },
      { edits: [pacedEdit('worker', 2, 200)] },
      { edits: [pacedEdit('worker', 3, 200)] },
      { edits: [pacedEdit('worker', 4, 200)] },
      { edits: [pacedEdit('worker', 5, 200)] },
      // tail repeats turn 5: path set frozen → unproductive re-parks → L6 done → view freezes.
    ],
  };
  const receipt = await driveUntilStall(t, DERIVED_POLICY, scriptsByMarker);
  assert.equal(receipt.basis, 'stall',
    'the derived default stall window (max(2x maxObservedGapMs, 8x pollIntervalMs)) terminates the wave — the old fixed 20-min default can never fire inside a test');
  assert.ok(receipt.nudges.length >= 4,
    `the wave was alive and marker-advancing (observed cadence fed the derivation) before the window judged it — got ${receipt.nudges.length} nudges`);
  assert.equal(receipt.claims.length, 0, 'finalization none: the stall basis carries no claim fan-out (byte-stable terminal semantics)');
  assert.ok(Array.isArray(receipt.outcomes), 'outcomes survive the derived-window stall');
  assert.equal(receipt.remainingCount, 0, 'the guaranteed close drains the wave on a derived stall');
  assert.equal(receipt.pumpDrained, true);
});

// The floor term: a wave silent from the first marker (the view freezes immediately) has no
// observed cadence — maxObservedGapMs stays 0 — so the 8x pollIntervalMs floor judges it. The
// same RED/GREEN split: pre-change the fixed 20-min default hangs the driver (RED); after, the
// floor terminates the wave inside a test (GREEN).
test('stall-break: a wave silent from the first marker is judged by 8x pollIntervalMs, never a fixed 20-min default', async (t) => {
  const scriptsByMarker = {
    worker: [{ edits: [{ path: 'reports/worker-1.md', content: 'worker turn 1\n' }] }],
  };
  const receipt = await driveUntilStall(t, {
    ...DERIVED_POLICY, steering: 'none',
  }, scriptsByMarker);
  assert.equal(receipt.basis, 'stall',
    'the 8x pollIntervalMs floor (no observed cadence) terminates a silent wave — the old fixed 20-min default can never fire inside a test');
  assert.equal(receipt.nudges.length, 0, "steering 'none': no nudges — the floor, not the nudge machinery, judges it");
  assert.equal(receipt.claims.length, 0);
  assert.ok(Array.isArray(receipt.outcomes), 'outcomes survive the floor stall');
});
