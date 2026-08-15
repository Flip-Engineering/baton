// [attempt: 1ad8a881-61f5-4f7f-b18f-b90e43b248e8 row-cadence]
// #163 follow-on red suite (docs/reference/evidence/no-clock-followons-2026-08-15/wave-d/
// row-cadence-brief.md): leg-b activity honesty + settle pacing. Rows:
//   C1   RED at pre-change head — a tool-call-only member (content.tool_call events, NO
//        checkpoints, NO coordinator events) classifies NON-silent: the per-member
//        classification folds the activity projection's lastActivityAt (any member-originated
//        evidence event), so a member whose events advance never reads 'silent'. At head the
//        classification is computed from coordinator-meaningful events only, so the same member
//        reads 'silent' past PROGRESS_SILENCE_THRESHOLD_MS (the 2026-08-15 00:12Z red facts).
//   C2   settleTimeoutMs is PACING ONLY — the settle wait never produces a terminal basis: with
//        settleTimeoutMs:1 (always times out) while members are still active, the receipt basis
//        is exactly the drive loop's verdict ('stall'), the member outcome is NOT terminalized,
//        and the closed basis vocabulary has no settle-derived member.
//   C3   RED at pre-change head — every member stop the driver issues carries its DECISION basis
//        (verdict + signal) on the stop outline: the stop reason names the basis ('stall') and is
//        never the generic 'Wave driver settled.' constant (whose opaque ledger digest was the
//        whole per-member truth of the measured instance).
//   C4   the drive loop never classifies a member terminal on a signal other than member evidence
//        — a tool-call-only member whose events advance keeps the drive alive until genuine member
//        terminality ('completed'), never a silence-derived stop.
//
// Clocks: C1 uses a SHARED injectable clock (createDriver now + application clock) so the
// worker's own event timestamps advance with the observation clock — the activity projection's
// lastActivityAt is genuinely recent when the classification is read. All windows are short
// relative timeouts or the named PROGRESS_SILENCE_THRESHOLD_MS constant (fixture-clock-lint clean).

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
import { PROGRESS_SILENCE_THRESHOLD_MS } from '../src/application-semantics.mjs';

const repoId = 'repo-row-cadence';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-row-cadence-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

const goalPlanPolicy = Object.freeze({
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
});

const profile = Object.freeze({
  schemaVersion: 1, repoId,
  definitionOfDone: ['deployment verification passes'], constraints: [], risk: 'low',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
  },
  routes: [ROUTE], capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function baseDriverOptions(repo, logDir, adapter, extra = {}) {
  return {
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    // Neutralize the worker watchdog so a parked turn's armed timer never fires mid-window.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    ...extra,
  };
}

function baseApplicationOptions(extra = {}) {
  return {
    repoId,
    profiles: { default: profile }, defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
    ...extra,
  };
}

function cleanup(t, application, driver, repo, logDir) {
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
}

// A MockAdapter that streams content.tool_call events while a turn is in flight (the real
// adapters emit these per tool call; the stock mock emits nothing mid-delay). The injected
// events are the ONLY member-originated evidence — no checkpoints, no coordinator events —
// the exact leg-b shape (grok's class: content events, zero resource.* events).
class ToolCallOnlyAdapter extends MockAdapter {
  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: [ROUTE.effort], serviceTier: null,
        provenance: 'row-cadence-test', refreshedAt: null,
      },
    };
  }

  async spawn(worker, brief, options = {}) {
    const handle = await super.spawn(worker, brief, options);
    const scenario = options.scenario ?? this._defaultScenario ?? {};
    if (Number.isSafeInteger(scenario.toolCallEveryMs) && scenario.toolCallEveryMs > 0) {
      const session = this._sessions.get(worker);
      let seq = 0;
      const timer = setInterval(() => {
        if (session && !session.terminal) {
          seq += 1;
          this._emit(session, 'content.tool_call', {
            callId: `call-${worker}-${seq}`, phase: 'completed',
            threadId: `thread-${worker}`, turnId: `turn-${worker}-1`,
            name: 'read', arguments: { path: 'base.txt' },
          });
        }
      }, scenario.toolCallEveryMs);
      timer.unref?.();
    }
    return handle;
  }
}

async function until(check, label, timeoutMs = 20_000, pollMs = 20) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const rawView = (response) => response?.view ?? response ?? {};

// ---------------------------------------------------------------------------
// C1 (RED at pre-change head) — the leg-b classification: a tool-call-only member
// (no checkpoints, no coordinator events) classifies NON-silent while its events advance.
// ---------------------------------------------------------------------------
test('C1: a tool-call-only member classifies non-silent — the classification folds the activity projection', async (t) => {
  // One SHARED mutable clock drives BOTH the coordination/log event timestamps (createDriver
  // `now`) and the application observation clock — so the worker's own event timestamps stay
  // recent when the classification is read. A fixture double, never a completion control.
  let currentMs = Date.now();
  const repo = root('repo-c1');
  const logDir = root('log-c1');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new ToolCallOnlyAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed',
      // the worker streams tool calls during its long delay — the ONLY member evidence.
      edits: [{ path: 'reports/c1.md', content: 'c1\n', delayMs: 60_000 }],
      toolCallEveryMs: 25,
    },
  });
  const driver = createDriver(baseDriverOptions(repo, logDir, adapter, { now: () => currentMs }));
  const application = new BatonApplication(baseApplicationOptions({
    driver,
    clock: () => new Date(currentMs).toISOString(),
  }));
  const baton = bindBaton(application, principal('wave-owner'));
  cleanup(t, application, driver, repo, logDir);

  const run = await baton.runs.start('write the alpha report (marker:c1)', {
    exact: ROUTE, scope: ['reports/**'],
  });
  await run.approve();

  // Wait until the member is mid-turn with tool-call evidence streaming (still 'progressing' —
  // the events are recent, so even the head classification has not crossed the threshold yet).
  const first = await until(async () => {
    const status = await run.status();
    const view = rawView(status);
    return view.phase === 'running' && (view.activity?.contentEvents ?? 0) > 0 ? status : null;
  }, 'run running with tool-call evidence');
  const firstView = rawView(first);
  assert.equal(firstView.progressClass.class, 'progressing', 'recent member evidence is progressing, not silent');
  const preAdvanceLastActivity = firstView.activity.lastActivityAt;
  assert.equal(typeof preAdvanceLastActivity, 'string');

  // Let a few more tool calls land, then advance the shared clock far past the silence
  // threshold. The coordinator's meaningful-event set is frozen at turn start (the member makes
  // only tool calls), so at head the member now reads silent; the activity projection keeps
  // advancing with every injected event.
  await new Promise((resolve) => setTimeout(resolve, 120));
  currentMs += PROGRESS_SILENCE_THRESHOLD_MS + 10_000;

  // A tool call must land AFTER the advance so lastActivityAt is genuinely recent.
  const after = await until(async () => {
    const status = await run.status();
    const view = rawView(status);
    return typeof view.activity?.lastActivityAt === 'string'
      && view.activity.lastActivityAt !== preAdvanceLastActivity ? status : null;
  }, 'a tool call lands after the clock advance');
  const afterView = rawView(after);
  assert.ok((afterView.activity?.contentEvents ?? 0) >= 1, 'tool-call evidence is present');
  assert.notEqual(afterView.progressClass.class, 'silent',
    'RED at pre-change head: a tool-call-only member whose events advance must never classify silent');
  assert.equal(afterView.progressClass.class, 'progressing',
    'the classification verdict is progressing while member evidence advances');
  assert.equal(afterView.progressClass.meaningfulEventAt, afterView.activity.lastActivityAt,
    'the classification basis is the latest member-originated evidence event (tool calls included)');
});

// ---------------------------------------------------------------------------
// Wave-driver harness (C2-C4) — the PausableWaveAdapter pattern from
// wave-driver-policy-red.test.mjs (a scripted pausable turn parks the member after turn 1).
// ---------------------------------------------------------------------------
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
        mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: [ROUTE.effort], serviceTier: null,
        provenance: 'row-cadence-test', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker)
      .find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
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
    const script = this._scriptForMarker(marker);
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
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

function waveHarness(t, scriptsByMarker, options = {}) {
  const repo = root(options.label ?? 'repo-wave');
  const logDir = root(`log-${options.label ?? 'wave'}`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new PausableWaveAdapter({ harness: 'mock', scriptsByMarker });
  const driver = createDriver(baseDriverOptions(repo, logDir, adapter));
  const application = new BatonApplication(baseApplicationOptions({ driver }));
  const baton = bindBaton(application, principal('wave-owner'));
  cleanup(t, application, driver, repo, logDir);
  return { baton, repo, driver, adapter };
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

// Fast policy defaults: short RELATIVE timeouts, real clock (fixture-clock-lint clean).
const FAST = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 15,
  stallTimeoutMs: 400,
  settleTimeoutMs: 1_500,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: true,
  preflight: false,
});

const STOP_REASON_DIGEST = (reason) =>
  createHash('sha256').update(JSON.stringify(reason)).digest('hex');

// ---------------------------------------------------------------------------
// C2 — settleTimeoutMs is pacing only: the settle wait never produces a terminal basis.
// ---------------------------------------------------------------------------
test('C2: the settle timeout is pacing-only — it never produces a terminal basis', async (t) => {
  // Steering 'none' parks the member after turn 1; the frozen view breaks the loop with basis
  // 'stall' while the member is still parked. settleTimeoutMs:1 ALWAYS times out before any
  // member settles — if the settle wait could terminate fate, this row would see it.
  const { baton, repo } = waveHarness(t, { default: [{ edits: [edit('worker', 1)] }] }, { label: 'c2' });
  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 250, settleTimeoutMs: 1,
  }).run({ repoRoot: repo, members: [member('worker', 'one parked report')] });

  assert.equal(receipt.basis, 'stall',
    'the receipt basis is exactly the drive loop\'s verdict — the settle timeout never contributes a basis');
  assert.ok(['completed', 'stall', 'aborted'].includes(receipt.basis),
    'the basis vocabulary is the closed loop-verdict set — no settle-derived member exists');
  const outcome = (receipt.outcomes ?? [])[0];
  assert.ok(outcome, 'an outcome exists for the parked member');
  assert.notEqual(outcome.terminal, true,
    'a settle timeout does not terminalize a still-working member — it only bounds the wait before close');
  assert.equal(receipt.pumpDrained, true, 'the guaranteed close drains every pump even on a timed-out settle');
});

// ---------------------------------------------------------------------------
// C3 (RED at pre-change head) — every member stop carries its DECISION basis on the stop outline.
// ---------------------------------------------------------------------------
test('C3: the member stop carries the decision basis — never the generic settled constant', async (t) => {
  const { baton, repo, driver } = waveHarness(t, { default: [{ edits: [edit('worker', 1)] }] }, { label: 'c3' });

  // Intercept runs.start so every member stop the wave's close() issues is observed at the
  // exact reason it carries (the stop outline each member sees; the ledger stores only its
  // digest). wave.close() iterates its internal member state, so the run HANDLES — not the
  // wave facade — are the interception point.
  const stopReasons = [];
  const realStart = baton.runs.start.bind(baton.runs);
  const spyRuns = {
    ...baton.runs,
    start: async (...args) => {
      const run = await realStart(...args);
      return new Proxy(run, {
        get(target, key) {
          if (key === 'stop') {
            return (reason) => {
              stopReasons.push({ role: run.id, reason });
              return target.stop(reason);
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  // Object.create keeps the BatonClient prototype chain (waves/doctor/etc. are accessors);
  // `runs` is a non-writable own property, so the override shadows it via defineProperty.
  const spyBaton = Object.create(baton);
  Object.defineProperty(spyBaton, 'runs', {
    value: spyRuns, writable: true, enumerable: true, configurable: true,
  });

  const receipt = await createWaveDriver(spyBaton, {
    ...FAST, steering: 'none', stallTimeoutMs: 250, settleTimeoutMs: 1,
  }).run({ repoRoot: repo, members: [member('worker', 'one parked report')] });
  assert.equal(receipt.basis, 'stall');
  assert.ok(stopReasons.length >= 1, 'the driver issues at least one member stop');
  for (const { reason } of stopReasons) {
    assert.equal(typeof reason, 'string', 'the stop outline carries the stop reason');
    assert.notEqual(reason, 'Wave driver settled.',
      'RED at pre-change head: the generic constant is never the reason a member sees when a basis exists');
    assert.ok(reason.includes('stall'),
      'the stop reason names the decision basis (the verdict) that fired the stop');
    assert.ok(/stall/i.test(reason), 'the stop reason names the signal that fired it');
  }

  // The ledger row truth: reasonDigest is the digest of the basis-carrying reason, never the
  // opaque digest of the constant string (the measured 00:12Z row's only per-member truth).
  const stopEvents = driver.coordination.events().filter((event) => event.kind === 'run.stop_admitted');
  assert.ok(stopEvents.length >= 1, 'a run.stop_admitted ledger row exists');
  const expectedDigests = new Set(stopReasons.map(({ reason }) => STOP_REASON_DIGEST(reason)));
  for (const event of stopEvents) {
    assert.notEqual(event.payload?.reasonDigest, STOP_REASON_DIGEST('Wave driver settled.'),
      'the ledger reasonDigest is not the digest of the generic constant');
    assert.ok(expectedDigests.has(event.payload?.reasonDigest),
      'the ledger reasonDigest is the digest of the basis-carrying stop reason the member saw');
  }
});

// ---------------------------------------------------------------------------
// C4 — the drive loop never classifies a member terminal on a signal other than
// member evidence: a tool-call-only member whose events advance keeps the drive alive
// until genuine member terminality.
// ---------------------------------------------------------------------------
test('C4: the drive loop never classifies a member terminal on a non-member signal', async (t) => {
  // A member that only emits tool calls (no checkpoints) under steering 'none' with a stall
  // window far beyond the member's work: the loop must break on the member's own terminality
  // ('completed'), never on a silence-derived stop while the evidence advances.
  const adapter = new ToolCallOnlyAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'reports/c4.md', content: 'c4\n', delayMs: 700 }],
      toolCallEveryMs: 25,
    },
  });
  const repo = root('repo-c4');
  const logDir = root('log-c4');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver(baseDriverOptions(repo, logDir, adapter));
  const application = new BatonApplication(baseApplicationOptions({ driver }));
  const baton = bindBaton(application, principal('wave-owner'));
  cleanup(t, application, driver, repo, logDir);

  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 60_000, settleTimeoutMs: 1_500,
  }).run({ repoRoot: repo, members: [member('worker', 'write the c4 report')] });

  assert.equal(receipt.basis, 'completed',
    'the drive settles on member terminality — a tool-calling member is never stopped on a non-activity signal');
  const outcome = (receipt.outcomes ?? [])[0];
  // 'result_ready' is the provider-settled RESTING phase (SUCCESS_RESTING — terminal in the
  // drive's loop, not in APPLICATION_RUN_TERMINAL_PHASES); either resting or a terminal phase
  // is the member's OWN evidence — never a silence-derived stop.
  assert.ok(['result_ready', 'work_completed', 'completed'].includes(outcome?.phase ?? ''),
    `the member completed on its own evidence (phase ${outcome?.phase}), never terminalized mid-evidence`);
  assert.notEqual(outcome?.phase, 'paused', 'the member was never parked/stopped mid-evidence');
});
