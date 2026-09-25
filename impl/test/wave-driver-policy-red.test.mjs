// Issue #46 — the shipped wave driver (docs/37 v2). Red-first policy suite: every row pins one
// productized-driver failure mode that a bespoke driver got wrong or skipped.
//
// Binding contract: docs/37-wave-driver.md v2 (laws L1-L7, surface §2, red rows §3).
//
// Harness mirrors wave-driver-red.test.mjs:54-124 with the checkpoint conjunction pinned (§3):
// BOTH a `turnCompletion:'pausable'` card override (exactly as turn-checkpoints-31b5-surface-red
// :105-113) AND the `steering.registered` record (wave membership via `driverKind:'wave'`, created
// automatically by run.start — 31-a D1). The worker watchdog is neutralized (a long `stallMs`
// passed to createDriver, the 31b5 :177-180 pattern) so timer writes never flap the rendered
// liveness marker.
//
// Clocks: this suite drives a real Coordinator through short real setTimeout delays — the same
// style as turn-checkpoints-31b5-surface-red (no fake now() for this class of end-to-end fixture).
// Every wave-driver timing parameter is a short RELATIVE timeout (pollIntervalMs/settleTimeoutMs);
// no test hardcodes a future date, so none is a time-bomb (fixture-clock-lint clean). Rows whose
// members never turn terminal end through the caller's stop signal — no clock, count, or digest
// decides a member's work is finished (#598 F01).

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
//   - a turn that writes a NEW report path expands the set  => digest CHANGES;
//   - a turn that re-touches an existing path leaves the set => digest UNCHANGED (the coordinator
//     still records it; the driver consumes no digest — #598 F01).
// Each script is an array of turns; each turn is `{ edits: [{ path, content, delayMs? }], delayMs?,
// failNudge?: bool }`. After the last scripted turn, the adapter repeats it, so a finite
// productive prefix is followed by a frozen tail.
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
    // rendered liveness marker.
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

// Fast policy defaults for the suite: short relative timeouts, real clock (no time-bombs). The
// retired stall/budget keys (hardCapMs/stallTimeoutMs/unproductiveNudgeBudget/refusalNudgeBudget)
// are absent — D4 pins that each refuses as an unknown field.
const FAST = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 15,
  settleTimeoutMs: 1_500,
  finalization: 'none',
  saltObjectives: true,
  preflight: false,
});

// Wraps the baton so each run handle's `act` is observable: counts successful nudge_turn
// deliveries (a refused delivery arrives as a VALUE, not a throw) and fires `signal` once the
// count passes `count`. The event-driven stand-in for the retired stall clock: a row ends its
// wave through the caller's stop, never a lifetime (#598 F01).
function nudgeCountingBaton(baton, count, { role = null } = {}) {
  const controller = new AbortController();
  let successes = 0;
  const wrapRun = (run) => new Proxy(run, {
    get(target, key) {
      if (key !== 'act') {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (name, payload) => {
        const result = await run.act(name, payload);
        if (name === 'nudge_turn' && !(result && typeof result === 'object' && result.ok === false)) {
          successes += 1;
          if (successes >= count) controller.abort();
        }
        return result;
      };
    },
  });
  const wrapped = {
    ...baton,
    waves: {
      start: async (options) => {
        const wave = await baton.waves.start(options);
        const runs = new Map();
        for (const [runRole, run] of wave.runs) {
          runs.set(runRole, role === null || runRole === role ? wrapRun(run) : run);
        }
        return { ...wave, runs };
      },
    },
    doctor: baton.doctor,
  };
  return { baton: wrapped, signal: controller.signal };
}

// ---------------------------------------------------------------------------
// D1 — requestId dedup (de818e3 + the m1 mis-key anti-pin): each pause is nudged
// exactly once, keyed on the checkpoint requestId, never the classification string. A
// member that keeps re-parking is nudged forever — the caller's stop ends the wave.
test('D1: two productive pauses are nudged exactly once each; the caller stop ends the wave', async (t) => {
  const scriptsByMarker = {
    default: [
      { edits: [edit('worker', 1)] },
      { edits: [edit('worker', 2)] },
      // tail repeats turn 2: the path set freezes but the nudges never stop — no budget bounds them
    ],
  };
  const h = harness(t, scriptsByMarker);
  const { baton, signal } = nudgeCountingBaton(h.baton, 2);
  const receipt = await createWaveDriver(baton, {
    ...FAST, signal, finalization: 'none',
  }).run({ repoRoot: h.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'aborted');
  assert.equal(receipt.nudges.length, 2, `expected exactly 2 nudges, got ${JSON.stringify(receipt.nudges)}`);
  assert.notEqual(receipt.nudges[0].requestId, receipt.nudges[1].requestId);
  assert.ok(receipt.nudges.every((entry) => !entry.error), 'no nudge may fail in this row');
});

// D2 — no nudge budget: a member whose view keeps changing is nudged for every pause it
// parks, for as long as the caller lets the wave run (#598 F01 — no count bounds the drive).
test('D2: a member that keeps producing turns is nudged without any budget', async (t) => {
  const scriptsByMarker = {
    lively: [1, 2, 3, 4, 5].map((turn) => ({ edits: [edit('lively', turn)] })),
    frozen: [{ edits: [edit('frozen', 1)] }],
  };
  const h = harness(t, scriptsByMarker);
  const { baton, signal } = nudgeCountingBaton(h.baton, 5, { role: 'lively' });
  const receipt = await createWaveDriver(baton, {
    ...FAST, signal, finalization: 'none',
  }).run({ repoRoot: h.repo, members: [member('lively', 'write five lively reports'), member('frozen', 'write one frozen report')] });
  assert.equal(receipt.basis, 'aborted');
  const lively = receipt.nudges.filter((entry) => entry.role === 'lively' && !entry.error);
  assert.ok(lively.length >= 5, `the lively member keeps producing turns without any cap: ${JSON.stringify(receipt.nudges)}`);
  assert.ok(new Set(lively.map((entry) => entry.requestId)).size === lively.length, 'each pause is nudged exactly once');
});

// D3 — a member parked forever stays parked: with steering 'none' nobody answers the
// checkpoint, the wave waits, and only the caller's stop ends it. Close is still guaranteed
// (close drains, so pumpDrained is true).
test('D3: a member parked forever stays parked; the caller stop ends the wave with a clean close', async (t) => {
  const scriptsByMarker = {
    default: [{ edits: [edit('worker', 1)] }],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', signal: controller.signal, finalization: 'none',
  }).run({ repoRoot: repo, members: [member('worker', 'one slow report')] });
  assert.equal(receipt.basis, 'aborted');
  assert.equal(receipt.remainingCount, 0);
  assert.equal(receipt.pumpDrained, true, 'the guaranteed close drains every pump even on a caller stop');
  assert.ok(Array.isArray(receipt.outcomes), 'outcomes survive a caller stop');
});

// D4 — the #163 law × #598 F01: the retired clock cap and the retired stall/nudge-budget
// keys are unknown fields — each refuses loudly by the same closed-set discipline.
test('D4: retired clock and nudge-budget policy keys refuse as unknown fields', async (t) => {
  const { baton } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  for (const retired of ['hardCapMs', 'stallTimeoutMs', 'unproductiveNudgeBudget', 'refusalNudgeBudget']) {
    assert.throws(
      () => createWaveDriver(baton, { ...FAST, [retired]: 120 }),
      (error) => error?.code === 'wave_driver_policy_invalid' && /unknown/.test(error?.message ?? ''),
      `${retired} is an unknown policy field and refuses loudly (no clock and no count decides the fate of agentic work)`,
    );
  }
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
    ...FAST, finalization: 'claim-on-stall', ...policy,
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
  // #358 (operator ruling): the objective lanes carry no 4 KiB head cap — a 4 KB member is below
  // the registry lane value the precheck reads, so it passes through with NO advisory; the
  // advisory above the lane value is pinned by the frame-economics suite's C8.
  const advisories = [];
  await createWaveDriver(baton, {
    ...FAST, preflight: false, onAdvisory: (advisory) => advisories.push(advisory),
  }).run({ repoRoot: repo, members: [member('worker', huge)] });
  assert.equal(advisories.find((entry) => entry?.role === 'worker') ?? null, null,
    '#358: a 4 KB member draws no early-ergonomics advisory — the byte-check reads the registry lane value, not 4096');
});

// D6 — the claim cadence (#598 F01): a claim-carrying checkpoint is claimed on FIRST sighting —
// no prior nudge, no re-park bookkeeping. The claim_premature_liveness refusal cadence (one
// corrective nudge per refused pause, no budget) is pinned end-to-end on the fake-wave facade by
// claim-preflight-red WD1-WD3; the real-stack trust gate accepts this member's in-scope diff.
test('D6: claim-on-stall claims a claim-carrying checkpoint on its first sighting', async (t) => {
  const claimed = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const withClaim = await createWaveDriver(claimed.baton, {
    ...FAST, finalization: 'claim-on-stall',
  }).run({ repoRoot: claimed.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(withClaim.basis, 'completed', 'the claim resolves the first pause without any prior nudge');
  assert.equal(withClaim.nudges.length, 0);
  assert.equal(withClaim.claims.length, 1);
  assert.equal(withClaim.claims[0].code, 'claimed');
});

// D7 — the receipt/envelope: committed envelope fields plus additive driver fields, the
// evidencePath file matches, and a write failure fails loudly.
test('D7: receipt envelope shape, evidence file, and loud write failure', async (t) => {
  const { baton, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const evidencePath = join(repo, 'evidence-d7.json');
  const receipt = await createWaveDriver(baton, {
    ...FAST, finalization: 'claim-on-stall', evidencePath,
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.ok(!('stalls' in receipt) && !('waiting' in receipt), 'the receipt carries no stall/waiting bookkeeping');
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
      ...FAST, finalization: 'claim-on-stall',
      evidencePath: join(repo, 'missing-dir', 'evidence.json'),
    }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] }),
    /ENOENT/,
  );
});

// D8 — nudge failure tolerated: a scripted one-shot nudge failure is recorded and recovered
// on the next poll (the requestId is not consumed by the failure); no budget stops the retries.
test('D8: a failed nudge is recorded, not consumed, and recovered on the next poll', async (t) => {
  const scriptsByMarker = {
    default: [
      { edits: [edit('worker', 1)] },
      { edits: [edit('worker', 1)], failNudge: true }, // the FIRST nudge (prompt turn 1) fails
      { edits: [edit('worker', 2)] },
    ],
  };
  const h = harness(t, scriptsByMarker);
  const { baton, signal } = nudgeCountingBaton(h.baton, 2);
  const receipt = await createWaveDriver(baton, {
    ...FAST, signal, finalization: 'none',
  }).run({ repoRoot: h.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'aborted');
  const failed = receipt.nudges.filter((entry) => entry.error);
  const succeeded = receipt.nudges.filter((entry) => !entry.error);
  assert.equal(failed.length, 1, 'exactly one scripted nudge failure');
  assert.ok(succeeded.some((entry) => entry.requestId === failed[0].requestId),
    'the failed requestId is retried successfully on a later poll');
});

// D9 — the claim fan-out: every paused member's claim-carrying checkpoint is claimed exactly
// once; the 'none' control never claims and stays parked until the caller stops the wave.
test('D9: claim-on-stall claims every paused member exactly once; the none control never claims', async (t) => {
  const scriptsByMarker = {
    alpha: [{ edits: [edit('alpha', 1)] }],
    beta: [{ edits: [edit('beta', 1)] }],
  };
  const { baton, repo } = harness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('alpha', 'write alpha'), member('beta', 'write beta')] });
  assert.equal(receipt.basis, 'completed', 'the claims settle every member');
  assert.equal(receipt.claims.length, 2);
  assert.deepEqual(receipt.claims.map((entry) => entry.role).sort(), ['alpha', 'beta']);

  const control = harness(t, scriptsByMarker);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
  const withoutClaim = await createWaveDriver(control.baton, {
    ...FAST, steering: 'none', signal: controller.signal, finalization: 'none',
  }).run({ repoRoot: control.repo, members: [member('alpha', 'write alpha'), member('beta', 'write beta')] });
  assert.equal(withoutClaim.basis, 'aborted');
  assert.equal(withoutClaim.claims.length, 0);
});

// D10 — unavailable semantics: a failed status read contributes 'unavailable' and the wave
// WAITS through it (no stall adjudication ends the loop); a transient failure recovers and
// the wave completes through the claim.
test('D10: status failures never end the wave; a transient failure recovers into completion', async (t) => {
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
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
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
  const waiting = await createWaveDriver(wrappedPersistent, {
    ...FAST, signal: controller.signal, finalization: 'none',
  }).run({ repoRoot: persistent.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(waiting.basis, 'aborted', 'persistent status failures never end the wave — only the caller stop does');

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
    ...FAST, finalization: 'claim-on-stall',
  }).run({ repoRoot: transient.repo, members: [member('worker', 'write the worker report')] });
  assert.equal(recovered.basis, 'completed');
});

// D11 — the issue-#48 erratum end-to-end: a Run-bound worker's scratchpad write with
// expectedFence 'current' resolves to the live fence (numeric fences are unwritable from
// prose — the 0/24 demo fence chase); a stale integer still refuses.
test("D11: expectedFence 'current' resolves to the live worker fence for a Run-bound worker", async (t) => {
  const { baton, driver, repo } = harness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const run = await baton.runs.start('scratchpad current-fence write (marker:worker)', {
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'], driverKind: 'wave',
  });
  await run.approve();
  const status = await run.status();
  const view = status?.view ?? status ?? {};
  const workerId = (Array.isArray(view.attention) ? view.attention : []).find((item) => typeof item?.workerId === 'string')?.workerId
    ?? view?.outline?.workerId ?? 'w-1';

  const entry = { kind: 'note', text: 'live-fence write from a Run-bound worker' };
  const first = driver.coordinator.writeScratchpad(workerId, entry, { expectedFence: 'current', idempotencyKey: 'd11:first' });
  assert.equal(first.ok, true, `first 'current' write must succeed: ${JSON.stringify(first)}`);
  const second = driver.coordinator.writeScratchpad(workerId, entry, { expectedFence: 'current', idempotencyKey: 'd11:second' });
  assert.equal(second.ok, true, `second 'current' write must succeed: ${JSON.stringify(second)}`);

  const stale = driver.coordinator.writeScratchpad(workerId, entry, { expectedFence: -1, idempotencyKey: 'd11:stale' });
  assert.deepEqual(stale, { ok: false, result: 'scratchpad_write_invalid' });
  const unknown = driver.coordinator.writeScratchpad(workerId, entry, { expectedFence: 'sometimes', idempotencyKey: 'd11:unknown' });
  assert.deepEqual(unknown, { ok: false, result: 'scratchpad_write_invalid' });

});
