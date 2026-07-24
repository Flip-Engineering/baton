// Issue #46 — the shipped wave driver (docs/37 v2). Red-first policy suite: every row pins one
// productized-driver failure mode that a bespoke driver got wrong or skipped.
//
// Binding contract: docs/37-wave-driver.md v2 (laws L1-L7, surface §2, red rows §3).
//
// Harness mirrors wave-driver-red.test.mjs:54-124 with the checkpoint conjunction pinned (§3):
// BOTH a `turnCompletion:'pausable'` card override (exactly as turn-checkpoints-31b5-surface-red
// :105-113) AND the `steering.registered` record (wave membership via `driverKind:'wave'`, created
// automatically by run.start — 31-a D1). The worker watchdog is neutralized (a long `stallMs`
// passed to createDriver, the 31b5 :177-180 pattern) so timer writes never flap the stall marker.
//
// Clocks: this suite drives a real Coordinator through short real setTimeout delays — the same
// style as turn-checkpoints-31b5-surface-red (no fake now() for this class of end-to-end fixture).
// Every wave-driver timing parameter is a short RELATIVE timeout (pollIntervalMs/stallTimeoutMs/
// hardCapMs); no test hardcodes a future date, so none is a time-bomb (fixture-clock-lint clean).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';

const repoId = 'repo-wave-driver-policy';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wave-pol-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// A MockAdapter whose card declares `turnCompletion: 'pausable'` and whose turns are SCRIPTED per
// member marker. The stock mock finalizes (terminal) after turn 1 and a nudge (prompt mode 'turn')
// would never produce a second pause; worse, its emitted `lifecycle.turn_completed` carries a
// constant wire turnEpoch, which the Coordinator rejects as stale on the second turn
// (coordinator.mjs:10159 — normalizedEpoch < currentEpoch). So this subclass (a) re-runs a fresh
// scripted turn on each nudge and (b) bumps the emitted turnEpoch by exactly one per nudge to keep
// it in lockstep with the fence (the wireEpochOffset offset, coordinator.mjs:10154-10177, is set
// once at turn 0 and applied thereafter; a +1-per-nudge wire epoch normalizes to the live epoch).
//
// The coordinator's `changedPathsDigest` is `canonicalDigest(git-diff --name-only base..HEAD)`
// (coordinator.mjs:_pauseChangedPathsDigest) — a changed-PATH-SET digest, not a content digest. So:
//   - a turn that writes a NEW report path expands the set  => digest CHANGES  (productive);
//   - a turn that re-touches an existing path leaves the set => digest UNCHANGED (unproductive,
//     the L6 termination-law trigger).
// Each script is an array of turns; each turn is `{ edits: [{ path, content, delayMs? }], delayMs?,
// failNudge?: bool }`. After the last scripted turn, the adapter repeats it (path set frozen =>
// unproductive), so a finite productive prefix is followed by an unproductive tail.
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
        provenance: 'wave-driver-policy-red', refreshedAt: null,
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
      if (turn.failNudge) {
        // The coordinator catches this as delivery_exception and rolls the pause back; the driver
        // records the failed nudge and keeps polling (D8).
        throw Object.assign(new Error('pausable adapter: scripted nudge failure'), { code: 'pausable_nudge_failed' });
      }
      const session = this._sessions.get(worker);
      if (session && session.terminal) {
        // Drive the next scripted turn (a fresh re-park). Reset the finalized session and re-run.
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

function harness(t, scriptsByMarker, options = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new PausableWaveAdapter({ harness: 'mock', scriptsByMarker });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    // Neutralize the worker watchdog (§3): a stallMs far longer than any test window, so a parked
    // turn's freshly armed timer (31b5 :177-180) never fires and writes nothing that flaps the
    // cursor-stripped stall marker.
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

// One edit at a report path (a NEW path per productive turn grows the changedPathsDigest set).
const edit = (role, turn, content = `${role} turn ${turn}\n`) => ({
  path: `reports/${role}-${turn}.md`, content,
});

// Fast policy defaults for the suite: short relative timeouts, real clock (no time-bombs).
const FAST = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 15,
  stallTimeoutMs: 400,
  hardCapMs: 3_000,
  settleTimeoutMs: 1_500,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: true,
  preflight: false,
});
