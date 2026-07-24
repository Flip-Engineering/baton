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
      if (session) {
        // Drive the next scripted turn (a fresh re-park). The nudge arrives only on a parked
        // (completed) turn, so resetting the session state and re-running is always safe — a
        // `terminal` gate here silently swallows the re-run when the coordinator parks instead
        // of finalizing (the D1/D2/D8 failure before this comment).
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

// ---------------------------------------------------------------------------
// D1 — requestId dedup (de818e3 + the m1 mis-key anti-pin): each pause is nudged
// exactly once, keyed on the checkpoint requestId, never the classification string.
test('D1: two productive pauses are nudged exactly once each, then L6 declares done and claims', async (t) => {
  const scriptsByMarker = {
    default: [
      { edits: [edit('worker', 1)] },
      { edits: [edit('worker', 2)] },
      // tail repeats turn 2: path set frozen → unproductive re-parks
    ],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.equal(receipt.nudges.length, 2, `expected exactly 2 nudges, got ${JSON.stringify(receipt.nudges)}`);
  assert.notEqual(receipt.nudges[0].requestId, receipt.nudges[1].requestId);
  assert.ok(receipt.nudges.every((entry) => !entry.error), 'no nudge may fail in this row');
  assert.equal(receipt.claims.length, 1);
  assert.equal(receipt.claims[0].code, 'claimed');
});

// D2 — status-hash liveness (the misfire pin, positive): a member whose cursor-stripped
// view keeps changing never trips the stall clock; a frozen sibling does not stall the wave
// while the live one resets the wave-level clock for all.
test('D2: a live member resets the wave-level stall clock; a frozen sibling still finishes', async (t) => {
  const scriptsByMarker = {
    lively: [
      { edits: [edit('lively', 1)] },
      { edits: [edit('lively', 2)] },
      { edits: [edit('lively', 3)] },
      { edits: [edit('lively', 4)] },
      { edits: [edit('lively', 5)] },
    ],
    frozen: [{ edits: [edit('frozen', 1)] }],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, stallTimeoutMs: 2_500, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('lively', 'write five lively reports'), member('frozen', 'write one frozen report')] });
  assert.equal(receipt.basis, 'completed');
  assert.ok(receipt.nudges.filter((entry) => entry.role === 'lively').length >= 5, 'the lively member keeps producing turns without stalling');
  assert.equal(receipt.claims.filter((entry) => entry.code === 'claimed').length, 2, 'both members settle via claim');
});

// D3 — true stall: with steering 'none' a parked member's view is genuinely frozen; the loop
// breaks with basis 'stall', still settles and closes (close drains, so pumpDrained is true).
test('D3: a frozen member view breaks the loop with basis stall and clean close', async (t) => {
  const scriptsByMarker = {
    default: [{ edits: [edit('worker', 1)] }],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 250, finalization: 'none',
  }).run({ repoRoot: repo, members: [member('worker', 'one slow report')] });
  assert.equal(receipt.basis, 'stall');
  assert.equal(receipt.remainingCount, 0);
  assert.equal(receipt.pumpDrained, true, 'the guaranteed close drains every pump even on a stall');
  assert.ok(Array.isArray(receipt.outcomes), 'outcomes survive a stall');
});

// D4 — hard cap, with stall-before-cap precedence when both cross in one poll.
test('D4: hardCapMs fires basis hard_cap on a live marker; a frozen marker yields stall first', async (t) => {
  const lively = harness(t, { default: Array.from({ length: 30 }, (_, index) => ({ edits: [edit('worker', index)] })) });
  const capped = await createWaveDriver(lively.baton, {
    ...FAST, pollIntervalMs: 10, stallTimeoutMs: 60_000, hardCapMs: 120, unproductiveNudgeBudget: 99,
  }).run({ repoRoot: lively.repo, members: [member('worker', 'thirty reports')] });
  assert.equal(capped.basis, 'hard_cap');

  const frozen = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const stalledFirst = await createWaveDriver(frozen.baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 200, hardCapMs: 20_000, finalization: 'none',
  }).run({ repoRoot: frozen.repo, members: [member('worker', 'one slow report')] });
  assert.equal(stalledFirst.basis, 'stall', 'a frozen view yields stall, never hard_cap (the stall check precedes the cap check)');
});

// D5 — salt semantics + oversize ergonomics: salted objectives carry attempt-uuid + role,
// distinct per run() call; salt:false passes verbatim; oversize rejects with the byte count.
test('D5: objective salting, opt-out, and the admission byte-check', async (t) => {
  const { baton, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const seen = [];
  const spy = {
    ...baton,
    waves: {
      start: async (options) => {
        seen.push(options.members.map((entry) => entry.objective));
        return baton.waves.start(options);
      },
    },
    doctor: baton.doctor,
  };
  const runOnce = (policy) => createWaveDriver(spy, {
    ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall', ...policy,
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  const first = await runOnce();
  const second = await runOnce();
  assert.equal(seen.length, 2);
  const saltOf = (objective) => objective.match(/^\[attempt: ([0-9a-f-]{36}) worker\]/)?.[1] ?? null;
  assert.ok(saltOf(seen[0][0]), `salted objective carries the attempt uuid + role: ${seen[0][0].slice(0, 60)}`);
  assert.notEqual(saltOf(seen[0][0]), saltOf(seen[1][0]), 'each run() call mints a fresh attempt id');
  assert.notEqual(first.salt, second.salt);

  await runOnce({ saltObjectives: false });
  assert.ok(!seen[2][0].startsWith('[attempt:'), 'salt:false passes the objective verbatim');

  const huge = `${'x'.repeat(4096)}`;
  await assert.rejects(
    createWaveDriver(baton, { ...FAST, preflight: false }).run({ repoRoot: repo, members: [member('worker', huge)] }),
    (error) => error?.code === 'wave_driver_objective_oversize' && error?.bytes > 4096,
  );
});

// D6 — the termination law (R46R-1): a re-park with an unchanged changedPathsDigest stops
// nudges; claim-on-stall resolves work_completed immediately; 'none' parks to a stall.
test('D6: the unproductive-checkpoint budget ends the treadmill — claim path and none path', async (t) => {
  const script = { default: [{ edits: [edit('worker', 1)] }] }; // tail repeats: frozen path set
  const claimed = harness(t, script);
  const withClaim = await createWaveDriver(claimed.baton, {
    ...FAST, stallTimeoutMs: 60_000, hardCapMs: 60_000, unproductiveNudgeBudget: 1, finalization: 'claim-on-stall',
  }).run({ repoRoot: claimed.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(withClaim.basis, 'completed', 'the claim path completes without waiting for the stall clock');
  assert.equal(withClaim.nudges.length, 1);
  assert.equal(withClaim.claims.length, 1);
  assert.equal(withClaim.claims[0].code, 'claimed');

  const parked = harness(t, script);
  const withoutClaim = await createWaveDriver(parked.baton, {
    ...FAST, stallTimeoutMs: 250, unproductiveNudgeBudget: 1, finalization: 'none',
  }).run({ repoRoot: parked.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(withoutClaim.basis, 'stall');
  assert.equal(withoutClaim.nudges.length, 1, 'no further nudges once the member is done');
  assert.equal(withoutClaim.claims.length, 0);
});

// D7 — the receipt/envelope: committed envelope fields plus additive driver fields, the
// evidencePath file matches, and a write failure fails loudly.
test('D7: receipt envelope shape, evidence file, and loud write failure', async (t) => {
  const { baton, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const evidencePath = join(repo, 'evidence-d7.json');
  const receipt = await createWaveDriver(baton, {
    ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall', evidencePath,
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.ok(Array.isArray(receipt.outcomes) && Array.isArray(receipt.stops));
  assert.equal(typeof receipt.remainingCount, 'number');
  assert.equal(receipt.residueUnknown, false);
  assert.equal(receipt.pumpDrained, true, 'a completing wave drains its pumps');
  assert.ok(typeof receipt.salt === 'string');
  const written = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(written.basis, receipt.basis);
  assert.deepEqual(written.nudges, receipt.nudges);

  await assert.rejects(
    createWaveDriver(baton, {
      ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
      evidencePath: join(repo, 'missing-dir', 'evidence.json'),
    }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] }),
    /ENOENT/,
  );
});

// D8 — nudge failure tolerated: a scripted one-shot nudge failure is recorded and recovered
// on the next poll (the requestId is not consumed by the failure).
test('D8: a failed nudge is recorded, not consumed, and recovered on the next poll', async (t) => {
  const scriptsByMarker = {
    default: [
      { edits: [edit('worker', 1)] },
      { edits: [edit('worker', 1)], failNudge: true }, // the FIRST nudge (prompt turn 1) fails
      { edits: [edit('worker', 2)] },
    ],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  const failed = receipt.nudges.filter((entry) => entry.error);
  const succeeded = receipt.nudges.filter((entry) => !entry.error);
  assert.equal(failed.length, 1, 'exactly one scripted nudge failure');
  assert.ok(succeeded.some((entry) => entry.requestId === failed[0].requestId),
    'the failed requestId is retried successfully on a later poll');
});

// D9 — claim fan-out at wave stall: every pending-paused member receives exactly one claim
// when the stall clock fires; the 'none' control never claims.
test('D9: stall fan-out claims every paused member exactly once', async (t) => {
  const scriptsByMarker = {
    alpha: [{ edits: [edit('alpha', 1)] }],
    beta: [{ edits: [edit('beta', 1)] }],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, stallTimeoutMs: 250, unproductiveNudgeBudget: 99, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('alpha', 'write alpha'), member('beta', 'write beta')] });
  assert.equal(receipt.basis, 'completed', 'fan-out recovers every member from the stall');
  assert.equal(receipt.claims.length, 2);
  assert.deepEqual(receipt.claims.map((entry) => entry.role).sort(), ['alpha', 'beta']);

  const control = harness(t, scriptsByMarker);
  const withoutClaim = await createWaveDriver(control.baton, {
    ...FAST, stallTimeoutMs: 250, unproductiveNudgeBudget: 99, finalization: 'none',
  }).run({ repoRoot: control.repo, members: [member('alpha', 'write alpha'), member('beta', 'write beta')] });
  assert.equal(withoutClaim.basis, 'stall');
  assert.equal(withoutClaim.claims.length, 0);
});

// D10 — unavailable semantics: consecutive status failures count toward stall; a transient
// failure resets the clock and the wave completes.
test('D10: consecutive status failures stall; transient failures reset', async (t) => {
  const scriptsByMarker = { default: [{ edits: [edit('worker', 1)] }] };

  const persistent = harness(t, scriptsByMarker);
  // The run handle is frozen — wrap it in a Proxy whose methods bind to the target (private
  // fields keep working) and only `status` is replaced.
  const wrapStatus = (run, fake) => new Proxy(run, {
    get(target, key) {
      if (key === 'status') return fake;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const wrappedPersistent = {
    ...persistent.baton,
    waves: {
      start: async (options) => {
        const wave = await persistent.baton.waves.start(options);
        const runs = new Map();
        for (const [role, run] of wave.runs) {
          runs.set(role, wrapStatus(run, async () => { throw Object.assign(new Error('status path down'), { code: 'test_status_down' }); }));
        }
        return { ...wave, runs };
      },
    },
    doctor: persistent.baton.doctor,
  };
  const stalled = await createWaveDriver(wrappedPersistent, {
    ...FAST, stallTimeoutMs: 250, finalization: 'none',
  }).run({ repoRoot: persistent.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(stalled.basis, 'stall');

  const transient = harness(t, scriptsByMarker);
  let failuresLeft = 2;
  const wrappedTransient = {
    ...transient.baton,
    waves: {
      start: async (options) => {
        const wave = await transient.baton.waves.start(options);
        const runs = new Map();
        for (const [role, run] of wave.runs) {
          runs.set(role, wrapStatus(run, async () => {
            if (failuresLeft > 0) { failuresLeft -= 1; throw Object.assign(new Error('transient'), { code: 'test_transient' }); }
            return run.status();
          }));
        }
        return { ...wave, runs };
      },
    },
    doctor: transient.baton.doctor,
  };
  const recovered = await createWaveDriver(wrappedTransient, {
    ...FAST, stallTimeoutMs: 500, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: transient.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(recovered.basis, 'completed');
});
